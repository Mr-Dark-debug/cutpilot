pub mod agent;
pub mod broll;
pub mod edit;
pub mod export;
pub mod jobs;
pub mod media;
pub mod pipeline;
pub mod proc;
pub mod project;
pub mod prompts;
pub mod render;
pub mod resolve;
pub mod settings;
pub mod style;
pub mod tools;
pub mod transcribe;
pub mod util;

mod commands;

use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager};

use jobs::{JobInfo, Jobs, Reporter};

pub struct AppState {
    pub jobs: Arc<Jobs>,
}

struct TauriReporter {
    app: AppHandle,
}

impl Reporter for TauriReporter {
    fn job(&self, info: &JobInfo) {
        let _ = self.app.emit("job", info);
    }
    fn log(&self, job_id: &str, line: &str) {
        let _ = self.app.emit("job-log", serde_json::json!({ "jobId": job_id, "line": line }));
    }
    fn project(&self, project_id: &str) {
        let _ = self.app.emit("project", project_id);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let reporter = Arc::new(TauriReporter { app: app.handle().clone() });
            app.manage(AppState { jobs: Jobs::new(reporter) });
            // Projects interrupted by a crash or forced quit shouldn't stay "running".
            for p in project::list() {
                if p.status.state == "running" || p.status.state == "queued" {
                    let _ = project::update(&p.id, |p| {
                        p.status.state = if p.current_edit.is_some() { "ready".into() } else { "new".into() };
                        p.status.message = String::new();
                        p.status.job_id = None;
                        Ok(())
                    });
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::get_settings,
            commands::save_settings,
            commands::tools_status,
            commands::install_tool,
            commands::open_login,
            commands::engine_models,
            commands::whisper_models,
            commands::list_projects,
            commands::get_project,
            commands::create_project,
            commands::create_batch,
            commands::update_project,
            commands::delete_project,
            commands::add_sources,
            commands::remove_source,
            commands::add_reference,
            commands::remove_reference,
            commands::start_pipeline,
            commands::revise_edit,
            commands::cancel_job,
            commands::list_jobs,
            commands::job_logs,
            commands::clear_jobs,
            commands::get_edit,
            commands::get_source_data,
            commands::save_edit,
            commands::set_current_edit,
            commands::fill_broll,
            commands::search_stock,
            commands::set_broll_asset,
            commands::export_project,
            commands::render_video,
            commands::send_to_resolve,
            commands::list_styles,
            commands::save_style,
            commands::delete_style,
            commands::analyze_style_reference,
            commands::get_library,
            commands::scan_library,
            commands::describe_library,
            commands::path_exists,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CutPilot");
}
