//! Headless CLI binary for automated integration testing.
//!
//! Operates the same `cutroom_tauri::dispatch` entrypoint as the Tauri host
//! but without native dialogs, a webview, or `tauri_build` codegen. Requests
//! are JSON objects on stdin (one per line); responses are NDJSON on stdout.
//! All diagnostics go to stderr. The binary keeps `AppState` alive until stdin
//! reaches EOF or the process receives a signal, then drops the state to flush
//! SQLite and cleanly shut down background workers.
//!
//! ## Usage
//!
//! ```sh
//! # Interactive / piped NDJSON mode (one request per line on stdin):
//! cutroom-cli --registry-path /tmp/test/projects.json
//!
//! # Single-shot mode (one request, exit after response):
//! cutroom-cli --registry-path /tmp/test/projects.json \
//!   --request '{"command":"health.get","payload":{}}'
//! ```

use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::process;

use cutroom_tauri::{AppState, NativeRequest, NativeResponse};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (registry_path, single_request) = parse_args(&args);

    let state = match AppState::try_with_registry_path(registry_path.clone()) {
        Ok(state) => state,
        Err(error) => {
            eprintln!("cutroom-cli: failed to initialize state with registry {:?}: {error}", registry_path);
            process::exit(1);
        }
    };
    eprintln!("cutroom-cli: ready (registry={:?})", registry_path);

    if let Some(json) = single_request {
        // Single-shot mode: parse request, dispatch, print response, exit.
        let request: NativeRequest = match serde_json::from_str(&json) {
            Ok(request) => request,
            Err(error) => {
                eprintln!("cutroom-cli: invalid request JSON: {error}");
                process::exit(1);
            }
        };
        let response = cutroom_tauri::dispatch(&state, request);
        write_response(&response);
        drop(state);
        return;
    }

    // NDJSON stdio mode: read one JSON line at a time, dispatch, write response.
    let stdin = io::stdin().lock();
    for line in stdin.lines() {
        let line = match line {
            Ok(line) => line,
            Err(error) => {
                eprintln!("cutroom-cli: stdin read error: {error}");
                break;
            }
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let request: NativeRequest = match serde_json::from_str(trimmed) {
            Ok(request) => request,
            Err(error) => {
                let error_response = NativeResponse::Err {
                    ok: false,
                    error: cutroom_tauri::NativeErrorPayload {
                        code: "PARSE_ERROR".into(),
                        message: format!("invalid request JSON: {error}"),
                        details: None,
                    },
                };
                write_response(&error_response);
                continue;
            }
        };
        let response = cutroom_tauri::dispatch(&state, request);
        write_response(&response);
    }

    eprintln!("cutroom-cli: stdin closed, shutting down");
    drop(state);
    eprintln!("cutroom-cli: exit");
}

fn write_response(response: &NativeResponse) {
    let stdout = io::stdout();
    let mut handle = stdout.lock();
    // serde_json::to_writer produces no trailing newline; we append one for NDJSON.
    let result = serde_json::to_writer(&mut handle, response)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e))
        .and_then(|_| handle.write_all(b"\n"))
        .and_then(|_| handle.flush());
    if let Err(error) = result {
        eprintln!("cutroom-cli: stdout write error: {error}");
        process::exit(1);
    }
}

fn parse_args(args: &[String]) -> (PathBuf, Option<String>) {
    let mut registry_path: Option<PathBuf> = None;
    let mut single_request: Option<String> = None;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--registry-path" => {
                i += 1;
                if i >= args.len() {
                    eprintln!("cutroom-cli: --registry-path requires a value");
                    process::exit(1);
                }
                registry_path = Some(PathBuf::from(&args[i]));
            }
            "--request" => {
                i += 1;
                if i >= args.len() {
                    eprintln!("cutroom-cli: --request requires a JSON value");
                    process::exit(1);
                }
                single_request = Some(args[i].clone());
            }
            "--help" | "-h" => {
                eprintln!("Usage: cutroom-cli --registry-path <PATH> [--request '<JSON>']");
                eprintln!();
                eprintln!("  --registry-path <PATH>  Path to the project registry (projects.json)");
                eprintln!("  --request '<JSON>'      Single-shot mode: dispatch one request and exit");
                eprintln!();
                eprintln!("Without --request, reads NDJSON requests from stdin, writes responses to stdout.");
                process::exit(0);
            }
            other => {
                eprintln!("cutroom-cli: unknown argument: {other}");
                process::exit(1);
            }
        }
        i += 1;
    }
    let registry_path = match registry_path {
        Some(path) => path,
        None => {
            eprintln!("cutroom-cli: --registry-path is required");
            process::exit(1);
        }
    };
    (registry_path, single_request)
}
