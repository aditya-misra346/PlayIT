#![cfg(target_os = "linux")]

use crate::capture::mic::{
    build_cpal_capture_stream, select_best_input_config, ActiveCpalStream,
};
use crate::capture::{
    AudioInputDevice, CaptureDeviceKind, SharedCaptureBuffer, SystemAudioCapability,
};
use cpal::traits::{DeviceTrait, HostTrait};
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

pub const PAREC_SAMPLE_RATE: u32 = 48_000;

pub enum ActiveLinuxSystemStream {
    Cpal(ActiveCpalStream),
    Parec {
        child: Arc<Mutex<Option<Child>>>,
        stopped_by_host: Arc<AtomicBool>,
    },
}

impl ActiveLinuxSystemStream {
    pub fn stop(&self) {
        match self {
            Self::Cpal(s) => s.stop(),
            Self::Parec {
                child,
                stopped_by_host,
            } => {
                stopped_by_host.store(true, Ordering::SeqCst);
                if let Ok(mut guard) = child.lock() {
                    if let Some(mut c) = guard.take() {
                        let _ = c.kill();
                        let _ = c.wait();
                    }
                }
            }
        }
    }
}

impl Drop for ActiveLinuxSystemStream {
    fn drop(&mut self) {
        self.stop();
    }
}

fn is_monitor_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.contains("monitor") || lower.contains("loopback")
}

fn has_parec() -> bool {
    Command::new("parec")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

pub fn list_system_audio_devices() -> Vec<AudioInputDevice> {
    let host = cpal::default_host();
    let mut devices = Vec::new();

    if let Ok(inputs) = host.input_devices() {
        for dev in inputs {
            if let Ok(name) = dev.name() {
                if is_monitor_name(&name) {
                    devices.push(AudioInputDevice {
                        id: format!("pulse-monitor:{}", name),
                        name: format!("{} (Monitor)", name),
                        is_default: devices.is_empty(),
                        kind: CaptureDeviceKind::System,
                    });
                }
            }
        }
    }

    if has_parec() {
        devices.push(AudioInputDevice {
            id: "pulse-monitor:@DEFAULT_MONITOR@".to_string(),
            name: "PulseAudio / PipeWire Default Monitor (@DEFAULT_MONITOR@)".to_string(),
            is_default: devices.is_empty(),
            kind: CaptureDeviceKind::System,
        });
    }

    devices
}

pub fn system_audio_capability() -> SystemAudioCapability {
    let devices = list_system_audio_devices();
    if !devices.is_empty() {
        SystemAudioCapability {
            supported: true,
            method: "pulse-monitor".to_string(),
            reason: None,
        }
    } else {
        SystemAudioCapability {
            supported: false,
            method: "pulse-monitor".to_string(),
            reason: Some(
                "No PulseAudio/PipeWire monitor source or `parec` utility found. Install `pulseaudio-utils` (or `pipewire-pulse`) or switch to Microphone mode.".to_string(),
            ),
        }
    }
}

fn start_parec_stream(
    source_name: &str,
    buffer: Arc<Mutex<SharedCaptureBuffer>>,
    fatal_error: Arc<AtomicBool>,
    error_message: Arc<Mutex<Option<String>>>,
) -> Result<(ActiveLinuxSystemStream, u32), String> {
    {
        let mut guard = buffer.lock().unwrap();
        guard.sample_rate = PAREC_SAMPLE_RATE;
    }

    let mut child = Command::new("parec")
        .args([
            "--raw",
            "--format=float32le",
            "--rate=48000",
            "--channels=1",
            source_name,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!(
                "Failed to spawn `parec` for Linux system audio monitor ({}): {}. Switch to Microphone mode if PipeWire/PulseAudio monitor is unavailable.",
                source_name, e
            )
        })?;

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to attach stdout to `parec`.".to_string())?;

    let stopped_by_host = Arc::new(AtomicBool::new(false));
    let child_arc = Arc::new(Mutex::new(Some(child)));

    let reader_buf = Arc::clone(&buffer);
    let reader_stopped = Arc::clone(&stopped_by_host);
    let reader_child = Arc::clone(&child_arc);
    let reader_err = Arc::clone(&fatal_error);
    let reader_msg = Arc::clone(&error_message);

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
                            samples.push(if val.is_finite() { val } else { 0.0 });
                        }
                        leftover.drain(..(full_floats * 4));
                        if let Ok(mut guard) = reader_buf.lock() {
                            guard.push_samples(&samples);
                        }
                    }
                }
                Err(_) => break,
            }
        }

        if !reader_stopped.load(Ordering::SeqCst) {
            let status = reader_child
                .lock()
                .ok()
                .and_then(|mut g| g.as_mut().and_then(|c| c.wait().ok()));
            if let Some(st) = status {
                if !st.success() {
                    if let Ok(mut guard) = reader_msg.lock() {
                        *guard = Some(
                            "PulseAudio/PipeWire monitor capture (`parec`) exited unexpectedly. Switch to Microphone mode."
                                .to_string(),
                        );
                    }
                    reader_err.store(true, Ordering::SeqCst);
                }
            }
        }
    });

    Ok((
        ActiveLinuxSystemStream::Parec {
            child: child_arc,
            stopped_by_host,
        },
        PAREC_SAMPLE_RATE,
    ))
}

