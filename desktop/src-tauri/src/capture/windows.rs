#![cfg(target_os = "windows")]

use crate::capture::mic::{build_cpal_capture_stream, ActiveCpalStream};
use crate::capture::{
    AudioInputDevice, CaptureDeviceKind, SharedCaptureBuffer, SystemAudioCapability,
};
use cpal::traits::{DeviceTrait, HostTrait};
use cpal::{Device, SampleFormat, StreamConfig};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

pub const WINDOWS_DRM_NOTE: &str =
    "Note: DRM-protected streams may produce silence during WASAPI loopback capture; fallback to Microphone mode is always available.";

pub fn system_audio_capability() -> SystemAudioCapability {
    let host = cpal::default_host();
    let has_output = host.default_output_device().is_some()
        || host
            .output_devices()
            .map(|mut it| it.next().is_some())
            .unwrap_or(false);

    if has_output {
        SystemAudioCapability {
            supported: true,
            method: "wasapi-loopback".to_string(),
            reason: Some(WINDOWS_DRM_NOTE.to_string()),
        }
    } else {
        SystemAudioCapability {
            supported: false,
            method: "wasapi-loopback".to_string(),
            reason: Some(
                "No WASAPI audio output device available for loopback capture. Switch to Microphone mode."
                    .to_string(),
            ),
        }
    }
}

pub fn list_system_audio_devices() -> Vec<AudioInputDevice> {
    let host = cpal::default_host();
    let default_name = host
        .default_output_device()
        .and_then(|d| d.name().ok());

    let mut devices = Vec::new();
    if let Ok(outputs) = host.output_devices() {
        for (idx, dev) in outputs.enumerate() {
            let name = dev
                .name()
                .unwrap_or_else(|_| format!("System Output {}", idx + 1));
            let is_default = default_name
                .as_ref()
                .map(|dn| dn == &name)
                .unwrap_or(idx == 0);
            devices.push(AudioInputDevice {
                id: format!("wasapi-loopback:{}", name),
                name: format!("{} (WASAPI Loopback)", name),
                is_default,
                kind: CaptureDeviceKind::System,
            });
        }
    }
    devices
}

fn select_loopback_device(device_id: Option<&str>) -> Result<Device, String> {
    let host = cpal::default_host();
    if let Some(id) = device_id {
        let stripped = id.strip_prefix("wasapi-loopback:").unwrap_or(id);
        if !stripped.is_empty() && stripped != "default" {
            if let Ok(mut outputs) = host.output_devices() {
                if let Some(found) = outputs.find(|d| d.name().ok().as_deref() == Some(stripped)) {
                    return Ok(found);
                }
            }
        }
    }

    host.default_output_device().ok_or_else(|| {
        format!(
            "No active Windows WASAPI output device found for loopback capture. {}",
            WINDOWS_DRM_NOTE
        )
    })
}

fn select_loopback_config(device: &Device) -> Result<(StreamConfig, SampleFormat), String> {
    let default_cfg = device.default_output_config().map_err(|e| {
        format!(
            "Failed to query WASAPI loopback output config: {}. {}",
            e, WINDOWS_DRM_NOTE
        )
    })?;
    Ok((default_cfg.config(), default_cfg.sample_format()))
}

pub fn start_system_capture(
    device_id: Option<&str>,
    buffer: Arc<Mutex<SharedCaptureBuffer>>,
    device_lost: Arc<AtomicBool>,
    error_message: Arc<Mutex<Option<String>>>,
) -> Result<(ActiveCpalStream, u32), String> {
    let device = select_loopback_device(device_id)?;
    let (config, sample_format) = select_loopback_config(&device)?;
    let sample_rate = config.sample_rate.0;
    {
        let mut guard = buffer.lock().unwrap();
        guard.sample_rate = sample_rate;
    }

    build_cpal_capture_stream(
        &device,
        &config,
        sample_format,
        buffer,
        device_lost,
        error_message,
    )
    .map(|stream| (stream, sample_rate))
    .map_err(|e| format!("{} ({})", e, WINDOWS_DRM_NOTE))
}
