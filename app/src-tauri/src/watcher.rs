use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, Debouncer};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const DEBOUNCE_MS: u64 = 300;
const SELF_WRITE_RETENTION: Duration = Duration::from_secs(60);

#[derive(Clone)]
struct SelfWrite {
    at: Instant,
    digest: [u8; 32],
}

static SELF_WRITES: OnceLock<Mutex<HashMap<PathBuf, SelfWrite>>> = OnceLock::new();

fn self_writes() -> &'static Mutex<HashMap<PathBuf, SelfWrite>> {
    SELF_WRITES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Resolve through the parent after deletion/rename, when canonicalizing the
/// file itself no longer works. This also preserves Windows extended paths.
fn file_identity(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| {
        path.parent()
            .and_then(|parent| parent.canonicalize().ok())
            .and_then(|parent| path.file_name().map(|name| parent.join(name)))
            .unwrap_or_else(|| path.to_path_buf())
    })
}

/// Only suppress an OS echo while the actual bytes still equal our write.
/// Timestamp tolerances could swallow a real external edit made within 2s.
pub fn mark_self_write(path: &str, bytes: &[u8]) {
    let mut writes = self_writes().lock().unwrap();
    writes.retain(|_, write| write.at.elapsed() < SELF_WRITE_RETENTION);
    writes.insert(
        file_identity(Path::new(path)),
        SelfWrite {
            at: Instant::now(),
            digest: Sha256::digest(bytes).into(),
        },
    );
}

fn is_self_write(path: &Path) -> bool {
    let write = self_writes().lock().unwrap().get(path).cloned();
    let Some(write) = write.filter(|write| write.at.elapsed() < SELF_WRITE_RETENTION) else {
        return false;
    };
    std::fs::read(path)
        .map(|bytes| <[u8; 32]>::from(Sha256::digest(&bytes)) == write.digest)
        .unwrap_or(false)
}

/// A file has one OS parent-directory watch, with independently removable
/// window/alias subscriptions. A second window must not replace the first.
#[derive(Default)]
struct WatcherInner {
    watched_files: HashMap<PathBuf, HashMap<String, HashSet<String>>>,
    watched_dirs: HashMap<PathBuf, usize>,
}

impl WatcherInner {
    /// Returns a new OS directory watch only for the first file in that dir.
    fn subscribe(&mut self, canonical: PathBuf, window: &str, original: &str) -> Option<PathBuf> {
        if let Some(subscribers) = self.watched_files.get_mut(&canonical) {
            subscribers.entry(window.to_string()).or_default().insert(original.to_string());
            return None;
        }
        let parent = canonical.parent()?.to_path_buf();
        let mut subscribers = HashMap::new();
        subscribers.insert(window.to_string(), HashSet::from([original.to_string()]));
        self.watched_files.insert(canonical, subscribers);
        let count = self.watched_dirs.entry(parent.clone()).or_default();
        *count += 1;
        (*count == 1).then_some(parent)
    }

    /// original=None removes every subscription owned by a destroyed window.
    /// Returns directories whose last file subscription has gone away.
    fn unsubscribe(&mut self, window: &str, original: Option<&str>) -> Vec<PathBuf> {
        let mut removed = Vec::new();
        self.watched_files.retain(|canonical, subscribers| {
            if let Some(aliases) = subscribers.get_mut(window) {
                if let Some(original) = original {
                    aliases.remove(original);
                } else {
                    aliases.clear();
                }
                if aliases.is_empty() {
                    subscribers.remove(window);
                }
            }
            if subscribers.is_empty() {
                removed.push(canonical.clone());
                false
            } else {
                true
            }
        });
        let mut unused_dirs = Vec::new();
        for canonical in removed {
            if let Some(parent) = canonical.parent() {
                if let Some(count) = self.watched_dirs.get_mut(parent) {
                    *count -= 1;
                    if *count == 0 {
                        unused_dirs.push(parent.to_path_buf());
                        self.watched_dirs.remove(parent);
                    }
                }
            }
        }
        unused_dirs
    }

    fn recipients(&self, canonical: &Path, exclude: Option<&str>) -> Vec<(String, String)> {
        self.watched_files.get(canonical).into_iter()
            .flat_map(|subscribers| subscribers.iter())
            .filter(|(window, _)| Some(window.as_str()) != exclude)
            .flat_map(|(window, aliases)| aliases.iter().map(move |alias| (window.clone(), alias.clone())))
            .collect()
    }

