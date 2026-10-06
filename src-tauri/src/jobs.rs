//! Background jobs with progress, logs, cancellation and two concurrency
//! limits: `media` (transcription/analysis/render – CPU/GPU bound) and `llm`
//! (AI engine calls – subscription bound).

use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex};

use anyhow::Result;
use serde::Serialize;
use serde_json::Value;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio_util::sync::CancellationToken;

use crate::{settings, util};

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct JobInfo {
    pub id: String,
    /// pipeline | revise | broll | export | render | reference | style | library | install
    pub kind: String,
    pub project_id: Option<String>,
    /// What the job acts on besides a project (e.g. the tool being installed).
    pub target: Option<String>,
    pub title: String,
    /// queued | running | done | error | cancelled
    pub state: String,
    pub stage: String,
    pub progress: f64,
    pub message: String,
    pub error: Option<String>,
    pub created: String,
    pub finished: Option<String>,
    pub result: Option<Value>,
}

pub trait Reporter: Send + Sync + 'static {
    fn job(&self, info: &JobInfo);
    fn log(&self, job_id: &str, line: &str);
    fn project(&self, project_id: &str);
}

struct Limiter {
    sem: Arc<Semaphore>,
    size: Mutex<usize>,
}

impl Limiter {
    fn new(n: usize) -> Self {
        Self { sem: Arc::new(Semaphore::new(n)), size: Mutex::new(n) }
    }
    fn resize(&self, n: usize) {
        let mut size = self.size.lock().unwrap();
        if n > *size {
            self.sem.add_permits(n - *size);
        } else if n < *size {
            self.sem.forget_permits(*size - n);
        }
        *size = n;
    }
}

pub struct Jobs {
    jobs: Mutex<HashMap<String, (JobInfo, CancellationToken)>>,
    logs: Mutex<HashMap<String, Vec<String>>>,
    reporter: Arc<dyn Reporter>,
    media: Limiter,
    llm: Limiter,
}

impl Jobs {
    pub fn new(reporter: Arc<dyn Reporter>) -> Arc<Self> {
        let s = settings::get();
        Arc::new(Self {
            jobs: Mutex::new(HashMap::new()),
            logs: Mutex::new(HashMap::new()),
            reporter,
            media: Limiter::new(s.media_concurrency.max(1)),
            llm: Limiter::new(s.llm_concurrency.max(1)),
        })
    }

    pub fn apply_settings(&self) {
        let s = settings::get();
        self.media.resize(s.media_concurrency.max(1));
        self.llm.resize(s.llm_concurrency.max(1));
    }

    pub fn reporter(&self) -> &Arc<dyn Reporter> {
        &self.reporter
    }

    pub fn list(&self) -> Vec<JobInfo> {
        let mut v: Vec<JobInfo> = self.jobs.lock().unwrap().values().map(|(j, _)| j.clone()).collect();
        v.sort_by(|a, b| b.created.cmp(&a.created));
        v
    }

    pub fn get(&self, id: &str) -> Option<JobInfo> {
        self.jobs.lock().unwrap().get(id).map(|(j, _)| j.clone())
    }

    pub fn logs(&self, id: &str) -> Vec<String> {
        self.logs.lock().unwrap().get(id).cloned().unwrap_or_default()
    }

    /// The running/queued job for a project, if any.
    pub fn active_for(&self, project_id: &str) -> Option<JobInfo> {
        self.jobs
            .lock()
            .unwrap()
            .values()
            .map(|(j, _)| j)
            .find(|j| j.project_id.as_deref() == Some(project_id) && (j.state == "running" || j.state == "queued"))
            .cloned()
    }

    pub fn cancel(&self, id: &str) -> bool {
        if let Some((_, tok)) = self.jobs.lock().unwrap().get(id) {
            tok.cancel();
            return true;
        }
        false
    }

    pub fn clear_finished(&self) {
        self.jobs.lock().unwrap().retain(|_, (j, _)| j.state == "running" || j.state == "queued");
    }

    fn update(&self, id: &str, f: impl FnOnce(&mut JobInfo)) {
        let info = {
            let mut jobs = self.jobs.lock().unwrap();
            let Some((j, _)) = jobs.get_mut(id) else { return };
            f(j);
            j.clone()
        };
        self.reporter.job(&info);
    }

    pub fn spawn<F, Fut>(self: &Arc<Self>, kind: &str, project_id: Option<String>, title: &str, f: F) -> String
    where
        F: FnOnce(Ctx) -> Fut + Send + 'static,
        Fut: Future<Output = Result<Option<Value>>> + Send + 'static,
    {
        self.spawn_tagged(kind, project_id, None, title, f)
    }

