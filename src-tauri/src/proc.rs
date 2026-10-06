//! Child-process helper: hidden console window, streamed output, stdin, cancellation
//! (kills the whole process tree), optional timeout.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use anyhow::{anyhow, bail, Result};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

pub type LineFn = Box<dyn FnMut(&str) + Send>;

#[derive(Default)]
pub struct RunOpts {
    pub cwd: Option<PathBuf>,
    pub stdin: Option<String>,
    pub env: Vec<(String, String)>,
    pub timeout: Option<Duration>,
    pub cancel: Option<CancellationToken>,
    pub on_stdout: Option<LineFn>,
    pub on_stderr: Option<LineFn>,
    /// Keep at most this many bytes of stdout/stderr in the result (0 = unlimited).
    pub keep_bytes: usize,
}

#[derive(Debug, Clone)]
pub struct Output {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

impl Output {
    pub fn ok(&self) -> bool {
        self.code == 0
    }
    pub fn tail(&self, n: usize) -> String {
        let s = if self.stderr.trim().is_empty() { &self.stdout } else { &self.stderr };
        let lines: Vec<&str> = s.lines().collect();
        lines[lines.len().saturating_sub(n)..].join("\n")
    }
}

pub fn command(program: &Path) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn push_capped(buf: &mut String, line: &str, cap: usize) {
    buf.push_str(line);
    buf.push('\n');
    if cap > 0 && buf.len() > cap * 2 {
        let cut = buf.len() - cap;
        let mut idx = cut;
        while !buf.is_char_boundary(idx) {
            idx += 1;
        }
        buf.drain(..idx);
    }
}

#[cfg(windows)]
async fn kill_tree(pid: Option<u32>) {
    if let Some(pid) = pid {
        let _ = command(Path::new("taskkill"))
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await;
    }
}

#[cfg(not(windows))]
async fn kill_tree(_pid: Option<u32>) {}

pub async fn run<S: AsRef<str>>(program: &Path, args: &[S], mut opts: RunOpts) -> Result<Output> {
    let mut cmd = command(program);
    for a in args {
        cmd.arg(a.as_ref());
    }
    if let Some(cwd) = &opts.cwd {
        cmd.current_dir(cwd);
    }
    for (k, v) in &opts.env {
        cmd.env(k, v);
    }
    cmd.stdin(if opts.stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = cmd
        .spawn()
        .map_err(|e| anyhow!("could not start {}: {e}", program.display()))?;
    let pid = child.id();

    if let Some(input) = opts.stdin.take() {
        if let Some(mut stdin) = child.stdin.take() {
            tokio::spawn(async move {
                let _ = stdin.write_all(input.as_bytes()).await;
                let _ = stdin.shutdown().await;
            });
        }
    }

    let cap = opts.keep_bytes;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let mut on_out = opts.on_stdout.take();
    let mut on_err = opts.on_stderr.take();

    let out_task = tokio::spawn(async move {
        let mut buf = String::new();
        let mut reader = BufReader::new(stdout);
        let mut raw = Vec::new();
        loop {
            raw.clear();
            match reader.read_until(b'\n', &mut raw).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let line = String::from_utf8_lossy(&raw);
                    let line = line.trim_end_matches(['\r', '\n']);
                    if let Some(f) = on_out.as_mut() {
                        f(line);
                    }
                    push_capped(&mut buf, line, cap);
                }
            }
        }
        buf
    });
    let err_task = tokio::spawn(async move {
        let mut buf = String::new();
        let mut reader = BufReader::new(stderr);
        let mut raw = Vec::new();
        loop {
            raw.clear();
            // ffmpeg/whisper progress uses '\r' – treat it as a line break too.
            match reader.read_until(b'\n', &mut raw).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let text = String::from_utf8_lossy(&raw).to_string();
                    for line in text.split('\r') {
                        let line = line.trim_end_matches('\n');
                        if line.is_empty() {
                            continue;
                        }
                        if let Some(f) = on_err.as_mut() {
                            f(line);
                        }
                        push_capped(&mut buf, line, cap);
                    }
                }
            }
        }
        buf
    });

    let cancel = opts.cancel.clone().unwrap_or_default();
    let timeout = opts.timeout.unwrap_or(Duration::from_secs(60 * 60 * 24));
    let status = tokio::select! {
        s = child.wait() => s?,
        _ = cancel.cancelled() => {
            kill_tree(pid).await;
            let _ = child.kill().await;
            bail!("cancelled");
        }
        _ = tokio::time::sleep(timeout) => {
            kill_tree(pid).await;
            let _ = child.kill().await;
            bail!("{} timed out after {}s", program.display(), timeout.as_secs());
        }
    };
    let stdout = out_task.await.unwrap_or_default();
    let stderr = err_task.await.unwrap_or_default();
    Ok(Output { code: status.code().unwrap_or(-1), stdout, stderr })
}

/// Convenience: run and fail with the stderr tail if the exit code is non-zero.
pub async fn run_ok<S: AsRef<str>>(program: &Path, args: &[S], opts: RunOpts) -> Result<Output> {
    let name = program.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let out = run(program, args, opts).await?;
    if !out.ok() {
        bail!("{name} failed (exit {}): {}", out.code, out.tail(12));
    }
    Ok(out)
}

/// Quick capture with a short timeout – used for `--version`, auth checks, probes.
pub async fn capture<S: AsRef<str>>(program: &Path, args: &[S], secs: u64) -> Result<Output> {
    run(
        program,
        args,
        RunOpts { timeout: Some(Duration::from_secs(secs)), keep_bytes: 256 * 1024, ..Default::default() },
    )
    .await
}

/// Opens a new, visible console window running a PowerShell command (for logins/installs).
pub fn open_terminal(title: &str, ps_command: &str) -> Result<()> {
    #[cfg(windows)]
    {
        // `start` needs a (quoted) window title as its first argument.
        std::process::Command::new("cmd")
            .args(["/C", "start", title, "powershell", "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", ps_command])
            .spawn()?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (title, ps_command);
        bail!("opening a terminal is only implemented on Windows")
    }
}
