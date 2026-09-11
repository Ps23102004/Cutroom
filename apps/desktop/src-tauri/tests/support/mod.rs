#![allow(dead_code)] // Shared helpers are compiled independently by each integration test crate.

use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
};

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

pub struct TestDirectory {
    path: PathBuf,
}

impl TestDirectory {
    pub fn new() -> Self {
        let root = std::env::temp_dir();
        for _ in 0..128 {
            let sequence = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = root.join(format!(
                "cutroom-tauri-test-{}-{sequence}",
                std::process::id()
            ));
            match fs::create_dir(&path) {
                Ok(()) => return Self { path },
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => panic!("create test directory: {error}"),
            }
        }
        panic!("could not allocate Tauri test directory");
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

pub fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../tests/fixtures")
        .join(name)
}

pub fn fixture_a() -> PathBuf {
    fixture("fixture_a.mp4")
}

pub fn fixture_b() -> PathBuf {
    fixture("fixture_b.mp4")
}

pub fn sha256(path: &Path) -> String {
    let output = Command::new("shasum")
        .args(["-a", "256"])
        .arg(path)
        .output()
        .unwrap();
    assert!(output.status.success());
    String::from_utf8(output.stdout)
        .unwrap()
        .split_whitespace()
        .next()
        .unwrap()
        .to_owned()
}

pub fn assert_fixture_hashes() {
    assert_eq!(
        sha256(&fixture_a()),
        "06e35e744a729825b664fc938485d840307755bcc44a60cd3f47f362555bcccb"
    );
    assert_eq!(
        sha256(&fixture_b()),
        "5bcb5af63d409cd5f9a46c849867315b83fc9377e5ddab31ac70295ad6654560"
    );
}