    pub fn spawn_tagged<F, Fut>(self: &Arc<Self>, kind: &str, project_id: Option<String>, target: Option<String>, title: &str, f: F) -> String
    where
        F: FnOnce(Ctx) -> Fut + Send + 'static,
        Fut: Future<Output = Result<Option<Value>>> + Send + 'static,
    {
        let id = util::new_id();
        let token = CancellationToken::new();
        let info = JobInfo {
            id: id.clone(),
            kind: kind.into(),
            project_id,
            target,
            title: title.into(),
            state: "queued".into(),
            created: util::now_iso(),
            ..Default::default()
        };
        self.jobs.lock().unwrap().insert(id.clone(), (info.clone(), token.clone()));
        self.reporter.job(&info);
        let ctx = Ctx { jobs: self.clone(), id: id.clone(), cancel: token };
        let jobs = self.clone();
        let jid = id.clone();
        tauri::async_runtime::spawn(async move {
            jobs.update(&jid, |j| j.state = "running".into());
            let res = f(ctx.clone()).await;
            let cancelled = ctx.cancel.is_cancelled();
            jobs.update(&jid, |j| {
                j.finished = Some(util::now_iso());
                match res {
                    Ok(v) => {
                        j.state = "done".into();
                        j.progress = 1.0;
                        j.result = v;
                    }
                    Err(_) if cancelled => {
                        j.state = "cancelled".into();
                        j.message = "Cancelled".into();
                    }
                    Err(e) => {
                        j.state = "error".into();
                        j.error = Some(format!("{e:#}"));
                        j.message = format!("{e}");
                    }
                }
            });
            if let Some(info) = jobs.get(&jid) {
                if let Some(e) = &info.error {
                    jobs.push_log(&jid, &format!("ERROR: {e}"));
                }
            }
        });
        id
    }

    fn push_log(&self, id: &str, line: &str) {
        {
            let mut logs = self.logs.lock().unwrap();
            let v = logs.entry(id.to_string()).or_default();
            v.push(format!("{} {}", chrono::Local::now().format("%H:%M:%S"), line));
            if v.len() > 2000 {
                v.drain(..500);
            }
        }
        self.reporter.log(id, line);
    }
}

#[derive(Clone)]
pub struct Ctx {
    jobs: Arc<Jobs>,
    pub id: String,
    pub cancel: CancellationToken,
}

impl Ctx {
    pub fn stage(&self, stage: &str, progress: f64) {
        let stage = stage.to_string();
        self.jobs.update(&self.id, |j| {
            j.stage = stage.clone();
            j.message = stage;
            j.progress = progress.clamp(0.0, 1.0);
        });
        self.log(&format!("▸ {}", self.jobs.get(&self.id).map(|j| j.stage).unwrap_or_default()));
    }

    pub fn progress(&self, progress: f64, message: &str) {
        let message = message.to_string();
        self.jobs.update(&self.id, |j| {
            j.progress = progress.clamp(0.0, 1.0);
            if !message.is_empty() {
                j.message = message;
            }
        });
    }

    pub fn log(&self, line: &str) {
        self.jobs.push_log(&self.id, line);
    }

    pub fn project_changed(&self, project_id: &str) {
        self.jobs.reporter.project(project_id);
    }

    pub fn check(&self) -> Result<()> {
        if self.cancel.is_cancelled() {
            anyhow::bail!("cancelled");
        }
        Ok(())
    }

    async fn acquire(&self, which: &Limiter, what: &str) -> Result<OwnedSemaphorePermit> {
        if which.sem.available_permits() == 0 {
            self.jobs.update(&self.id, |j| {
                j.state = "queued".into();
                j.message = format!("Waiting for a free {what} slot…");
            });
        }
        let permit = tokio::select! {
            p = which.sem.clone().acquire_owned() => p?,
            _ = self.cancel.cancelled() => anyhow::bail!("cancelled"),
        };
        self.jobs.update(&self.id, |j| j.state = "running".into());
        Ok(permit)
    }

    pub async fn media_slot(&self) -> Result<OwnedSemaphorePermit> {
        self.acquire(&self.jobs.media, "transcription").await
    }

    pub async fn llm_slot(&self) -> Result<OwnedSemaphorePermit> {
        self.acquire(&self.jobs.llm, "AI").await
    }
}