pub fn start_system_capture(
    device_id: Option<&str>,
    buffer: Arc<Mutex<SharedCaptureBuffer>>,
    device_lost: Arc<AtomicBool>,
    fatal_error: Arc<AtomicBool>,
    error_message: Arc<Mutex<Option<String>>>,
) -> Result<(ActiveLinuxSystemStream, u32), String> {
    let target = device_id
        .map(|s| s.strip_prefix("pulse-monitor:").unwrap_or(s))
        .unwrap_or("@DEFAULT_MONITOR@");

    if target != "@DEFAULT_MONITOR@" {
        let host = cpal::default_host();
        if let Ok(mut inputs) = host.input_devices() {
            if let Some(dev) = inputs.find(|d| {
                d.name()
                    .ok()
                    .map(|n| n == target || (target == "default" && is_monitor_name(&n)))
                    .unwrap_or(false)
            }) {
                if let Ok((cfg, fmt)) = select_best_input_config(&dev) {
                    let sr = cfg.sample_rate.0;
                    {
                        let mut guard = buffer.lock().unwrap();
                        guard.sample_rate = sr;
                    }
                    if let Ok(stream) = build_cpal_capture_stream(
                        &dev,
                        &cfg,
                        fmt,
                        Arc::clone(&buffer),
                        device_lost,
                        Arc::clone(&error_message),
                    ) {
                        return Ok((ActiveLinuxSystemStream::Cpal(stream), sr));
                    }
                }
            }
        }
    }

    if has_parec() {
        let source = if target.is_empty() || target == "default" {
            "@DEFAULT_MONITOR@"
        } else {
            target
        };
        return start_parec_stream(source, buffer, fatal_error, error_message);
    }

    // Fallback: try any cpal monitor device
    let host = cpal::default_host();
    if let Ok(mut inputs) = host.input_devices() {
        if let Some(dev) = inputs.find(|d| d.name().ok().map(|n| is_monitor_name(&n)).unwrap_or(false))
        {
            let (cfg, fmt) = select_best_input_config(&dev)?;
            let sr = cfg.sample_rate.0;
            {
                let mut guard = buffer.lock().unwrap();
                guard.sample_rate = sr;
            }
            let stream =
                build_cpal_capture_stream(&dev, &cfg, fmt, buffer, device_lost, error_message)?;
            return Ok((ActiveLinuxSystemStream::Cpal(stream), sr));
        }
    }

    Err("Linux system audio capture is unavailable (no PulseAudio/PipeWire monitor source or `parec` found). Please switch to Microphone mode.".to_string())
}
