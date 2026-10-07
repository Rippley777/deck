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
pub fn switch_profile(profile: String, db: State<Database>) -> Result<Option<String>, String> {
    db.switch_profile(&profile)
}
#[tauri::command]
pub fn clear_local_data(db: State<Database>) -> Result<(), String> {
    db.clear()
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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredProject {
    name: String,
    path: String,
    local_path: String,
}
fn scan_projects(
    root: &std::path::Path,
    directory: &std::path::Path,
    depth: usize,
    found: &mut Vec<DiscoveredProject>,
) {
    if found.len() >= 200 {
        return;
    }
    if [
        "package.json",
        "Cargo.toml",
        "pyproject.toml",
        "go.mod",
        ".git",
    ]
    .iter()
    .any(|name| directory.join(name).exists())
    {
        found.push(DiscoveredProject {
            name: directory
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            path: directory
                .strip_prefix(root.parent().unwrap_or(root))
                .unwrap_or(directory)
                .to_string_lossy()
                .into_owned(),
            local_path: directory.to_string_lossy().into_owned(),
        });
    }
    if depth == 0 {
        return;
    }
    if let Ok(entries) = std::fs::read_dir(directory) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.')
                || ["node_modules", "target", "vendor", "dist", "build"].contains(&name.as_str())
            {
                continue;
            }
            if entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
                scan_projects(root, &entry.path(), depth - 1, found);
            }
        }
    }
}
#[tauri::command]
pub async fn discover_projects(
    app: tauri::AppHandle,
) -> Result<Option<Vec<DiscoveredProject>>, String> {
    let Some(folder) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let path = folder.into_path().map_err(|e| e.to_string())?;
    let mut found = Vec::new();
    scan_projects(&path, &path, 3, &mut found);
    Ok(Some(found))
}
