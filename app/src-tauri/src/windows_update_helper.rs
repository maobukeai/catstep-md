//! Windows update handoff. Paths are process arguments, never shell source.
//!
//! This mode runs before Tauri (including its single-instance plugin), from a
//! cache copy of the executable so it does not lock the installation being
//! replaced. Only a ready helper permits the original application to exit.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::windows::ffi::OsStrExt;
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::rc::Rc;
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
use windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW;
use windows_sys::Win32::System::Threading::{
    GetExitCodeProcess, OpenProcess, WaitForSingleObject, INFINITE, PROCESS_SYNCHRONIZE,
};

pub const HELPER_FLAG: &str = "--catstep-update-helper";
const CREATE_NO_WINDOW: u32 = 0x08000000;
const DETACHED_PROCESS: u32 = 0x00000008;
const READY_TIMEOUT: Duration = Duration::from_secs(15);
const PARENT_EXIT_TIMEOUT_MS: u32 = 120_000;

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateJob {
    pub version: u32,
    pub parent_pid: u32,
    pub installer: PathBuf,
    pub restart_exe: PathBuf,
    pub expected_sha256: String,
    pub silent: bool,
    pub ready_token: String,
    pub show_error_dialog: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateResult {
    pub status: String,
    pub installer_exit_code: Option<i32>,
    pub restart_pid: Option<u32>,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct ReadySignal {
    token: String,
    parent_pid: u32,
    helper_pid: u32,
}

struct ProcessHandle(HANDLE);
impl Drop for ProcessHandle {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0) };
    }
}

fn sha256(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| format!("open installer: {e}"))?;
    file_sha256(&mut file)
}

fn file_sha256(file: &mut File) -> Result<String, String> {
    file.seek(SeekFrom::Start(0))
        .map_err(|e| format!("seek payload: {e}"))?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|e| format!("hash installer: {e}"))?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(hex::encode(hash.finalize()))
}

fn lock_executable(path: &Path) -> Result<File, String> {
    // FILE_SHARE_READ only: allow the loader/installer to read, deny writes,
    // deletion, rename and replacement until the actual child has finished.
    OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(path)
        .map_err(|e| format!("lock update payload {}: {e}", path.display()))
}

fn verify_job(job: &UpdateJob) -> Result<(), String> {
    if job.version != 1
        || job.parent_pid == 0
        || !job.installer.is_absolute()
        || !job.restart_exe.is_absolute()
        || !job.restart_exe.is_file()
        || job.expected_sha256.len() != 64
        || !job.expected_sha256.bytes().all(|c| c.is_ascii_hexdigit())
        || job.ready_token.len() != 32
        || !job.ready_token.bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Err("invalid Windows update handoff".into());
    }
    let extension = job
        .installer
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    if !extension.eq_ignore_ascii_case("exe") && !extension.eq_ignore_ascii_case("msi") {
        return Err("Windows updates require an .exe or .msi installer".into());
    }
    if !sha256(&job.installer)?.eq_ignore_ascii_case(&job.expected_sha256) {
        return Err(
            "Installer integrity check FAILED during update handoff; nothing was executed".into(),
        );
    }
    Ok(())
}

