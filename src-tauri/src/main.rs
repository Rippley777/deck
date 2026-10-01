#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod cloud;
mod commands;
mod database;
use tauri::Manager;
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let path = database::default_path(&app.path().app_data_dir()?);
            let db = database::Database::open(path).map_err(std::io::Error::other)?;
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_data,
            commands::save_data,
            commands::database_location,
            commands::create_backup,
            commands::list_backups,
            commands::restore_backup,
            commands::save_export,
            cloud::connect_cloud,
            cloud::cloud_request,
            cloud::disconnect_cloud
        ])
        .run(tauri::generate_context!())
        .expect("Unable to run Deck");
}
