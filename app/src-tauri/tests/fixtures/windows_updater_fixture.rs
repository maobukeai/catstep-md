// Harmless process fixture. No registry, installation or application data I/O.
#![windows_subsystem = "windows"]
use std::{env, fs, path::PathBuf, process, thread, time::Duration};
fn main() {
    let exe = env::current_exe().unwrap();
    let role = exe.file_stem().unwrap().to_string_lossy();
    let root = if role == "installer" {
        PathBuf::from(fs::read_to_string(env::current_dir().unwrap().join("control-root")).unwrap())
    } else {
        exe.parent().unwrap().to_path_buf()
    };
    match role.as_ref() {
        "parent" => {
            fs::write(root.join("parent.ready"), b"ready").unwrap();
            for _ in 0..1000 {
                if root.join("parent.release").exists() {
                    break;
                }
                thread::sleep(Duration::from_millis(20));
            }
            fs::write(root.join("parent.exiting"), b"still running").unwrap();
            thread::sleep(Duration::from_millis(400));
            fs::write(root.join("parent.ended"), b"last operation before exit").unwrap();
        }
        "installer" => {
            assert!(
                root.join("parent.ended").exists(),
                "installer ran before parent finished"
            );
            fs::write(root.join("installer.started"), b"started").unwrap();
            fs::write(
                root.join("installer.args"),
                format!("{:?}", env::args_os().collect::<Vec<_>>()),
            )
            .unwrap();
            let code = fs::read_to_string(root.join("installer.exit"))
                .unwrap_or_else(|_| "0".into())
                .parse::<i32>()
                .unwrap();
            thread::sleep(Duration::from_millis(100));
            fs::write(root.join("installer.finished"), code.to_string()).unwrap();
            process::exit(code);
        }
        "restart" => {
            assert!(
                root.join("installer.finished").exists(),
                "restart preceded installer completion"
            );
            fs::write(
                root.join("restart.marker"),
                b"restart after successful installer",
            )
            .unwrap();
        }
        _ => process::exit(97),
    }
}
