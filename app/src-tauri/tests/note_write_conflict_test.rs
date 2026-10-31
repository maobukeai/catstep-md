use app_lib::commands::{write_file_checked_inner, write_file_with_options_inner};
use std::fs;
use std::sync::{Arc, Barrier};

#[test]
fn simultaneous_windows_cannot_both_save_the_same_old_baseline() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("shared.md").to_string_lossy().into_owned();
    fs::write(&path, "baseline").unwrap();
    let barrier = Arc::new(Barrier::new(2));
    let jobs: Vec<_> = ["window A", "window B"]
        .into_iter()
        .map(|content| {
            let path = path.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                let result = write_file_checked_inner(
                    path,
                    content.into(),
                    "UTF-8".into(),
                    Some(false),
                    Some("baseline".into()),
                    false,
                );
                (content, result)
            })
        })
        .collect();
    let results: Vec<_> = jobs.into_iter().map(|job| job.join().unwrap()).collect();
    assert_eq!(
        results.iter().filter(|(_, result)| result.is_ok()).count(),
        1
    );
    let winner = results.iter().find(|(_, result)| result.is_ok()).unwrap().0;
    let loser = results
        .iter()
        .find_map(|(_, result)| result.as_ref().err())
        .unwrap();
    assert!(loser.starts_with("NOTE_CONFLICT:"), "{loser}");
    assert_eq!(fs::read_to_string(path).unwrap(), winner);
}

#[test]
fn expected_missing_never_overwrites_a_newly_created_target() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("new.md").to_string_lossy().into_owned();
    write_file_checked_inner(
        path.clone(),
        "first".into(),
        "UTF-8".into(),
        None,
        None,
        true,
    )
    .unwrap();
    let result = write_file_checked_inner(
        path.clone(),
        "second".into(),
        "UTF-8".into(),
        None,
        None,
        true,
    );
    assert!(result.unwrap_err().starts_with("NOTE_CONFLICT:"));
    assert_eq!(fs::read_to_string(path).unwrap(), "first");
}

#[cfg(windows)]
#[test]
fn expected_missing_windows_unicode_case_aliases_cannot_both_create_the_file() {
    for (first, second) in [("Ä.md", "ä.md"), ("I.md", "ı.md")] {
        let dir = tempfile::tempdir().unwrap();
        let first_path = dir.path().join(first);
        let second_path = dir.path().join(second);
        fs::write(&first_path, "alias probe").unwrap();
        let are_aliases = second_path.exists();
        fs::remove_file(&first_path).unwrap();
        eprintln!("Windows filesystem alias {first}/{second}: {are_aliases}");
        for _ in 0..4 {
            let barrier = Arc::new(Barrier::new(2));
            let jobs: Vec<_> = [first_path.clone(), second_path.clone()]
                .into_iter()
                .enumerate()
                .map(|(i, path)| {
                    let barrier = barrier.clone();
                    std::thread::spawn(move || {
                        let content = format!("window {i}\n").repeat(128 * 1024);
                        barrier.wait();
                        write_file_checked_inner(
                            path.to_string_lossy().into_owned(),
                            content,
                            "UTF-8".into(),
                            Some(false),
                            None,
                            true,
                        )
                    })
                })
                .collect();
            let results: Vec<_> = jobs.into_iter().map(|job| job.join().unwrap()).collect();
            assert_eq!(
                results.iter().filter(|result| result.is_ok()).count(),
                if are_aliases { 1 } else { 2 },
                "both aliases accepted a new-file save: {first}/{second}: {results:?}"
            );
            if are_aliases {
                assert!(results
                    .iter()
                    .find_map(|result| result.as_ref().err())
                    .unwrap()
                    .starts_with("NOTE_CONFLICT:"));
            }
            fs::remove_file(&first_path).unwrap();
            if !are_aliases {
                fs::remove_file(&second_path).unwrap();
            }
        }
    }
}

#[test]
fn deleted_target_is_a_conflict_instead_of_silent_recreation() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("deleted.md").to_string_lossy().into_owned();
    let result = write_file_checked_inner(
        path.clone(),
        "draft".into(),
        "UTF-8".into(),
        None,
        Some("baseline".into()),
        false,
    );
    assert!(result.unwrap_err().starts_with("NOTE_CONFLICT:"));
    assert!(!std::path::Path::new(&path).exists());
}

#[test]
fn compare_and_save_normalizes_crlf_and_decodes_utf16_baselines() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("utf16.md").to_string_lossy().into_owned();
    write_file_with_options_inner(
        path.clone(),
        "中文\r\n😀\r\n".into(),
        "UTF-16LE".into(),
        Some(true),
    )
    .unwrap();
    write_file_checked_inner(
        path.clone(),
        "改稿\r\n😀\r\n".into(),
        "UTF-16LE".into(),
        Some(true),
        Some("中文\n😀\n".into()),
        false,
    )
    .unwrap();
    let result = app_lib::commands::read_file_inner(path).unwrap();
    assert_eq!(result.content, "改稿\r\n😀\r\n");
    assert_eq!(result.encoding, "UTF-16LE");
    assert!(result.had_bom);
}

#[test]
fn compare_and_save_accepts_legacy_carriage_return_lines() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("classic.md").to_string_lossy().into_owned();
    fs::write(&path, "first\rsecond\r").unwrap();
    write_file_checked_inner(
        path.clone(),
        "edited\nsecond\n".into(),
        "UTF-8".into(),
        None,
        Some("first\nsecond\n".into()),
        false,
    )
    .unwrap();
    assert_eq!(fs::read_to_string(path).unwrap(), "edited\nsecond\n");
}

#[test]
fn rename_with_assets_keeps_utf16_encoding_without_reentering_tree_lock() {
    let dir = tempfile::tempdir().unwrap();
    app_lib::commands::path_guard::approve_from_os_drop(dir.path());
    let old = dir.path().join("before.md");
    let new = dir.path().join("after.md");
    let old_assets = dir.path().join("before.assets");
    fs::create_dir(&old_assets).unwrap();
    fs::write(old_assets.join("image.png"), b"image fixture").unwrap();
    write_file_with_options_inner(
        old.to_string_lossy().into_owned(),
        "# 中文😀\n\n![图](before.assets/image.png)\n".into(),
        "UTF-16LE".into(),
        Some(true),
    )
    .unwrap();
    app_lib::commands::fs_rename(
        old.to_string_lossy().into_owned(),
        new.to_string_lossy().into_owned(),
    )
    .unwrap();
    let read = app_lib::commands::read_file_inner(new.to_string_lossy().into_owned()).unwrap();
    assert_eq!(read.encoding, "UTF-16LE");
    assert!(read.had_bom);
    assert_eq!(read.content, "# 中文😀\n\n![图](after.assets/image.png)\n");
    assert!(!old.exists());
    assert!(dir.path().join("after.assets/image.png").is_file());
}

#[cfg(unix)]
#[test]
fn atomic_save_preserves_file_symlink_and_updates_its_target() {
    use std::os::unix::fs::symlink;
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("real.md");
    let alias = dir.path().join("alias.md");
    fs::write(&target, "baseline").unwrap();
    symlink(&target, &alias).unwrap();
    write_file_checked_inner(
        alias.to_string_lossy().into_owned(),
        "edited".into(),
        "UTF-8".into(),
        Some(false),
        Some("baseline".into()),
        false,
    )
    .unwrap();
    assert!(fs::symlink_metadata(&alias)
        .unwrap()
        .file_type()
        .is_symlink());
    assert_eq!(fs::read_to_string(target).unwrap(), "edited");
}
