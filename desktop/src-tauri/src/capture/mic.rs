use crate::capture::{
    dsp::downmix_to_mono, AudioInputDevice, CaptureDeviceKind, SharedCaptureBuffer,
};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, SampleFormat, StreamConfig};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

pub struct ActiveCpalStream {
    stream: cpal::Stream,
}

// Required so ActiveCpalStream can be managed inside a Mutex on the Tauri state;
// the stream is only created, paused, and dropped under the capture manager lock.
unsafe impl Send for ActiveCpalStream {}

impl ActiveCpalStream {
    pub fn stop(&self) {
        let _ = self.stream.pause();
    }
}

pub fn list_microphone_devices() -> Vec<AudioInputDevice> {
    let host = cpal::default_host();
    let default_name = host
        .default_input_device()
        .and_then(|d| d.name().ok());

    let mut devices = Vec::new();
    if let Ok(input_devices) = host.input_devices() {
        for (idx, dev) in input_devices.enumerate() {
            let name = dev
                .name()
                .unwrap_or_else(|_| format!("Microphone {}", idx + 1));
            let is_default = default_name
                .as_ref()
                .map(|dn| dn == &name)
                .unwrap_or(idx == 0);
            devices.push(AudioInputDevice {
                id: format!("mic:{}", name),
                name,
                is_default,
                kind: CaptureDeviceKind::Microphone,
            });
        }
    }
    devices
}

pub fn has_microphone_support() -> bool {
    let host = cpal::default_host();
    if host.default_input_device().is_some() {
        return true;
    }
    host.input_devices()
        .map(|mut it| it.next().is_some())
        .unwrap_or(false)
}

fn select_input_device(device_id: Option<&str>) -> Result<Device, String> {
    let host = cpal::default_host();
    if let Some(id) = device_id {
        let trimmed = id.strip_prefix("mic:").unwrap_or(id);
        if !trimmed.is_empty() && trimmed != "default" {
            if let Ok(mut devices) = host.input_devices() {
                if let Some(found) = devices.find(|d| d.name().ok().as_deref() == Some(trimmed)) {
                    return Ok(found);
                }
            }
        }
    }
    host.default_input_device().ok_or_else(|| {
        "No microphone input device found. Connect a microphone or check system audio settings."
            .to_string()
    })
}

pub fn select_best_input_config(
    device: &Device,
) -> Result<(StreamConfig, SampleFormat), String> {
    let preferred_rates = [48_000_u32, 44_100, 16_000, 32_000];
    if let Ok(ranges) = device.supported_input_configs() {
        let collected: Vec<_> = ranges.collect();
        for &rate in &preferred_rates {
            let sr = cpal::SampleRate(rate);
            if let Some(range) = collected.iter().find(|r| {
                r.min_sample_rate() <= sr
                    && sr <= r.max_sample_rate()
                    && r.sample_format() == SampleFormat::F32
            }) {
                let cfg = range.with_sample_rate(sr);
                return Ok((cfg.config(), cfg.sample_format()));
            }
        }
        for &rate in &preferred_rates {
            let sr = cpal::SampleRate(rate);
            if let Some(range) = collected
                .iter()
                .find(|r| r.min_sample_rate() <= sr && sr <= r.max_sample_rate())
            {
                let cfg = range.with_sample_rate(sr);
                return Ok((cfg.config(), cfg.sample_format()));
            }
        }
    }

    let default_cfg = device
        .default_input_config()
        .map_err(|e| format!("Failed to query default input config: {}", e))?;
    Ok((default_cfg.config(), default_cfg.sample_format()))
}

pub fn build_cpal_capture_stream(
    device: &Device,
    config: &StreamConfig,
    sample_format: SampleFormat,
    buffer: Arc<Mutex<SharedCaptureBuffer>>,
    device_lost: Arc<AtomicBool>,
    error_message: Arc<Mutex<Option<String>>>,
) -> Result<ActiveCpalStream, String> {
    let channels = (config.channels as usize).max(1);
    let err_lost = Arc::clone(&device_lost);
    let err_msg = Arc::clone(&error_message);

    let err_fn = move |err: cpal::StreamError| {
        let mut guard = err_msg.lock().unwrap();
        *guard = Some(format!("Audio input device error or disconnected: {}", err));
        err_lost.store(true, Ordering::SeqCst);
    };

    let stream = match sample_format {
        SampleFormat::F32 => {
            let buf = Arc::clone(&buffer);
            device
                .build_input_stream(
                    config,
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        let mono = downmix_to_mono(data, channels);
                        if let Ok(mut guard) = buf.lock() {
                            guard.push_samples(&mono);
                        }
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("Failed to open F32 audio stream: {}", e))?
        }
        SampleFormat::I16 => {
            let buf = Arc::clone(&buffer);
            device
                .build_input_stream(
                    config,
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        let floats: Vec<f32> =
                            data.iter().map(|&x| (x as f32) / 32768.0).collect();
                        let mono = downmix_to_mono(&floats, channels);
                        if let Ok(mut guard) = buf.lock() {
                            guard.push_samples(&mono);
                        }
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("Failed to open I16 audio stream: {}", e))?
        }
        SampleFormat::U16 => {
            let buf = Arc::clone(&buffer);
            device
                .build_input_stream(
                    config,
                    move |data: &[u16], _: &cpal::InputCallbackInfo| {
                        let floats: Vec<f32> = data
                            .iter()
                            .map(|&x| ((x as f32) - 32768.0) / 32768.0)
                            .collect();
                        let mono = downmix_to_mono(&floats, channels);
                        if let Ok(mut guard) = buf.lock() {
                            guard.push_samples(&mono);
                        }
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("Failed to open U16 audio stream: {}", e))?
        }
        SampleFormat::I32 => {
            let buf = Arc::clone(&buffer);
            device
                .build_input_stream(
                    config,
                    move |data: &[i32], _: &cpal::InputCallbackInfo| {
                        let floats: Vec<f32> =
                            data.iter().map(|&x| (x as f32) / 2_147_483_648.0).collect();
                        let mono = downmix_to_mono(&floats, channels);
                        if let Ok(mut guard) = buf.lock() {
                            guard.push_samples(&mono);
                        }
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("Failed to open I32 audio stream: {}", e))?
        }
        other => {
            return Err(format!("Unsupported device sample format: {:?}", other));
        }
    };

    stream
        .play()
        .map_err(|e| format!("Failed to start audio input stream: {}", e))?;

    Ok(ActiveCpalStream { stream })
}

pub fn start_microphone_capture(
    device_id: Option<&str>,
    buffer: Arc<Mutex<SharedCaptureBuffer>>,
    device_lost: Arc<AtomicBool>,
    error_message: Arc<Mutex<Option<String>>>,
) -> Result<(ActiveCpalStream, u32), String> {
    let device = select_input_device(device_id)?;
    let (config, sample_format) = select_best_input_config(&device)?;
    let sample_rate = config.sample_rate.0;
    {
        let mut guard = buffer.lock().unwrap();
        guard.sample_rate = sample_rate;
    }
    let stream = build_cpal_capture_stream(
        &device,
        &config,
        sample_format,
        buffer,
        device_lost,
        error_message,
    )?;
    Ok((stream, sample_rate))
}
