#![cfg(windows)]
use app_lib::windows_update_helper::{launch_handoff, UpdateJob, UpdateResult, HELPER_FLAG};
use sha2::{Digest, Sha256};
use std::{
    fs,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Child, Command},
    time::{Duration, Instant},
};

const APP: &str = env!("CARGO_BIN_EXE_CatstepMD");
const NO_WINDOW: u32 = 0x08000000;

fn wait_for(path: &Path) {
    let deadline = Instant::now() + Duration::from_secs(20);
    while !path.is_file() {
        assert!(
            Instant::now() < deadline,
            "timed out waiting for {}",
            path.display()
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}

struct Fixture {
    directory: tempfile::TempDir,
    parent: Child,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = self.parent.kill();
        let _ = self.parent.wait();
    }
}
impl Fixture {
    fn new() -> Self {
        let directory = tempfile::Builder::new()
            .prefix("catstep update 中文 & %PATH% !^() ")
            .tempdir()
            .unwrap();
        let root = directory.path();
        let binary = root.join("parent.exe");
        let output = Command::new("rustc")
            .args(["--edition=2021", "--crate-name", "updater_fixture"])
            .arg(
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("tests/fixtures/windows_updater_fixture.rs"),
            )
            .arg("-o")
            .arg(&binary)
            .creation_flags(NO_WINDOW)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "fixture compile failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        fs::copy(&binary, root.join("restart.exe")).unwrap();
        fs::copy(&binary, root.join("downloaded installer.exe")).unwrap();
        fs::create_dir(root.join("cache")).unwrap();
        let parent = Command::new(binary)
            .creation_flags(NO_WINDOW)
            .spawn()
            .unwrap();
        wait_for(&root.join("parent.ready"));
        Self { directory, parent }
    }
    fn root(&self) -> &Path {
        self.directory.path()
    }
    fn job(&self) -> UpdateJob {
        let installer = self.root().join("downloaded installer.exe");
        UpdateJob {
            version: 1,
            parent_pid: self.parent.id(),
            restart_exe: self.root().join("restart.exe"),
            expected_sha256: hex::encode(Sha256::digest(fs::read(&installer).unwrap())),
            installer,
            silent: true,
            ready_token: format!("{:032x}", rand::random::<u128>()),
            show_error_dialog: false,
        }
    }
    fn launch(&self) -> PathBuf {
        let handoff =
            launch_handoff(&self.root().join("cache"), Path::new(APP), self.job()).unwrap();
        fs::write(handoff.join("control-root"), self.root().to_str().unwrap()).unwrap();
        handoff
    }
    fn release(&mut self) {
        fs::write(self.root().join("parent.release"), b"release").unwrap();
        wait_for(&self.root().join("parent.exiting"));
        std::thread::sleep(Duration::from_millis(100));
        assert!(
            !self.root().join("installer.started").exists(),
            "must wait for actual process exit, not an arbitrary delay/marker"
        );
        assert!(self.parent.wait().unwrap().success());
    }
}

fn result(handoff: &Path) -> UpdateResult {
    wait_for(&handoff.join("result.json"));
    // A file can be observed between create and the last write.
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        if let Ok(bytes) = fs::read(handoff.join("result.json")) {
            if let Ok(result) = serde_json::from_slice::<UpdateResult>(&bytes) {
                // Wait for our own helper/restart fixtures before TempDir RAII
                // removes their executables on Windows.
                if let Ok(ready) = fs::read(handoff.join("ready")) {
                    if let Ok(ready) = serde_json::from_slice::<serde_json::Value>(&ready) {
                        if let Some(pid) = ready["helper_pid"].as_u64() {
                            wait_process(pid as u32);
                        }
                    }
                }
                if let Some(pid) = result.restart_pid {
                    wait_process(pid);
                }
                return result;
            }
        }
        assert!(Instant::now() < deadline, "invalid result.json");
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn wait_process(pid: u32) {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, WAIT_OBJECT_0},
        System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE},
    };
    let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
    if !handle.is_null() {
        let status = unsafe { WaitForSingleObject(handle, 10000) };
        unsafe {
            CloseHandle(handle);
        }
        assert_eq!(status, WAIT_OBJECT_0, "our fixture/helper did not exit");
    }
}

