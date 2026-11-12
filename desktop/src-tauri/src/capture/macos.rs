#![cfg(target_os = "macos")]

use crate::capture::{
    AudioInputDevice, CaptureDeviceKind, SharedCaptureBuffer, SystemAudioCapability,
};
use std::io::Read;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

pub const MACOS_HELPER_SAMPLE_RATE: u32 = 48_000;

pub struct ActiveMacOSSystemStream {
    child: Arc<Mutex<Option<Child>>>,
    stopped_by_host: Arc<AtomicBool>,
}

impl ActiveMacOSSystemStream {
    pub fn stop(&self) {
        self.stopped_by_host.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

impl Drop for ActiveMacOSSystemStream {
    fn drop(&mut self) {
        self.stop();
    }
}

pub fn locate_helper_binary() -> Option<PathBuf> {
    let arch_suffix = if cfg!(target_arch = "aarch64") {
        "aarch64-apple-darwin"
    } else {
        "x86_64-apple-darwin"
    };
    let bin_names = [
        format!("auralis-macos-audio-{}", arch_suffix),
        "auralis-macos-audio".to_string(),
    ];

    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for name in &bin_names {
                candidates.push(dir.join(name));
                candidates.push(dir.join("../Resources").join(name));
                candidates.push(dir.join("../Resources/binaries").join(name));
            }
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for name in &bin_names {
        candidates.push(manifest_dir.join("binaries").join(name));
    }

    candidates.into_iter().find(|p| p.is_file())
}

pub fn system_audio_capability() -> SystemAudioCapability {
    match locate_helper_binary() {
        Some(_) => SystemAudioCapability {
            supported: true,
            method: "screencapturekit".to_string(),
            reason: None,
        },
        None => SystemAudioCapability {
            supported: false,
            method: "screencapturekit".to_string(),
            reason: Some(
                "macOS ScreenCaptureKit helper binary is missing. Run desktop/scripts/build-macos-helper.sh or switch to Microphone mode.".to_string(),
            ),
        },
    }
}

pub fn list_system_audio_devices() -> Vec<AudioInputDevice> {
    if locate_helper_binary().is_some() {
        vec![AudioInputDevice {
            id: "system:screencapturekit".to_string(),
            name: "macOS System Audio (ScreenCaptureKit)".to_string(),
            is_default: false,
            kind: CaptureDeviceKind::System,
        }]
    } else {
        Vec::new()
    }
}

fn format_permission_help(raw_stderr: &str) -> String {
    let trimmed = raw_stderr.trim();
    if trimmed.is_empty() {
        "macOS Screen & System Audio Recording permission is not granted. Open System Settings > Privacy & Security > Screen & System Audio Recording, enable Auralis, or switch to Microphone mode.".to_string()
    } else {
        trimmed.to_string()
    }
}

pub fn start_system_capture(
    max_seconds: f64,
    buffer: Arc<Mutex<SharedCaptureBuffer>>,
    fatal_error: Arc<AtomicBool>,
    error_message: Arc<Mutex<Option<String>>>,
) -> Result<(ActiveMacOSSystemStream, u32), String> {
    let helper_path = locate_helper_binary().ok_or_else(|| {
        "macOS ScreenCaptureKit helper binary not found. Please build it with desktop/scripts/build-macos-helper.sh or use Microphone mode.".to_string()
    })?;

    {
        let mut guard = buffer.lock().unwrap();
        guard.sample_rate = MACOS_HELPER_SAMPLE_RATE;
    }

    let helper_duration = (max_seconds + 1.5).max(2.0);
    let mut child = Command::new(&helper_path)
        .arg("--duration")
        .arg(format!("{:.2}", helper_duration))
        .arg("--sample-rate")
        .arg(MACOS_HELPER_SAMPLE_RATE.to_string())
        .arg("--channels")
        .arg("1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!(
                "Failed to launch macOS ScreenCaptureKit audio helper ({}): {}",
                helper_path.display(),
                e
            )
        })?;

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to attach stdout pipe to macOS audio helper.".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to attach stderr pipe to macOS audio helper.".to_string())?;

    let stderr_buf = Arc::new(Mutex::new(String::new()));
    let stderr_buf_reader = Arc::clone(&stderr_buf);
    thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        if !s.is_empty() {
            if let Ok(mut guard) = stderr_buf_reader.lock() {
                *guard = s;
            }
        }
    });

    // Give the helper a brief window to check TCC ScreenCaptureKit permissions
    thread::sleep(Duration::from_millis(120));
    if let Ok(Some(status)) = child.try_wait() {
        thread::sleep(Duration::from_millis(25));
        let raw_err = stderr_buf
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default();
        let msg = if status.code() == Some(2) || raw_err.contains("PERMISSION_DENIED") {
            format_permission_help(&raw_err)
        } else {
            format!(
                "macOS system audio helper exited early (code {:?}): {}",
                status.code(),
                format_permission_help(&raw_err)
            )
        };
        return Err(msg);
    }

    let stopped_by_host = Arc::new(AtomicBool::new(false));
    let child_arc = Arc::new(Mutex::new(Some(child)));

    let reader_buf = Arc::clone(&buffer);
    let reader_stopped = Arc::clone(&stopped_by_host);
    let reader_child = Arc::clone(&child_arc);
    let reader_err_flag = Arc::clone(&fatal_error);
    let reader_err_msg = Arc::clone(&error_message);
    let reader_stderr = Arc::clone(&stderr_buf);

    thread::spawn(move || {
        let mut raw = [0_u8; 4096];
        let mut leftover = Vec::<u8>::with_capacity(4);

        loop {
            if reader_stopped.load(Ordering::SeqCst) {
                break;
            }
            match stdout.read(&mut raw) {
                Ok(0) => break,
                Ok(n) => {
                    leftover.extend_from_slice(&raw[..n]);
                    let full_floats = leftover.len() / 4;
                    if full_floats > 0 {
                        let mut samples = Vec::with_capacity(full_floats);
                        for chunk in leftover.chunks_exact(4) {
                            let val = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
                            if val.is_finite() {
                                samples.push(val);
                            } else {
                                samples.push(0.0);
                            }
                        }
                        let consumed = full_floats * 4;
                        leftover.drain(..consumed);

                        if let Ok(mut guard) = reader_buf.lock() {
                            guard.push_samples(&samples);
                        }
                    }
                }
                Err(_) => break,
            }
        }

        if !reader_stopped.load(Ordering::SeqCst) {
            let exit_status = if let Ok(mut guard) = reader_child.lock() {
                guard.as_mut().and_then(|c| c.wait().ok())
            } else {
                None
            };

            if let Some(status) = exit_status {
                if !status.success() {
                    thread::sleep(Duration::from_millis(20));
                    let raw_err = reader_stderr
                        .lock()
                        .map(|g| g.clone())
                        .unwrap_or_default();
                    let msg = format_permission_help(&raw_err);
                    if let Ok(mut guard) = reader_err_msg.lock() {
                        *guard = Some(msg);
                    }
                    reader_err_flag.store(true, Ordering::SeqCst);
                }
            }
        }
    });

    Ok((
        ActiveMacOSSystemStream {
            child: child_arc,
            stopped_by_host,
        },
        MACOS_HELPER_SAMPLE_RATE,
    ))
}
