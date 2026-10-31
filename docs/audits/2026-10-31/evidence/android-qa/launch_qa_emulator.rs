#![windows_subsystem = "windows"]

// Fixed Android QA launcher, not a shell or an automation client.
// No arguments, arbitrary executable paths, ADB, input injection or installers.
use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::net::TcpListener;
use std::os::windows::fs::MetadataExt;
use std::os::windows::process::CommandExt;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

const SDK: &str = r"C:\Users\20269\AppData\Local\Android\Sdk";
const QA: &str = r"C:\Users\20269\AppData\Local\Temp\catstep-android-d11-qa-20261031";
const AVD_NAME: &str = "catstep_qa_d11_20261031_isolated";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const REPARSE_POINT: u32 = 0x400;

fn ordinary(path: &Path, directory: bool) -> io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_attributes() & REPARSE_POINT != 0
        || metadata.file_type().is_symlink()
        || metadata.is_dir() != directory
        || (!directory && !metadata.is_file())
    {
        return Err(io::Error::other(format!("Non-ordinary QA path refused: {}", path.display())));
    }
    Ok(())
}

fn ordinary_ancestors(path: &Path) -> io::Result<()> {
    let mut cursor = PathBuf::new();
    for component in path.components() {
        cursor.push(component);
        if !matches!(component, Component::Prefix(_) | Component::RootDir) {
            ordinary(&cursor, true)?;
        }
    }
    Ok(())
}

fn ordinary_tree(directory: &Path) -> io::Result<()> {
    ordinary(directory, true)?;
    for entry in fs::read_dir(directory)? {
        let path = entry?.path();
        let metadata = fs::symlink_metadata(&path)?;
        ordinary(&path, metadata.is_dir())?;
        if metadata.is_dir() { ordinary_tree(&path)?; }
    }
    Ok(())
}

fn value<'a>(ini: &'a str, key: &str) -> Option<&'a str> {
    ini.lines().find_map(|line| {
        let (candidate, value) = line.split_once('=')?;
        (candidate.trim() == key).then_some(value.trim())
    })
}

fn append_log(root: &Path, filename: &str) -> io::Result<File> {
    ordinary_ancestors(root)?;
    let path = root.join(filename);
    if path.exists() { ordinary(&path, false)?; }
    OpenOptions::new().create(true).append(true).open(path)
}

fn record(log: &mut File, message: &str) -> io::Result<()> {
    let seconds = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    writeln!(log, "{seconds}: {message}")?;
    log.flush()
}

