#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_fs::FsExt;

struct DataDir(PathBuf);

#[tauri::command]
fn get_data_dir(state: tauri::State<DataDir>) -> String {
    state.0.to_string_lossy().to_string()
}

#[tauri::command]
fn write_photo(
    state: tauri::State<DataDir>,
    plot_idx: u32,
    suffix: String,
    data: Vec<u8>,
) -> Result<String, String> {
    let photos_dir = state.0.join("photos");
    std::fs::create_dir_all(&photos_dir).map_err(|e| e.to_string())?;
    let filename = format!("plot_{:02}_{}.jpg", plot_idx, suffix);
    let abs_path = photos_dir.join(&filename);
    std::fs::write(&abs_path, &data).map_err(|e| e.to_string())?;
    Ok(format!("photos/{}", filename))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![get_data_dir, write_photo])
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
