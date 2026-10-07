use rusqlite::{Connection, OptionalExtension};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

pub struct Database {
    connection: Mutex<Connection>,
    path: Mutex<PathBuf>,
    directory: PathBuf,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub name: String,
    pub created_at: String,
}

type Result<T> = std::result::Result<T, String>;
fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}

impl Database {
    pub fn open(path: PathBuf) -> Result<Self> {
        let parent = path
            .parent()
            .ok_or("Database path needs a parent directory")?;
        fs::create_dir_all(parent).map_err(error)?;
        let connection = Connection::open(&path).map_err(error)?;
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(error)?;
        connection
            .execute_batch(include_str!("../migrations/001_initial.sql"))
            .map_err(error)?;
        let version: i64 = connection
            .query_row("SELECT MAX(version) FROM migrations", [], |row| row.get(0))
            .map_err(error)?;
        if version > 1 {
            return Err("This database needs a newer version of Deck.".into());
        }
        Ok(Self {
            connection: Mutex::new(connection),
            directory: parent.to_path_buf(),
            path: Mutex::new(path),
        })
    }

    pub fn switch_profile(&self, profile: &str) -> Result<Option<String>> {
        if !profile.is_empty()
            && (profile.len() > 200
                || !profile
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_'))
        {
            return Err("Invalid local profile".into());
        }
        let path = if profile.is_empty() {
            self.directory.join("deck.db")
        } else {
            self.directory
                .join("profiles")
                .join(profile)
                .join("deck.db")
        };
        let next = Database::open(path.clone())?;
        let value = next.load()?;
        let mut connection = self.connection.lock().map_err(error)?;
        *connection = next.connection.into_inner().map_err(error)?;
        *self.path.lock().map_err(error)? = path;
        Ok(value)
    }

    pub fn clear(&self) -> Result<()> {
        let connection = self.connection.lock().map_err(error)?;
        // Secure deletion also removes the previous document from SQLite's free pages.
        connection.execute_batch("PRAGMA secure_delete=ON; DELETE FROM documents; PRAGMA wal_checkpoint(TRUNCATE); VACUUM;").map_err(error)?;
        let folder = self.backup_folder();
        if folder.exists() {
            fs::remove_dir_all(folder).map_err(error)?;
        }
        Ok(())
    }

    pub fn location(&self) -> String {
        self.path.lock().unwrap().to_string_lossy().into_owned()
    }

    pub fn load(&self) -> Result<Option<String>> {
        self.connection
            .lock()
            .map_err(error)?
            .query_row(
                "SELECT value FROM documents WHERE collection='workspace' AND id='default'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(error)
    }

    pub fn save(&self, data: &str) -> Result<()> {
        let value: serde_json::Value = serde_json::from_str(data).map_err(error)?;
        if value["version"] != 1 || !value["tasks"].is_array() || !value["stacks"].is_array() {
            return Err("Invalid Deck workspace".into());
        }
        let mut connection = self.connection.lock().map_err(error)?;
        let transaction = connection.transaction().map_err(error)?;
        transaction
            .execute(
                "INSERT OR REPLACE INTO documents VALUES ('workspace','default',?1)",
                [data],
            )
            .map_err(error)?;
        transaction.commit().map_err(error)?;
        let interval = if value["settings"]["backupFrequency"] == "weekly" {
            7 * 86400
        } else {
            86400
        };
        let recent = fs::read_dir(self.backup_folder())
            .ok()
            .into_iter()
            .flatten()
            .filter_map(std::result::Result::ok)
            .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "db"))
            .filter_map(|entry| entry.metadata().ok())
            .filter_map(|meta| meta.modified().ok())
            .any(|time| {
                time.elapsed()
                    .map(|duration| duration.as_secs() < interval)
                    .unwrap_or(false)
            });
        if !recent {
            self.snapshot(&connection, "")?;
        }
        Ok(())
    }

    fn backup_folder(&self) -> PathBuf {
        self.path.lock().unwrap().parent().unwrap().join("backups")
    }

    fn snapshot(&self, connection: &Connection, suffix: &str) -> Result<()> {
        let folder = self.backup_folder();
        fs::create_dir_all(&folder).map_err(error)?;
        let name = format!(
            "deck-backup-{}{}.db",
            chrono::Local::now().format("%Y-%m-%d"),
            suffix
        );
        let temporary = folder.join("snapshot.tmp");
        if temporary.exists() {
            fs::remove_file(&temporary).map_err(error)?;
        }
        connection
            .backup(rusqlite::DatabaseName::Main, &temporary, None)
            .map_err(error)?;
        fs::File::open(&temporary)
            .map_err(error)?
            .sync_all()
            .map_err(error)?;
        let target = folder.join(name);
        // Windows does not replace existing files with rename. A snapshot is always
        // fully written and synchronized before replacing a same-day snapshot.
        #[cfg(windows)]
        if target.exists() {
            fs::remove_file(&target).map_err(error)?;
        }
        fs::rename(temporary, target).map_err(error)?;
        let mut paths: Vec<_> = fs::read_dir(&folder)
            .map_err(error)?
            .filter_map(std::result::Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.extension().is_some_and(|extension| extension == "db"))
            .collect();
        paths.sort();
        let remove_count = paths.len().saturating_sub(14);
        for path in paths.into_iter().take(remove_count) {
            fs::remove_file(path).map_err(error)?;
        }
        Ok(())
    }

    pub fn backup(&self) -> Result<()> {
        self.snapshot(&*self.connection.lock().map_err(error)?, "")
    }

