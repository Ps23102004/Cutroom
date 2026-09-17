use serde_json::Value;
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

use cutroom_tauri::{
    AppState, NativeErrorPayload, NativeRequest, NativeResponse, dispatch as core_dispatch,
    dispatch_with_authorized_selection, native_replay_for_host, project_create_replay_for_host,
};

fn rejected(message: impl Into<String>) -> NativeResponse {
    NativeResponse::Err {
        ok: false,
        error: NativeErrorPayload {
            code: "INVALID_SELECTION".into(),
            message: message.into(),
            details: None,
        },
    }
}

fn idempotency_rejected(message: impl Into<String>) -> NativeResponse {
    NativeResponse::Err {
        ok: false,
        error: NativeErrorPayload {
            code: "IDEMPOTENCY_CONFLICT".into(),
            message: message.into(),
            details: None,
        },
    }
}

/// The production IPC boundary never accepts caller-supplied filesystem paths.
/// Only this host command can turn a native, user-approved dialog selection into
/// the internal dispatch payload. Rust tests call the pure dispatch function and
/// may inject fixture paths without exposing that escape hatch to webview IPC.
#[tauri::command]
async fn dispatch(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    request: NativeRequest,
) -> Result<NativeResponse, String> {
    match request.command.as_str() {
        "asset.import" => {
            if request.payload.get("path").is_some() {
                return Ok(rejected(
                    "asset paths must be selected through the native file picker",
                ));
            }
            if request
                .payload
                .get("openFileDialog")
                .and_then(Value::as_bool)
                != Some(true)
            {
                return Ok(rejected("asset.import requires openFileDialog: true"));
            }
            match native_replay_for_host(&state, &request, true) {
                Ok(Some(response)) => {
                    return Ok(NativeResponse::Ok {
                        ok: true,
                        data: response,
                    });
                }
                Ok(None) => {}
                Err(error) => return Ok(idempotency_rejected(error)),
            }
            let handle = app.clone();
            let selection = tauri::async_runtime::spawn_blocking(move || {
                handle
                    .dialog()
                    .file()
                    .set_title("Choose media to import")
                    .add_filter("Media", &["mp4", "mov", "m4v"])
                    .blocking_pick_file()
                    .and_then(|file| file.into_path().ok())
            })
            .await;
            match selection {
                Ok(Some(path)) => {
                    return Ok(dispatch_with_authorized_selection(
                        &state,
                        request,
                        Some(path),
                    ));
                }
                Ok(None) => return Ok(rejected("media selection was cancelled")),
                Err(_) => return Ok(rejected("native media picker did not complete")),
            }
        }
        "project.create" => {
            if request.payload.get("path").is_some() {
                return Ok(rejected(
                    "project folders must be selected through the native folder picker",
                ));
            }
            if request
                .payload
                .get("selectDirectory")
                .and_then(Value::as_bool)
                != Some(true)
            {
                return Ok(rejected("project.create requires selectDirectory: true"));
            }
            match project_create_replay_for_host(&state, &request) {
                Ok(Some(response)) => {
                    return Ok(NativeResponse::Ok {
                        ok: true,
                        data: response,
                    });
                }
                Ok(None) => {}
                Err(error) => return Ok(idempotency_rejected(error)),
            }
            let handle = app.clone();
            let selection = tauri::async_runtime::spawn_blocking(move || {
                handle
                    .dialog()
                    .file()
                    .set_title("Choose a folder for the Cutroom project")
                    .blocking_pick_folder()
                    .and_then(|folder| folder.into_path().ok())
            })
            .await;
            match selection {
                Ok(Some(path)) => {
                    return Ok(dispatch_with_authorized_selection(
                        &state,
                        request,
                        Some(path),
                    ));
                }
                Ok(None) => return Ok(rejected("project folder selection was cancelled")),
                Err(_) => return Ok(rejected("native project folder picker did not complete")),
            }
        }
        "project.open" if request.payload.get("path").is_some() => {
            return Ok(rejected(
                "project.open resolves only durable registered project IDs",
            ));
        }
        "lut.pick" => {
            if request.payload.get("path").is_some() {
                return Ok(rejected(
                    "LUT files must be selected through the native file picker",
                ));
            }
            if request
                .payload
                .get("openFileDialog")
                .and_then(Value::as_bool)
                != Some(true)
            {
                return Ok(rejected("lut.pick requires openFileDialog: true"));
            }
            let handle = app.clone();
            let selection = tauri::async_runtime::spawn_blocking(move || {
                handle
                    .dialog()
                    .file()
                    .set_title("Choose a .cube LUT")
                    .add_filter("LUT", &["cube"])
                    .blocking_pick_file()
                    .and_then(|file| file.into_path().ok())
            })
            .await;
            match selection {
                Ok(Some(path)) => {
                    return Ok(dispatch_with_authorized_selection(
                        &state,
                        request,
                        Some(path),
                    ));
                }
                Ok(None) => return Ok(rejected("LUT selection was cancelled")),
                Err(_) => return Ok(rejected("native LUT picker did not complete")),
            }
        }
        _ => {}
    }
    Ok(core_dispatch(&state, request))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let registry = app
                .path()
                .app_data_dir()
                .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })?
                .join("projects.json");
            let state = AppState::try_with_registry_path(registry)
                .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![dispatch])
        .run(tauri::generate_context!())
        .expect("Cutroom native host failed to run");
}