    fn save_recipients(&self, canonical: &Path, source_window: Option<&str>, source_path: &str) -> Vec<(String, String)> {
        self.recipients(canonical, None).into_iter()
            .filter(|(window, alias)| !(Some(window.as_str()) == source_window && alias == source_path))
            .collect()
    }
}

pub struct WatcherState {
    debouncer: Mutex<Option<Debouncer<RecommendedWatcher>>>,
    inner: Arc<Mutex<WatcherInner>>,
}

impl Default for WatcherState {
    fn default() -> Self {
        Self::new()
    }
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            debouncer: Mutex::new(None),
            inner: Arc::new(Mutex::new(WatcherInner::default())),
        }
    }
}

fn emit_changes(app: &AppHandle, recipients: Vec<(String, String)>) {
    for (window, original) in recipients {
        let _ = app.emit_to(window.as_str(), "solomd://file-changed", original);
    }
}

/// Send saves explicitly to other windows even though the OS echo is deduped.
/// The event retains the alias each window used when opening the file.
pub fn notify_internal_save(app: &AppHandle, path: &str, source_window: Option<&str>) {
    if let Some(state) = app.try_state::<WatcherState>() {
        let recipients = state.inner.lock().unwrap()
            .save_recipients(&file_identity(Path::new(path)), source_window, path);
        emit_changes(app, recipients);
    }
}

fn ensure_watcher(app: &AppHandle, state: &WatcherState) -> Result<(), String> {
    let mut guard = state.debouncer.lock().unwrap();
    if guard.is_some() {
        return Ok(());
    }
    let app = app.clone();
    let inner = state.inner.clone();
    let debouncer = new_debouncer(
        Duration::from_millis(DEBOUNCE_MS),
        move |result: notify_debouncer_mini::DebounceEventResult| {
            let Ok(events) = result else { return };
            let mut delivered = HashSet::new();
            for event in events {
                let canonical = file_identity(&event.path);
                if !delivered.insert(canonical.clone()) {
                    continue;
                }
                let recipients = inner.lock().unwrap().recipients(&canonical, None);
                if !recipients.is_empty() && !is_self_write(&canonical) {
                    emit_changes(&app, recipients);
                }
            }
        },
    ).map_err(|e| format!("create watcher failed: {e}"))?;
    *guard = Some(debouncer);
    Ok(())
}

#[tauri::command]
pub fn watch_file(
    app: AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, WatcherState>,
    path: String,
) -> Result<(), String> {
    super::commands::authorize(&path)?;
    let canonical = Path::new(&path).canonicalize()
        .map_err(|e| format!("canonicalize failed: {e}"))?;
    ensure_watcher(&app, &state)?;
    // All mutations take debouncer then inner, serializing registration and
    // rollback against concurrent windows. The event callback only takes inner.
    let mut debouncer = state.debouncer.lock().unwrap();
    let mut inner = state.inner.lock().unwrap();
    if let Some(parent) = inner.subscribe(canonical, window.label(), &path) {
        let result = debouncer.as_mut().ok_or("watcher unavailable")?
            .watcher().watch(&parent, RecursiveMode::NonRecursive);
        if let Err(e) = result {
            inner.unsubscribe(window.label(), Some(&path));
            return Err(format!("watch failed: {e}"));
        }
    }
    Ok(())
}

fn remove_subscriptions(state: &WatcherState, window: &str, path: Option<&str>) {
    let mut debouncer = state.debouncer.lock().unwrap();
    let unused_dirs = state.inner.lock().unwrap().unsubscribe(window, path);
    if let Some(debouncer) = debouncer.as_mut() {
        for parent in unused_dirs {
            let _ = debouncer.watcher().unwatch(&parent);
        }
    }
}

#[tauri::command]
pub fn unwatch_file(
    window: tauri::Window,
    state: tauri::State<'_, WatcherState>,
    path: String,
) -> Result<(), String> {
    // Releasing this window's own subscription needs no file I/O or permission;
    // the file may already be deleted, moved, or outside a previous vault.
    remove_subscriptions(&state, window.label(), Some(&path));
    Ok(())
}