    pub fn backups(&self) -> Result<Vec<Backup>> {
        let folder = self.backup_folder();
        fs::create_dir_all(&folder).map_err(error)?;
        let mut backups: Vec<_> = fs::read_dir(folder)
            .map_err(error)?
            .filter_map(std::result::Result::ok)
            .filter_map(|entry| {
                let name = entry.file_name().to_string_lossy().into_owned();
                (name.starts_with("deck-backup-") && name.ends_with(".db")).then(|| Backup {
                    created_at: name.get(12..22).unwrap_or("").to_string(),
                    name,
                })
            })
            .collect();
        backups.sort_by(|a, b| b.name.cmp(&a.name));
        Ok(backups)
    }

    pub fn restore(&self, name: &str) -> Result<String> {
        if name.contains('/')
            || name.contains('\\')
            || !name.starts_with("deck-backup-")
            || !name.ends_with(".db")
        {
            return Err("Invalid backup name".into());
        }
        let source = Connection::open_with_flags(
            self.backup_folder().join(name),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .map_err(error)?;
        let data: String = source
            .query_row(
                "SELECT value FROM documents WHERE collection='workspace' AND id='default'",
                [],
                |row| row.get(0),
            )
            .map_err(error)?;
        let value: serde_json::Value = serde_json::from_str(&data).map_err(error)?;
        if value["version"] != 1 || !value["tasks"].is_array() {
            return Err("Unsupported backup format".into());
        }
        let mut connection = self.connection.lock().map_err(error)?;
        self.snapshot(&connection, "-before-restore")?;
        let transaction = connection.transaction().map_err(error)?;
        transaction
            .execute(
                "INSERT OR REPLACE INTO documents VALUES ('workspace','default',?1)",
                [&data],
            )
            .map_err(error)?;
        transaction.commit().map_err(error)?;
        Ok(data)
    }
}

pub fn default_path(directory: &Path) -> PathBuf {
    directory.join("deck.db")
}

#[cfg(test)]
mod tests {
    use super::*;
    static FIXTURE_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    fn fixture() -> (Database, PathBuf) {
        let folder = std::env::temp_dir().join(format!(
            "deck-test-{}-{}",
            std::process::id(),
            FIXTURE_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        (Database::open(folder.join("deck.db")).unwrap(), folder)
    }
    fn workspace(title: &str) -> String {
        serde_json::json!({"version":1,"tasks":[{"title":title}],"stacks":[],"settings":{"backupFrequency":"daily"}}).to_string()
    }
    #[test]
    fn migrations_and_committed_data_survive_reopening() {
        let (db, folder) = fixture();
        assert!(db.load().unwrap().is_none());
        let data = workspace("A durable thought");
        db.save(&data).unwrap();
        drop(db);
        let reopened = Database::open(folder.join("deck.db")).unwrap();
        assert_eq!(reopened.load().unwrap(), Some(data));
        assert_eq!(reopened.backups().unwrap().len(), 1);
        drop(reopened);
        fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn invalid_writes_leave_existing_workspace_untouched() {
        let (db, folder) = fixture();
        let data = workspace("Keep this");
        db.save(&data).unwrap();
        assert!(db.save("{\"version\":2}").is_err());
        assert_eq!(db.load().unwrap(), Some(data));
        drop(db);
        fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn restoring_retains_a_snapshot_of_the_previous_workspace() {
        let (db, folder) = fixture();
        let before = workspace("Original");
        db.save(&before).unwrap();
        let name = db.backups().unwrap()[0].name.clone();
        db.save(&workspace("Newer")).unwrap();
        assert_eq!(db.restore(&name).unwrap(), before);
        assert!(db
            .backups()
            .unwrap()
            .iter()
            .any(|b| b.name.contains("before-restore")));
        assert!(db.restore("../deck.db").is_err());
        assert_eq!(db.load().unwrap(), Some(before));
        drop(db);
        fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn local_profiles_keep_separate_databases_and_backups() {
        let (db, folder) = fixture();
        let a = workspace("Account A");
        db.save(&a).unwrap();
        assert!(db.switch_profile("account-b").unwrap().is_none());
        let b = workspace("Account B");
        db.save(&b).unwrap();
        assert_eq!(db.switch_profile("").unwrap(), Some(a.clone()));
        assert_eq!(db.load().unwrap(), Some(a));
        assert_eq!(db.switch_profile("account-b").unwrap(), Some(b));
        assert!(db.switch_profile("../outside").is_err());
        drop(db);
        fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn removing_one_profile_does_not_remove_other_profiles() {
        let (db, folder) = fixture();
        let original = workspace("Keep default profile");
        db.save(&original).unwrap();
        db.switch_profile("account-b").unwrap();
        db.save(&workspace("Remove this profile")).unwrap();
        db.clear().unwrap();
        assert!(db.load().unwrap().is_none());
        assert!(db.backups().unwrap().is_empty());
        assert_eq!(db.switch_profile("").unwrap(), Some(original));
        assert_eq!(db.backups().unwrap().len(), 1);
        drop(db);
        fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn snapshots_rotate_at_fourteen() {
        let (db, folder) = fixture();
        db.save(&workspace("Keep this")).unwrap();
        for day in 1..=20 {
            fs::write(
                folder
                    .join("backups")
                    .join(format!("deck-backup-2020-01-{day:02}.db")),
                b"old",
            )
            .unwrap();
        }
        db.backup().unwrap();
        assert_eq!(db.backups().unwrap().len(), 14);
        drop(db);
        fs::remove_dir_all(folder).unwrap();
    }
}
