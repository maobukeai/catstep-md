use std::{fs, sync::{Arc, Barrier}, time::{SystemTime, UNIX_EPOCH}};
use app_lib::commands::write_file_checked_inner;
fn main() {
    let dir = std::env::temp_dir().join(format!("catstep-unicode-cas-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
    fs::create_dir(&dir).unwrap();
    let upper = dir.join("Ä.md");
    let lower = dir.join("ä.md");
    fs::write(&upper, "probe").unwrap();
    assert!(lower.exists(), "requires the ordinary Windows case-insensitive filesystem");
    fs::remove_file(&upper).unwrap();
    for attempt in 0..8 {
        let barrier = Arc::new(Barrier::new(2));
        let mut jobs=Vec::new();
        for (path, byte) in [(upper.clone(), 'A'), (lower.clone(), 'B')] {
            let barrier=barrier.clone();
            jobs.push(std::thread::spawn(move || {
                let text=byte.to_string().repeat(1024*1024);
                barrier.wait();
                write_file_checked_inner(path.to_string_lossy().into_owned(), text, "UTF-8".into(), Some(false), None, true)
            }));
        }
        let results:Vec<_>=jobs.into_iter().map(|j|j.join().unwrap()).collect();
        let successes=results.iter().filter(|r|r.is_ok()).count();
        println!("attempt={attempt}; success_count={successes}; errors={:?}", results.iter().filter_map(|r|r.as_ref().err()).collect::<Vec<_>>());
        fs::remove_file(&upper).unwrap();
        if successes==2 { fs::remove_dir(&dir).unwrap(); return; }
    }
    fs::remove_dir(&dir).unwrap();
}