#[test]
fn real_product_helper_waits_installs_and_restarts_with_shell_metacharacter_paths() {
    let mut fixture = Fixture::new();
    let handoff = fixture.launch();
    assert!(!fixture.root().join("installer.started").exists());
    // Changing the writable JSON after ready must not change the child's
    // already validated snapshot. The original restart path must still run.
    fs::write(handoff.join("job.json"), b"modified after ready").unwrap();
    fixture.release();
    let result = result(&handoff);
    assert_eq!(result.status, "installed", "{result:?}");
    assert_eq!(result.installer_exit_code, Some(0));
    assert!(result.restart_pid.is_some());
    wait_for(&fixture.root().join("restart.marker"));
    let args = fs::read_to_string(fixture.root().join("installer.args")).unwrap();
    assert!(
        args.ends_with(", \"/S\"]"),
        "silent installer must receive one literal /S argument: {args}"
    );
    println!("real helper: parent exit -> installer completion -> restart, literal 中文 & %...% !^() path passed");
}

#[test]
fn installer_failure_is_recorded_without_restart_or_false_success() {
    let mut fixture = Fixture::new();
    fs::write(fixture.root().join("installer.exit"), b"23").unwrap();
    let handoff = fixture.launch();
    fixture.release();
    let result = result(&handoff);
    assert_eq!(result.status, "failed");
    assert_eq!(result.installer_exit_code, Some(23));
    assert!(result.error.unwrap().contains("23"));
    assert!(result.restart_pid.is_none());
    assert!(!fixture.root().join("restart.marker").exists());
    println!("real helper: installer exit 23, persisted failure, no restart");
}

#[test]
fn staged_installer_cannot_be_written_deleted_or_replaced_while_handoff_waits() {
    let mut fixture = Fixture::new();
    let handoff = fixture.launch();
    let installer = handoff.join("installer.exe");
    let rename_directory = fs::rename(&handoff, handoff.with_extension("moved")).unwrap_err();
    assert!(
        matches!(rename_directory.raw_os_error(), Some(5 | 32)),
        "active helper directory must not be replaceable: {rename_directory}"
    );
    let cache = handoff.parent().unwrap();
    let rename_cache = fs::rename(cache, fixture.root().join("cache-moved")).unwrap_err();
    assert!(
        matches!(rename_cache.raw_os_error(), Some(5 | 32)),
        "active helper ancestor must not be replaceable: {rename_cache}"
    );
    for error in [
        fs::write(&installer, b"tampered harmless bytes").unwrap_err(),
        fs::remove_file(&installer).unwrap_err(),
        fs::rename(&installer, handoff.join("renamed.exe")).unwrap_err(),
    ] {
        assert_eq!(
            error.raw_os_error(),
            Some(32),
            "Windows must enforce the deny-write/delete lock: {error}"
        );
    }
    fixture.release();
    let result = result(&handoff);
    assert_eq!(result.status, "installed", "{result:?}");
    assert_eq!(result.installer_exit_code, Some(0));
    assert!(fixture.root().join("installer.started").exists());
    assert!(fixture.root().join("restart.marker").exists());
    println!("real helper: Windows refused payload write/delete/rename (32), original verified payload installed");
}

#[test]
fn real_product_entry_rejects_job_digest_tampering_before_deserialization() {
    let fixture = Fixture::new();
    let path = fixture.root().join("untrusted-job.json");
    fs::write(&path, serde_json::to_vec(&fixture.job()).unwrap()).unwrap();
    let status = Command::new(APP)
        .arg(HELPER_FLAG)
        .arg(&path)
        .arg("0".repeat(64))
        .creation_flags(NO_WINDOW)
        .status()
        .unwrap();
    assert_eq!(status.code(), Some(1));
    let result = result(fixture.root());
    assert!(result.error.unwrap().contains("handoff integrity"));
    assert!(!fixture.root().join("ready").exists());
    assert!(!fixture.root().join("installer.started").exists());
}

#[test]
fn preflight_rejects_unverified_bytes_or_unsupported_installer_without_launch() {
    let fixture = Fixture::new();
    let mut job = fixture.job();
    job.expected_sha256 = "0".repeat(64);
    let error = launch_handoff(&fixture.root().join("cache"), Path::new(APP), job).unwrap_err();
    assert!(error.contains("integrity"));
    let mut job = fixture.job();
    let path = fixture.root().join("payload.cmd");
    fs::copy(&job.installer, &path).unwrap();
    job.installer = path;
    let error = launch_handoff(&fixture.root().join("cache"), Path::new(APP), job).unwrap_err();
    assert!(error.contains(".exe or .msi"));
    assert_eq!(
        fs::read_dir(fixture.root().join("cache")).unwrap().count(),
        0
    );
}