/// Prepare an isolated copy, recheck its digest and wait for the child to hold
/// the parent's actual process handle. A PID-only sleep cannot guarantee this.
pub fn launch_handoff(cache: &Path, app_exe: &Path, mut job: UpdateJob) -> Result<PathBuf, String> {
    verify_job(&job)?;
    let directory = cache.join(format!("handoff-{:032x}", rand::random::<u128>()));
    fs::create_dir(&directory).map_err(|e| format!("create update handoff: {e}"))?;
    let extension = job.installer.extension().unwrap();
    let installer = directory.join(Path::new("installer").with_extension(extension));
    fs::copy(&job.installer, &installer).map_err(|e| format!("stage installer: {e}"))?;
    job.installer = installer;
    verify_job(&job)?;
    let helper = directory.join("CatstepMD-update-helper.exe");
    let mut source_lock = lock_executable(app_exe)?;
    let source_digest = file_sha256(&mut source_lock)?;
    fs::copy(app_exe, &helper).map_err(|e| format!("prepare update helper: {e}"))?;
    let mut helper_lock = lock_executable(&helper)?;
    if file_sha256(&mut helper_lock)? != source_digest {
        return Err(
            "Update helper integrity check failed; the application will remain open".into(),
        );
    }
    let job_path = directory.join("job.json");
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&job_path)
        .map_err(|e| format!("create update job: {e}"))?;
    let job_bytes = serde_json::to_vec(&job).map_err(|e| e.to_string())?;
    let job_digest = hex::encode(Sha256::digest(&job_bytes));
    file.write_all(&job_bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("write update job: {e}"))?;
    drop(file);
    let log = File::create(directory.join("helper.log")).map_err(|e| e.to_string())?;
    // The job's digest travels in the process arguments, outside writable
    // WebView files. Read/verify/snapshot it once in the child before parsing.
    let mut child = Command::new(&helper)
        .arg(HELPER_FLAG)
        .arg(&job_path)
        .arg(job_digest)
        .current_dir(&directory)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?))
        .stderr(Stdio::from(log))
        .creation_flags(DETACHED_PROCESS | CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("launch update helper: {e}"))?;
    let deadline = Instant::now() + READY_TIMEOUT;
    loop {
        let ready = fs::read(directory.join("ready"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<ReadySignal>(&bytes).ok());
        if ready.is_some_and(|ready| {
            ready.token == job.ready_token
                && ready.parent_pid == job.parent_pid
                && ready.helper_pid == child.id()
        }) {
            return Ok(directory);
        }
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            let details = fs::read_to_string(directory.join("result.json")).unwrap_or_default();
            return Err(format!(
                "Update helper exited before ready ({status}): {details}"
            ));
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(
                "Update helper did not become ready; the application will remain open".into(),
            );
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// Resolve the system MSI engine without PATH/current-directory lookup.
fn system_msiexec() -> Result<PathBuf, String> {
    let mut buffer = vec![0u16; 32768];
    let length = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
    if length == 0 || length >= buffer.len() {
        return Err(format!(
            "locate Windows Installer: {}",
            std::io::Error::last_os_error()
        ));
    }
    use std::os::windows::ffi::OsStringExt;
    Ok(PathBuf::from(std::ffi::OsString::from_wide(&buffer[..length])).join("msiexec.exe"))
}

#[derive(Debug, PartialEq)]
struct MsiRestartIdentity {
    product: String,
    component: String,
}

struct MsiModule(windows_sys::Win32::Foundation::HMODULE);
impl Drop for MsiModule {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::FreeLibrary(self.0);
        }
    }
}

type MsiOpenDatabase = unsafe extern "system" fn(*const u16, *const u16, *mut u32) -> u32;
type MsiOpenView = unsafe extern "system" fn(u32, *const u16, *mut u32) -> u32;
type MsiExecute = unsafe extern "system" fn(u32, u32) -> u32;
type MsiFetch = unsafe extern "system" fn(u32, *mut u32) -> u32;
type MsiGetString = unsafe extern "system" fn(u32, u32, *mut u16, *mut u32) -> u32;
type MsiGetPath = unsafe extern "system" fn(*const u16, *const u16, *mut u16, *mut u32) -> i32;
type MsiClose = unsafe extern "system" fn(u32) -> u32;

