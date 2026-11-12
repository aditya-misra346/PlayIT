use std::path::PathBuf;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=../macos-helper/screencapture_audio.swift");
    println!("cargo:rerun-if-changed=../scripts/build-macos-helper.sh");

    #[cfg(target_os = "macos")]
    {
        let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
        let script = manifest_dir.join("../scripts/build-macos-helper.sh");
        let bin = manifest_dir.join("binaries/auralis-macos-audio");
        if script.is_file() && !bin.is_file() {
            let _ = Command::new("bash").arg(&script).status();
        }
    }

    tauri_build::build()
}
