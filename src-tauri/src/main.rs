#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_fs::FsExt;

struct DataDir(PathBuf);

#[tauri::command]
fn get_data_dir(state: tauri::State<DataDir>) -> String {
    state.0.to_string_lossy().to_string()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![get_data_dir])
        .setup(|app| {
            // Resolve <exe_dir>/data
            let exe = std::env::current_exe()
                .map_err(|e| format!("cannot resolve current_exe: {e}"))?;
            let exe_dir = exe
                .parent()
                .ok_or("current_exe has no parent")?
                .to_path_buf();
            let data_dir = exe_dir.join("data");
            let photos_dir = data_dir.join("photos");

            // Create dirs (idempotent)
            if let Err(e) = std::fs::create_dir_all(&photos_dir) {
                use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
                let msg = format!(
                    "Cannot create data folder at {:?}.\nPlease move Taniman.exe to a writable location.\n\nDetails: {}",
                    data_dir, e
                );
                let _ = app
                    .dialog()
                    .message(msg)
                    .kind(MessageDialogKind::Error)
                    .title("Taniman — Storage Error")
                    .blocking_show();
                std::process::exit(1);
            }

            // Register data_dir with the fs plugin's runtime scope
            app.fs_scope().allow_directory(&data_dir, true)?;

            // Stash the path for the get_data_dir command
            app.manage(DataDir(data_dir));

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