// Windows Installer is needed only for MSI metadata/restart. Resolve its
// system APIs on demand, without adding a startup DLL dependency. Every native
// database/view/record retains this module until its handle has been closed.
struct MsiApi {
    _module: MsiModule,
    open_database: MsiOpenDatabase,
    open_view: MsiOpenView,
    execute: MsiExecute,
    fetch: MsiFetch,
    get_string: MsiGetString,
    get_path: MsiGetPath,
    close: MsiClose,
    #[cfg(test)]
    commit: MsiClose,
}
impl MsiApi {
    fn load() -> Result<Rc<Self>, String> {
        use windows_sys::Win32::System::LibraryLoader::{
            GetProcAddress, LoadLibraryExW, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR,
            LOAD_LIBRARY_SEARCH_SYSTEM32,
        };
        let library = system_msiexec()?.with_file_name("msi.dll");
        let path: Vec<_> = library.as_os_str().encode_wide().chain(Some(0)).collect();
        let module = MsiModule(unsafe {
            LoadLibraryExW(
                path.as_ptr(),
                std::ptr::null_mut(),
                LOAD_LIBRARY_SEARCH_SYSTEM32 | LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR,
            )
        });
        if module.0.is_null() {
            return Err(format!(
                "Load system Windows Installer: {}",
                std::io::Error::last_os_error()
            ));
        }
        macro_rules! load {
            ($name:literal, $ty:ty) => {{
                let pointer = unsafe { GetProcAddress(module.0, concat!($name, "\0").as_ptr()) }
                    .ok_or_else(|| format!("System Windows Installer is missing {}", $name))?;
                unsafe { std::mem::transmute::<unsafe extern "system" fn() -> isize, $ty>(pointer) }
            }};
        }
        Ok(Rc::new(Self {
            open_database: load!("MsiOpenDatabaseW", MsiOpenDatabase),
            open_view: load!("MsiDatabaseOpenViewW", MsiOpenView),
            execute: load!("MsiViewExecute", MsiExecute),
            fetch: load!("MsiViewFetch", MsiFetch),
            get_string: load!("MsiRecordGetStringW", MsiGetString),
            get_path: load!("MsiGetComponentPathW", MsiGetPath),
            close: load!("MsiCloseHandle", MsiClose),
            #[cfg(test)]
            commit: load!("MsiDatabaseCommit", MsiClose),
            _module: module,
        }))
    }
}

struct MsiHandle(u32, Rc<MsiApi>);
impl Drop for MsiHandle {
    fn drop(&mut self) {
        unsafe {
            (self.1.close)(self.0);
        }
    }
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}

fn msi_rows(database: &MsiHandle, query: &str, fields: u32) -> Result<Vec<Vec<String>>, String> {
    let api = &database.1;
    let mut handle = 0;
    let code = unsafe { (api.open_view)(database.0, wide(query).as_ptr(), &mut handle) };
    if code != 0 {
        return Err(format!("MSI restart metadata query failed ({code})"));
    }
    let view = MsiHandle(handle, api.clone());
    let code = unsafe { (api.execute)(view.0, 0) };
    if code != 0 {
        return Err(format!("MSI restart metadata execution failed ({code})"));
    }
    let mut rows = Vec::new();
    loop {
        let mut record = 0;
        let code = unsafe { (api.fetch)(view.0, &mut record) };
        if code == 259 {
            break;
        } // ERROR_NO_MORE_ITEMS
        if code != 0 {
            return Err(format!("MSI restart metadata fetch failed ({code})"));
        }
        let record = MsiHandle(record, api.clone());
        let mut row = Vec::new();
        for field in 1..=fields {
            let mut length = 0;
            let code =
                unsafe { (api.get_string)(record.0, field, std::ptr::null_mut(), &mut length) };
            if !matches!(code, 0 | 234) || length > 32767 {
                return Err("Invalid MSI restart metadata string".into());
            }
            let mut buffer = vec![0u16; length as usize + 1];
            length = buffer.len() as u32;
            let code =
                unsafe { (api.get_string)(record.0, field, buffer.as_mut_ptr(), &mut length) };
            if code != 0 {
                return Err(format!("MSI restart metadata string failed ({code})"));
            }
            row.push(
                String::from_utf16(&buffer[..length as usize])
                    .map_err(|_| "Invalid MSI restart metadata encoding")?,
            );
        }
        rows.push(row);
    }
    Ok(rows)
}