fn verify_qa(sdk: &Path, qa: &Path) -> io::Result<(PathBuf, PathBuf, PathBuf)> {
    ordinary_ancestors(sdk)?;
    ordinary_ancestors(qa)?;
    let user = qa.join("android-user");
    let avds = user.join("avd");
    let avd = avds.join(format!("{AVD_NAME}.avd"));
    ordinary_ancestors(&avd)?;
    ordinary_tree(&avd)?;
    let canonical_qa = fs::canonicalize(qa)?;
    let canonical_avd = fs::canonicalize(&avd)?;
    if !canonical_avd.starts_with(&canonical_qa)
        || canonical_avd.to_string_lossy().to_ascii_lowercase().contains("maobu_test")
    {
        return Err(io::Error::other("QA AVD escaped its dedicated root"));
    }
    let pointer = avds.join(format!("{AVD_NAME}.ini"));
    ordinary(&pointer, false)?;
    let ini = fs::read_to_string(pointer)?;
    let target = value(&ini, "path").ok_or_else(|| io::Error::other("QA INI has no path"))?;
    if fs::canonicalize(target)? != canonical_avd || value(&ini, "target") != Some("android-34") {
        return Err(io::Error::other("QA INI does not select the fixed isolated Android 34 AVD"));
    }
    let config_path = avd.join("config.ini");
    ordinary(&config_path, false)?;
    ordinary(&avd.join("userdata.img"), false)?;
    let config = fs::read_to_string(config_path)?;
    if config.to_ascii_lowercase().contains("maobu_test")
        || value(&config, "abi.type") != Some("x86_64")
        || value(&config, "image.sysdir.1") != Some(r"system-images\android-34\default\x86_64\")
    {
        return Err(io::Error::other("QA config identity or system image differs from the reviewed fixture"));
    }
    ordinary_ancestors(&sdk.join("system-images/android-34/default/x86_64"))?;
    for line in config.lines() {
        let Some((key, candidate)) = line.split_once('=') else { continue; };
        let candidate = candidate.trim();
        if !key.trim().ends_with(".path") || candidate.is_empty() || candidate == "<temp>" { continue; }
        let path = Path::new(candidate);
        if path.components().any(|part| matches!(part, Component::ParentDir)) {
            return Err(io::Error::other("Parent traversal in QA config path"));
        }
        let resolved = if path.is_absolute() { path.to_path_buf() } else { avd.join(path) };
        if !resolved.starts_with(&avd) && !resolved.starts_with(&canonical_avd) {
            return Err(io::Error::other("Writable QA config path points outside its AVD"));
        }
    }
    Ok((user, avds, avd))
}

fn launch(log: &mut File) -> io::Result<()> {
    if std::env::args_os().len() != 1 {
        return Err(io::Error::other("This fixed launcher accepts no command-line arguments"));
    }
    let sdk = Path::new(SDK);
    let qa = Path::new(QA);
    let (user, avds, avd) = verify_qa(sdk, qa)?;
    let emulator_dir = sdk.join("emulator");
    ordinary_ancestors(&emulator_dir)?;
    let emulator = emulator_dir.join("emulator.exe");
    ordinary(&emulator, false)?;
    let dll_dirs = [emulator_dir.join("lib64/qt/lib"), emulator_dir.join("lib64")];
    for directory in &dll_dirs { ordinary_ancestors(directory)?; }
    let mut path_parts = dll_dirs.to_vec();
    path_parts.extend(std::env::split_paths(&std::env::var_os("PATH").unwrap_or_else(OsString::new)));
    let child_path = std::env::join_paths(path_parts).map_err(io::Error::other)?;
    let stdout = append_log(qa, "emulator-stdout.log")?;
    let stderr = append_log(qa, "emulator-stderr.log")?;
    // Check both loopback families and retain the reservations until spawn.
    // The emulator itself remains authoritative if another process wins the
    // short handoff race; there is no fallback port or alternate AVD.
    let mut reservations = Vec::new();
    for address in ["127.0.0.1:5580", "127.0.0.1:5581", "[::1]:5580", "[::1]:5581"] {
        reservations.push(TcpListener::bind(address).map_err(|error| {
            io::Error::other(format!("Fixed QA port unavailable ({address}): {error}"))
        })?);
    }
    record(log, &format!("Preflight passed; launching only {} / {AVD_NAME} / {}", emulator.display(), avd.display()))?;
    let mut command = Command::new(&emulator);
    command.args(["-avd", AVD_NAME, "-no-snapshot", "-no-metrics", "-port", "5580", "-datadir"])
        .arg(&avd)
        .current_dir(&emulator_dir)
        .env("ANDROID_USER_HOME", &user)
        .env("ANDROID_AVD_HOME", &avds)
        .env("ANDROID_EMULATOR_HOME", &user)
        .env("ANDROID_HOME", sdk)
        .env("ANDROID_SDK_ROOT", sdk)
        .env("PATH", child_path)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .creation_flags(CREATE_NO_WINDOW);
    drop(reservations);
    let mut child = command.spawn()?;
    record(log, &format!("Official emulator child PID {}", child.id()))?;
    let status = child.wait()?;
    record(log, &format!("Official emulator exited: {status}"))?;
    Ok(())
}

fn main() {
    // No console, popups, retries, fallback commands or automatic installation.
    // Any failure is recorded only inside the already-reviewed QA directory.
    let Ok(mut log) = append_log(Path::new(QA), "emulator-launcher.log") else { return; };
    if let Err(error) = launch(&mut log) {
        let _ = record(&mut log, &format!("REFUSED/FAILED: {error}"));
        std::process::exit(2);
    }
}
