// Standalone, harmless reproduction: rustc old_cmd_repro.rs -o old_cmd_repro.exe
// No installer, GUI, user configuration or existing installation is touched.
use std::{env, fs, process::Command};
fn main() {
    let args: Vec<_> = env::args_os().collect();
    if args.get(1).is_some_and(|s| s == "--fixture") {
        fs::write(&args[2], b"fixture executed").unwrap();
        return;
    }
    let directory = env::temp_dir().join(format!("catstep-updater-quote-{} 中文 space & percent%", std::process::id()));
    fs::create_dir_all(&directory).unwrap();
    let fixture = directory.join("harmless fixture.exe");
    fs::copy(env::current_exe().unwrap(), &fixture).unwrap();
    let marker = directory.join("old.marker");
    // /B suppresses START's window; /D suppresses any user's Command Processor
    // AutoRun. The quoted START command and Rust .arg(script) are the old code.
    let script = format!("start \"\" /B /wait \"{}\" --fixture \"{}\"", fixture.display(), marker.display());
    let output = Command::new("cmd.exe").arg("/D").arg("/C").arg(&script).output().unwrap();
    println!("old_script={script}");
    println!("old_cmd_exit={:?}; fixture_executed={}", output.status.code(), marker.exists());
    fs::write(directory.join("old-cmd-stderr.bin"), &output.stderr).unwrap();
    println!("stderr_bytes={:?}", output.stderr);
    let direct_marker = directory.join("direct.marker");
    let direct = Command::new(&fixture).arg("--fixture").arg(&direct_marker).status().unwrap();
    println!("direct_exit={:?}; fixture_executed={}", direct.code(), direct_marker.exists());
    println!("fixture_directory={}", directory.display());
    assert!(!marker.exists(), "old quoting unexpectedly worked on this Windows/Rust toolchain");
    assert!(direct.success() && direct_marker.exists());
}
