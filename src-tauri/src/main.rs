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

#[tauri::command]
fn save_zip(
    app: tauri::AppHandle,
    filename: String,
    data_b64: String,
) -> Result<Option<String>, String> {
    use base64::{Engine, engine::general_purpose::STANDARD};
    use tauri_plugin_dialog::DialogExt;
    let data = STANDARD.decode(&data_b64).map_err(|e| e.to_string())?;
    let chosen = app
        .dialog()
        .file()
        .add_filter("ZIP Archive", &["zip"])
        .set_file_name(&filename)
        .blocking_save_file();
    match chosen {
        None => Ok(None),
        Some(path) => {
            let abs = path.into_path().map_err(|e| e.to_string())?;
            std::fs::write(&abs, &data).map_err(|e| e.to_string())?;
            Ok(Some(abs.to_string_lossy().to_string()))
        }
    }
}

#[tauri::command]
fn open_data_dir(state: tauri::State<DataDir>) -> Result<(), String> {
    let path = &state.0;
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![get_data_dir, write_photo, save_zip, open_data_dir])
        .setup(|app| {
            // Resolve OS-appropriate app data directory:
            //   Windows: %APPDATA%\ph.cordillera.taniman
            //   macOS:   ~/Library/Application Support/ph.cordillera.taniman
            let data_dir = app.path().app_data_dir()
                .map_err(|e| format!("cannot resolve app_data_dir: {e}"))?;
            let photos_dir = data_dir.join("photos");

            // Create dirs (idempotent)
            if let Err(e) = std::fs::create_dir_all(&photos_dir) {
                use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
                let msg = format!(
                    "Cannot create data folder at {:?}.\nPlease ensure the app has write access to your user data directory.\n\nDetails: {}",
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
