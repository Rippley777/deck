use crate::database::{Backup, Database};
use tauri::State;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn save_export(
    app: tauri::AppHandle,
    name: String,
    contents: String,
) -> Result<bool, String> {
    let Some(file) = app.dialog().file().set_file_name(name).blocking_save_file() else {
        return Ok(false);
    };
    let path = file.into_path().map_err(|error| error.to_string())?;
    std::fs::write(path, contents).map_err(|error| error.to_string())?;
    Ok(true)
}
#[tauri::command]
pub fn load_data(db: State<Database>) -> Result<Option<String>, String> {
    db.load()
}
#[tauri::command]
pub fn save_data(data: String, db: State<Database>) -> Result<(), String> {
    db.save(&data)
}
#[tauri::command]
pub fn database_location(db: State<Database>) -> String {
    db.location()
}
#[tauri::command]
pub fn create_backup(db: State<Database>) -> Result<(), String> {
    db.backup()
}
#[tauri::command]
pub fn list_backups(db: State<Database>) -> Result<Vec<Backup>, String> {
    db.backups()
}
#[tauri::command]
pub fn restore_backup(name: String, db: State<Database>) -> Result<String, String> {
    db.restore(&name)
}
