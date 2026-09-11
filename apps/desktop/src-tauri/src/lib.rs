//! Typed native dispatch surface. The pure Rust function is directly testable;
//! a desktop host registers this same function as Tauri's single `dispatch` command.

mod dispatch;

pub use dispatch::{
    AppState, NativeErrorPayload, NativeRequest, NativeResponse, dispatch,
    dispatch_with_authorized_selection, native_replay_for_host, project_create_replay_for_host,
};