/// Read only the verified, deny-write/delete locked MSI. Component resolution
/// must use its product identity too: x64 and ARM64 can share a component GUID.
fn read_msi_restart_identity(path: &Path) -> Result<MsiRestartIdentity, String> {
    use windows_sys::Win32::System::ApplicationInstallationAndServicing::MSIDBOPEN_READONLY;
    let api = MsiApi::load()?;
    let path: Vec<_> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut database = 0;
    let code = unsafe { (api.open_database)(path.as_ptr(), MSIDBOPEN_READONLY, &mut database) };
    if code != 0 {
        return Err(format!(
            "Cannot read verified MSI restart metadata ({code}); no application was restarted"
        ));
    }
    let database = MsiHandle(database, api);
    let products = msi_rows(
        &database,
        "SELECT `Value` FROM `Property` WHERE `Property` = 'ProductCode'",
        1,
    )?;
    let [product] = products.as_slice() else {
        return Err("MSI must identify exactly one ProductCode".into());
    };
    let files = msi_rows(
        &database,
        "SELECT `File`, `Component_`, `FileName` FROM `File`",
        3,
    )?;
    let candidates: Vec<_> = files
        .iter()
        .filter(|row| {
            row[2]
                .rsplit('|')
                .next()
                .is_some_and(|s| s.eq_ignore_ascii_case("CatstepMD.exe"))
        })
        .collect();
    let [file] = candidates.as_slice() else {
        return Err("MSI must identify exactly one CatstepMD.exe file".into());
    };
    let components = msi_rows(
        &database,
        "SELECT `Component`, `ComponentId`, `KeyPath` FROM `Component`",
        3,
    )?;
    let candidates: Vec<_> = components
        .iter()
        .filter(|row| row[0] == file[1] && row[2] == file[0] && !row[1].is_empty())
        .collect();
    let [component] = candidates.as_slice() else {
        return Err("MSI CatstepMD.exe must be the component's unique file key path".into());
    };
    if product[0].is_empty() {
        return Err("MSI ProductCode is empty".into());
    }
    Ok(MsiRestartIdentity {
        product: product[0].clone(),
        component: component[1].clone(),
    })
}

fn installed_component_path(identity: &MsiRestartIdentity) -> Result<PathBuf, String> {
    use windows_sys::Win32::System::ApplicationInstallationAndServicing::INSTALLSTATE_LOCAL;
    let api = MsiApi::load()?;
    let product = wide(&identity.product);
    let component = wide(&identity.component);
    let mut buffer = vec![0u16; 32768];
    let mut length = buffer.len() as u32;
    let state = unsafe {
        (api.get_path)(
            product.as_ptr(),
            component.as_ptr(),
            buffer.as_mut_ptr(),
            &mut length,
        )
    };
    if state != INSTALLSTATE_LOCAL || length as usize >= buffer.len() {
        return Err(format!("MSI installation succeeded but its installed CatstepMD.exe could not be located (state {state}); the old copy was not restarted"));
    }
    use std::os::windows::ffi::OsStringExt;
    Ok(PathBuf::from(std::ffi::OsString::from_wide(
        &buffer[..length as usize],
    )))
}

fn restart_target_with(
    original: &Path,
    identity: Option<&MsiRestartIdentity>,
    lookup: impl FnOnce(&MsiRestartIdentity) -> Result<PathBuf, String>,
) -> Result<PathBuf, String> {
    let Some(identity) = identity else {
        return Ok(original.to_path_buf());
    };
    let installed = lookup(identity)?;
    if !installed.is_absolute()
        || !installed.is_file()
        || !installed
            .file_name()
            .is_some_and(|s| s.eq_ignore_ascii_case("CatstepMD.exe"))
    {
        return Err("MSI did not resolve an existing absolute CatstepMD.exe; the old copy was not restarted".into());
    }
    Ok(installed)
}

fn installer_command(job: &UpdateJob, directory: &Path) -> Result<Command, String> {
    let msi = job
        .installer
        .extension()
        .is_some_and(|s| s.eq_ignore_ascii_case("msi"));
    let engine = if msi { Some(system_msiexec()?) } else { None };
    build_installer_command(job, directory, engine.as_deref())
}

fn build_installer_command(
    job: &UpdateJob,
    directory: &Path,
    msi_engine: Option<&Path>,
) -> Result<Command, String> {
    let mut command = if let Some(engine) = msi_engine {
        let mut command = Command::new(engine);
        command
            .arg("/i")
            .arg(&job.installer)
            // Keep a passive MSI UI: quiet mode can prevent an unprivileged
            // install from obtaining its required administrator consent.
            .arg("/passive")
            .arg("/norestart")
            .arg("/L*V")
            .arg(directory.join("msi.log"));
        command
    } else {
        let mut command = Command::new(&job.installer);
        if job.silent {
            command.arg("/S");
        }
        command
    };
    let log = File::create(directory.join("installer.log")).map_err(|e| e.to_string())?;
    command
        .current_dir(directory)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?))
        .stderr(Stdio::from(log))
        .creation_flags(CREATE_NO_WINDOW);
    Ok(command)
}