pub fn unwatch_window(app: &AppHandle, window: &str) {
    if let Some(state) = app.try_state::<WatcherState>() {
        remove_subscriptions(&state, window, None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_subscriptions_are_independent_and_keep_aliases() {
        let mut inner = WatcherInner::default();
        let file = PathBuf::from("notes/note.md");
        assert_eq!(inner.subscribe(file.clone(), "main", "notes/note.md"), Some(PathBuf::from("notes")));
        assert_eq!(inner.subscribe(file.clone(), "aux", "alias/note.md"), None);
        assert_eq!(inner.subscribe(file.clone(), "main", "notes/note.md"), None);
        assert_eq!(inner.watched_dirs[Path::new("notes")], 1);
        assert_eq!(inner.recipients(&file, Some("main")), vec![("aux".into(), "alias/note.md".into())]);
        assert!(inner.unsubscribe("main", Some("notes/note.md")).is_empty());
        assert_eq!(inner.recipients(&file, None), vec![("aux".into(), "alias/note.md".into())]);
        assert_eq!(inner.unsubscribe("aux", Some("alias/note.md")), vec![PathBuf::from("notes")]);
        assert!(inner.watched_dirs.is_empty());
    }

    #[test]
    fn aliases_in_one_window_can_be_released_separately() {
        let mut inner = WatcherInner::default();
        let file = PathBuf::from("notes/note.md");
        inner.subscribe(file.clone(), "main", "note.md");
        inner.subscribe(file.clone(), "main", "alias.md");
        assert!(inner.unsubscribe("main", Some("note.md")).is_empty());
        assert_eq!(inner.recipients(&file, None), vec![("main".into(), "alias.md".into())]);
        assert_eq!(inner.save_recipients(&file, Some("main"), "note.md"),
            vec![("main".into(), "alias.md".into())]);
    }

    #[test]
    fn destroyed_window_releases_only_its_subscriptions() {
        let mut inner = WatcherInner::default();
        inner.subscribe(PathBuf::from("notes/a.md"), "main", "a.md");
        inner.subscribe(PathBuf::from("notes/b.md"), "aux", "b.md");
        inner.subscribe(PathBuf::from("other/c.md"), "aux", "c.md");
        let released = inner.unsubscribe("aux", None);
        assert_eq!(released, vec![PathBuf::from("other")]);
        assert_eq!(inner.watched_dirs[Path::new("notes")], 1);
        assert_eq!(inner.watched_files.len(), 1);
        assert!(inner.unsubscribe("unknown", None).is_empty());
    }

    #[test]
    fn immediate_external_write_is_never_mistaken_for_self_write() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("note.md");
        std::fs::write(&file, b"own save").unwrap();
        mark_self_write(file.to_str().unwrap(), b"own save");
        let identity = file_identity(&file);
        assert!(is_self_write(&identity));
        // No sleep: this edit was previously swallowed by the 2-second epsilon.
        std::fs::write(&file, b"external edit").unwrap();
        assert!(!is_self_write(&identity));
        std::fs::remove_file(&file).unwrap();
        assert!(!is_self_write(&identity));
    }

    #[test]
    fn deleted_file_identity_matches_registered_path() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("note.md");
        std::fs::write(&file, "note").unwrap();
        let registered = file_identity(&file);
        std::fs::remove_file(&file).unwrap();
        assert_eq!(file_identity(&file), registered);
    }

    #[test]
    fn directory_watch_survives_atomic_save() {
        use std::sync::mpsc;
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("note.md");
        std::fs::write(&target, b"initial").unwrap();
        let canonical = file_identity(&target);
        let (tx, rx) = mpsc::channel();
        let mut debouncer = new_debouncer(Duration::from_millis(50), move |events: notify_debouncer_mini::DebounceEventResult| {
            if let Ok(events) = events {
                for event in events {
                    let _ = tx.send(file_identity(&event.path));
                }
            }
        }).unwrap();
        debouncer.watcher().watch(dir.path(), RecursiveMode::NonRecursive).unwrap();
        let temporary = dir.path().join("note.tmp");
        std::fs::write(&temporary, b"atomic").unwrap();
        std::fs::rename(&temporary, &target).unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if rx.recv_timeout(Duration::from_millis(100)).ok().as_ref() == Some(&canonical) {
                return;
            }
        }
        panic!("directory watcher missed atomic replacement");
    }
}