// ShellExecute's lpParameters uses the executable's Windows argv parser, not
// cmd.exe. Quote every argument and escape quotes/trailing backslashes using
// the CRT convention. %, &, ! and ^ are literal data here.
fn shell_parameters(command: &Command) -> Vec<u16> {
    let mut parameters = Vec::new();
    for argument in command.get_args() {
        if !parameters.is_empty() {
            parameters.push(b' ' as u16);
        }
        parameters.push(b'"' as u16);
        let mut slashes = 0;
        for ch in argument.encode_wide() {
            if ch == b'\\' as u16 {
                slashes += 1;
                continue;
            }
            if ch == b'"' as u16 {
                parameters.extend(std::iter::repeat_n(b'\\' as u16, slashes * 2 + 1));
            } else {
                parameters.extend(std::iter::repeat_n(b'\\' as u16, slashes));
            }
            slashes = 0;
            parameters.push(ch);
        }
        parameters.extend(std::iter::repeat_n(b'\\' as u16, slashes * 2));
        parameters.push(b'"' as u16);
    }
    parameters.push(0);
    parameters
}

fn run_shell_installer(command: &Command, show: i32) -> Result<i32, String> {
    use windows_sys::Win32::System::Com::{
        CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
    };
    use windows_sys::Win32::UI::Shell::{
        ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS,
        SHELLEXECUTEINFOW,
    };
    struct Com(bool);
    impl Drop for Com {
        fn drop(&mut self) {
            if self.0 {
                unsafe {
                    CoUninitialize();
                }
            }
        }
    }
    let hr = unsafe {
        CoInitializeEx(
            std::ptr::null(),
            (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32,
        )
    };
    let _com = Com(hr >= 0);
    let program: Vec<_> = command.get_program().encode_wide().chain(Some(0)).collect();
    let parameters = shell_parameters(command);
    let directory: Vec<_> = command
        .get_current_dir()
        .ok_or("installer has no working directory")?
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let open: Vec<_> = "open".encode_utf16().chain(Some(0)).collect();
    let runas: Vec<_> = "runas".encode_utf16().chain(Some(0)).collect();
    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
    info.lpVerb = open.as_ptr();
    info.lpFile = program.as_ptr();
    info.lpParameters = parameters.as_ptr();
    info.lpDirectory = directory.as_ptr();
    info.nShow = show;
    let mut launched = unsafe { ShellExecuteExW(&mut info) } != 0;
    if !launched && std::io::Error::last_os_error().raw_os_error() == Some(740) {
        // Request consent through Windows; cancellation remains a real failure.
        info.lpVerb = runas.as_ptr();
        launched = unsafe { ShellExecuteExW(&mut info) } != 0;
    }
    if !launched {
        return Err(format!(
            "start installer (Windows consent may have been cancelled): {}",
            std::io::Error::last_os_error()
        ));
    }
    if info.hProcess.is_null() {
        return Err("Installer did not return a waitable process handle".into());
    }
    let process = ProcessHandle(info.hProcess);
    if unsafe { WaitForSingleObject(process.0, INFINITE) } != WAIT_OBJECT_0 {
        return Err(format!(
            "wait for installer: {}",
            std::io::Error::last_os_error()
        ));
    }
    let mut code = 0u32;
    if unsafe { GetExitCodeProcess(process.0, &mut code) } == 0 {
        return Err(format!(
            "read installer exit code: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(code as i32)
}

fn execute_job(job_path: &Path, job: &UpdateJob) -> Result<UpdateResult, String> {
    let directory = job_path.parent().ok_or("update job has no directory")?;
    let mut installer_lock = lock_executable(&job.installer)?;
    verify_job(job)?;
    if !file_sha256(&mut installer_lock)?.eq_ignore_ascii_case(&job.expected_sha256) {
        return Err(
            "Installer integrity check FAILED on locked payload; nothing was executed".into(),
        );
    }
    let msi = job
        .installer
        .extension()
        .is_some_and(|s| s.eq_ignore_ascii_case("msi"));
    let msi_restart = if msi {
        Some(read_msi_restart_identity(&job.installer)?)
    } else {
        None
    };
    let parent = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, job.parent_pid) };
    if parent.is_null() {
        return Err(format!(
            "open original application process: {}",
            std::io::Error::last_os_error()
        ));
    }
    let parent = ProcessHandle(parent);
    let ready = ReadySignal {
        token: job.ready_token.clone(),
        parent_pid: job.parent_pid,
        helper_pid: std::process::id(),
    };
    fs::write(
        directory.join("ready"),
        serde_json::to_vec(&ready).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if unsafe { WaitForSingleObject(parent.0, PARENT_EXIT_TIMEOUT_MS) } != WAIT_OBJECT_0 {
        return Err("Original application did not exit; installer was not started".into());
    }
    // The original cache file can be overwritten by a later download. This
    // immutable staging copy is checked again immediately before execution.
    verify_job(job)?;
    if !file_sha256(&mut installer_lock)?.eq_ignore_ascii_case(&job.expected_sha256) {
        return Err(
            "Installer integrity check FAILED on locked payload; nothing was executed".into(),
        );
    }
    let command = installer_command(job, directory)?;
    let code = Some(run_shell_installer(
        &command,
        windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL,
    )?);
    drop(installer_lock);
    if let Ok(mut log) = OpenOptions::new()
        .append(true)
        .open(directory.join("installer.log"))
    {
        let _ = writeln!(log, "installer exit code: {code:?}");
    }
    let success = code == Some(0) || (msi && matches!(code, Some(3010 | 1641)));
    if !success {
        return Ok(UpdateResult {
            status: "failed".into(),
            installer_exit_code: code,
            restart_pid: None,
            error: Some(format!(
                "Installer failed (exit code {code:?}); the application was not restarted. See {}",
                directory.display()
            )),
        });
    }
    // 1641 means Windows Installer already initiated a reboot; do not race it.
    let restart_pid = if code == Some(1641) {
        None
    } else {
        let restart_exe = restart_target_with(
            &job.restart_exe,
            msi_restart.as_ref(),
            installed_component_path,
        )?;
        Some(
            Command::new(&restart_exe)
                .current_dir(restart_exe.parent().unwrap())
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| format!("Installation succeeded but restart failed: {e}"))?
                .id(),
        )
    };
    Ok(UpdateResult {
        status: if code == Some(1641) {
            "reboot_initiated"
        } else {
            "installed"
        }
        .into(),
        installer_exit_code: code,
        restart_pid,
        error: None,
    })
}

/// Return before desktop setup/initial-file parsing, including on malformed
/// helper arguments. Never fall through to the normal application on error.
pub fn dispatch_requested() -> Option<i32> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.first().is_none_or(|s| s != HELPER_FLAG) {
        return None;
    }
    if args.len() != 3 {
        return Some(2);
    }
    let job_path = Path::new(&args[1]);
    let parsed = (|| -> Result<UpdateJob, String> {
        let bytes = fs::read(job_path).map_err(|e| e.to_string())?;
        let expected = args[2].to_str().ok_or("invalid update job digest")?;
        if !hex::encode(Sha256::digest(&bytes)).eq_ignore_ascii_case(expected) {
            return Err("Update handoff integrity check failed; nothing was executed".into());
        }
        serde_json::from_slice(&bytes).map_err(|e| format!("invalid update job: {e}"))
    })();
    let show_error_dialog = parsed.as_ref().is_ok_and(|j| j.show_error_dialog);
    let result = parsed
        .and_then(|job| execute_job(job_path, &job))
        .unwrap_or_else(|error| UpdateResult {
            status: "failed".into(),
            installer_exit_code: None,
            restart_pid: None,
            error: Some(error),
        });
    let success = result.error.is_none();
    if let Some(directory) = job_path.parent() {
        if let Ok(bytes) = serde_json::to_vec_pretty(&result) {
            let _ = fs::write(directory.join("result.json"), bytes);
        }
    }
    if let Some(error) = result.error {
        eprintln!("[updater] {error}");
        // Before ready, the original app still owns error reporting. After it
        // exited, show an actionable error rather than silently disappearing.
        if show_error_dialog && job_path.parent().is_some_and(|p| p.join("ready").is_file()) {
            use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
            let message = format!(
                "{error}\n\nUpdate log: {}",
                job_path.parent().unwrap().display()
            );
            let message: Vec<u16> = message.encode_utf16().chain(Some(0)).collect();
            let title: Vec<u16> = "CatstepMD".encode_utf16().chain(Some(0)).collect();
            unsafe {
                MessageBoxW(
                    std::ptr::null_mut(),
                    message.as_ptr(),
                    title.as_ptr(),
                    MB_OK | MB_ICONERROR,
                );
            }
        }
    }
    Some(if success { 0 } else { 1 })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn synthetic_msi(
        directory: &Path,
        key_path: &str,
        duplicate_exe: bool,
    ) -> (PathBuf, MsiRestartIdentity) {
        use windows_sys::Win32::System::ApplicationInstallationAndServicing::MSIDBOPEN_CREATE;
        let api = MsiApi::load().unwrap();
        let path = directory.join("synthetic 中文 metadata.msi");
        let identity = MsiRestartIdentity {
            product: format!(
                "{{{:08X}-1234-4321-ABCD-123456789012}}",
                rand::random::<u32>()
            ),
            component: format!(
                "{{{:08X}-2345-5432-BCDE-234567890123}}",
                rand::random::<u32>()
            ),
        };
        let mut database = 0;
        let filename: Vec<_> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        assert_eq!(
            unsafe { (api.open_database)(filename.as_ptr(), MSIDBOPEN_CREATE, &mut database) },
            0
        );
        let database = MsiHandle(database, api.clone());
        let mut statements = vec![
            "CREATE TABLE `Property` (`Property` CHAR(72) NOT NULL, `Value` CHAR(72) PRIMARY KEY `Property`)".into(),
            "CREATE TABLE `File` (`File` CHAR(72) NOT NULL, `Component_` CHAR(72) NOT NULL, `FileName` CHAR(255) NOT NULL PRIMARY KEY `File`)".into(),
            "CREATE TABLE `Component` (`Component` CHAR(72) NOT NULL, `ComponentId` CHAR(38), `KeyPath` CHAR(72) PRIMARY KEY `Component`)".into(),
            format!("INSERT INTO `Property` (`Property`, `Value`) VALUES ('ProductCode', '{}')", identity.product),
            "INSERT INTO `File` (`File`, `Component_`, `FileName`) VALUES ('MainFile', 'MainComponent', 'short.exe|CatstepMD.exe')".into(),
            format!("INSERT INTO `Component` (`Component`, `ComponentId`, `KeyPath`) VALUES ('MainComponent', '{}', '{key_path}')", identity.component),
        ];
        if duplicate_exe {
            statements.push("INSERT INTO `File` (`File`, `Component_`, `FileName`) VALUES ('Duplicate', 'OtherComponent', 'CatstepMD.exe')".into());
        }
        for sql in statements {
            let mut view = 0;
            assert_eq!(
                unsafe { (api.open_view)(database.0, wide(&sql).as_ptr(), &mut view) },
                0,
                "{sql}"
            );
            let view = MsiHandle(view, api.clone());
            assert_eq!(unsafe { (api.execute)(view.0, 0) }, 0, "{sql}");
        }
        assert_eq!(unsafe { (api.commit)(database.0) }, 0);
        drop(database);
        (path, identity)
    }

    #[test]
    fn locked_native_msi_database_resolves_short_long_exe_and_component_identity() {
        let directory = tempfile::tempdir().unwrap();
        let (path, expected) = synthetic_msi(directory.path(), "MainFile", false);
        let mut locked = lock_executable(&path).unwrap();
        let digest = file_sha256(&mut locked).unwrap();
        assert_eq!(read_msi_restart_identity(&path).unwrap(), expected);
        assert_eq!(
            file_sha256(&mut locked).unwrap(),
            digest,
            "read-only MSI query changed the database"
        );
        assert_eq!(
            fs::write(&path, b"no write").unwrap_err().raw_os_error(),
            Some(32)
        );
    }

    #[test]
    fn msi_restart_uses_installed_target_and_never_falls_back_to_old_portable() {
        let directory = tempfile::tempdir().unwrap();
        let (path, expected) = synthetic_msi(directory.path(), "MainFile", false);
        let _locked = lock_executable(&path).unwrap();
        let identity = read_msi_restart_identity(&path).unwrap();
        let portable = directory.path().join("old-portable.exe");
        fs::write(&portable, b"old fixture").unwrap();
        let installed = directory.path().join("new install 中文");
        fs::create_dir(&installed).unwrap();
        let installed = installed.join("CatstepMD.exe");
        fs::write(&installed, b"new fixture").unwrap();
        let chosen = restart_target_with(&portable, Some(&identity), |i| {
            assert_eq!(i, &expected);
            Ok(installed.clone())
        })
        .unwrap();
        assert_eq!(chosen, installed);
        assert_ne!(chosen, portable);
        assert!(
            restart_target_with(&portable, Some(&identity), |_| Err("not registered".into()))
                .is_err()
        );
        assert!(
            restart_target_with(&portable, Some(&identity), |_| Ok(directory
                .path()
                .join("missing.exe")))
            .is_err()
        );
        // Real MSI API, strictly our newly generated and unregistered product /
        // component GUIDs. No registration, installation or existing key query.
        assert!(installed_component_path(&identity).is_err());
        assert_eq!(
            restart_target_with(&portable, None, |_| panic!(
                "EXE must keep its existing route"
            ))
            .unwrap(),
            portable
        );
    }

    #[test]
    fn msi_metadata_rejects_ambiguous_exe_and_non_file_component_key_path() {
        for (key_path, duplicate, expected_error) in [
            ("MainFile", true, "exactly one CatstepMD.exe"),
            ("RegistryKey", false, "file key path"),
        ] {
            let directory = tempfile::tempdir().unwrap();
            let (path, _) = synthetic_msi(directory.path(), key_path, duplicate);
            let _locked = lock_executable(&path).unwrap();
            assert!(read_msi_restart_identity(&path)
                .unwrap_err()
                .contains(expected_error));
        }
    }

    #[test]
    fn msi_arguments_reach_a_real_process_without_shell_expansion() {
        let directory = tempfile::Builder::new()
            .prefix("catstep MSI 中文 & %CATSTEP_LITERAL% ")
            .tempdir()
            .unwrap();
        let source = directory.path().join("fixture.rs");
        let engine = directory.path().join("engine.exe");
        fs::write(&source, r#"#![windows_subsystem = "windows"]
        fn main() {
            let exe = std::env::current_exe().unwrap();
            let args: Vec<_> = std::env::args().skip(1).collect();
            std::fs::write(exe.parent().unwrap().join("actual-args.json"), args.join("\n")).unwrap();
        }"#).unwrap();
        assert!(Command::new("rustc")
            .args(["--crate-name", "msi_argument_fixture"])
            .arg(source)
            .arg("-o")
            .arg(&engine)
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .unwrap()
            .success());
        let job = UpdateJob {
            version: 1,
            parent_pid: std::process::id(),
            installer: directory.path().join("quoted space 中文 & %PATH% !.msi"),
            restart_exe: engine.clone(),
            expected_sha256: "0".repeat(64),
            silent: true,
            ready_token: "a".repeat(32),
            show_error_dialog: false,
        };
        let mut command = build_installer_command(&job, directory.path(), Some(&engine)).unwrap();
        command
            .arg("literal \"quote\" and trailing\\")
            .arg("")
            .arg("%PATH% & !^()");
        assert_eq!(run_shell_installer(&command, 0).unwrap(), 0);
        let actual = fs::read_to_string(directory.path().join("actual-args.json")).unwrap();
        assert_eq!(
            actual.split('\n').collect::<Vec<_>>(),
            [
                "/i",
                job.installer.to_str().unwrap(),
                "/passive",
                "/norestart",
                "/L*V",
                directory.path().join("msi.log").to_str().unwrap(),
                "literal \"quote\" and trailing\\",
                "",
                "%PATH% & !^()"
            ]
        );
        let system = system_msiexec().unwrap();
        assert!(system.is_absolute() && system.is_file());
    }
}
