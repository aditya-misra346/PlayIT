pub mod dsp;
#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "macos")]
pub mod macos;
pub mod mic;
#[cfg(target_os = "windows")]
pub mod windows;

use dsp::{
    compute_live_level, preprocess_and_encode, QualityMetrics, TARGET_SAMPLE_RATE,
};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

pub const EVENT_LEVEL: &str = "auralis://level";
pub const EVENT_CAPTURE_ENDED: &str = "auralis://capture-ended";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemAudioCapability {
    pub supported: bool,
    pub method: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioCapabilities {
    pub microphone: bool,
    pub system: SystemAudioCapability,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CaptureDeviceKind {
    Microphone,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioInputDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub kind: CaptureDeviceKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CaptureMode {
    Microphone,
    System,
}

impl Default for CaptureMode {
    fn default() -> Self {
        Self::Microphone
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartCaptureArgs {
    #[serde(default)]
    pub device_id: Option<String>,
    #[serde(default)]
    pub mode: Option<CaptureMode>,
    #[serde(default)]
    pub max_seconds: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopCaptureArgs {
    #[serde(default)]
    pub cancel: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopCaptureResponse {
    pub wav_base64: String,
    pub duration_ms: u64,
    pub sample_rate: u32,
    pub metrics: QualityMetrics,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LevelEventPayload {
    pub rms: f32,
    pub peak: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureEndedPayload {
    pub reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SharedCaptureBuffer {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub max_samples: usize,
}

impl SharedCaptureBuffer {
    pub fn new(sample_rate: u32, max_seconds: f64) -> Self {
        let cap = ((sample_rate as f64) * (max_seconds + 1.0)).ceil() as usize;
        Self {
            samples: Vec::with_capacity(cap),
            sample_rate,
            max_samples: ((sample_rate as f64) * max_seconds).ceil() as usize,
        }
    }

    pub fn push_samples(&mut self, incoming: &[f32]) {
        if self.max_samples > 0 && self.samples.len() >= self.max_samples {
            return;
        }
        let remaining = if self.max_samples > 0 {
            self.max_samples.saturating_sub(self.samples.len())
        } else {
            incoming.len()
        };
        let take = incoming.len().min(remaining);
        self.samples.extend_from_slice(&incoming[..take]);
    }

    pub fn recent_window(&self, window_ms: u32) -> Vec<f32> {
        let count = ((self.sample_rate as usize) * (window_ms as usize) / 1000).max(1);
        let len = self.samples.len();
        if len == 0 {
            return Vec::new();
        }
        let start = len.saturating_sub(count);
        self.samples[start..].to_vec()
    }
}

pub enum ActiveStreamHandle {
    Microphone(mic::ActiveCpalStream),
    #[cfg(target_os = "macos")]
    MacOSSystem(macos::ActiveMacOSSystemStream),
    #[cfg(target_os = "windows")]
    WindowsSystem(mic::ActiveCpalStream),
    #[cfg(target_os = "linux")]
    LinuxSystem(linux::ActiveLinuxSystemStream),
}

impl ActiveStreamHandle {
    pub fn stop(&self) {
        match self {
            Self::Microphone(s) => s.stop(),
            #[cfg(target_os = "macos")]
            Self::MacOSSystem(s) => s.stop(),
            #[cfg(target_os = "windows")]
            Self::WindowsSystem(s) => s.stop(),
            #[cfg(target_os = "linux")]
            Self::LinuxSystem(s) => s.stop(),
        }
    }
}

pub struct ActiveSession {
    pub stream: ActiveStreamHandle,
    pub buffer: Arc<Mutex<SharedCaptureBuffer>>,
    pub stop_flag: Arc<AtomicBool>,
    pub ended_emitted: Arc<AtomicBool>,
}

pub struct CaptureManager {
    active: Arc<Mutex<Option<ActiveSession>>>,
    last_buffer: Arc<Mutex<Option<SharedCaptureBuffer>>>,
}

impl Default for CaptureManager {
    fn default() -> Self {
        Self::new()
    }
}

impl CaptureManager {
    pub fn new() -> Self {
        Self {
            active: Arc::new(Mutex::new(None)),
            last_buffer: Arc::new(Mutex::new(None)),
        }
    }

    pub fn query_capabilities() -> AudioCapabilities {
        let microphone = mic::has_microphone_support();
        #[cfg(target_os = "macos")]
        let system = macos::system_audio_capability();
        #[cfg(target_os = "windows")]
        let system = windows::system_audio_capability();
        #[cfg(target_os = "linux")]
        let system = linux::system_audio_capability();
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        let system = SystemAudioCapability {
            supported: false,
            method: "none".to_string(),
            reason: Some("System audio capture is not supported on this platform.".to_string()),
        };

        AudioCapabilities {
            microphone: microphone || true, // Always allow attempting microphone capture (triggers OS permission prompt)
            system,
        }
    }

    pub fn list_inputs() -> Vec<AudioInputDevice> {
        let mut list = mic::list_microphone_devices();
        #[cfg(target_os = "macos")]
        list.extend(macos::list_system_audio_devices());
        #[cfg(target_os = "windows")]
        list.extend(windows::list_system_audio_devices());
        #[cfg(target_os = "linux")]
        list.extend(linux::list_system_audio_devices());
        list
    }

    pub fn stop_and_collect(&self, cancel: bool, app: Option<&AppHandle>) -> StopCaptureResponse {
        let session_opt = {
            let mut active_guard = self.active.lock().unwrap();
            active_guard.take()
        };

        let captured_buf = if let Some(session) = session_opt {
            session.stop_flag.store(true, Ordering::SeqCst);
            session.stream.stop();

            if !session.ended_emitted.swap(true, Ordering::SeqCst) {
                if let Some(app_handle) = app {
                    let reason = if cancel { "cancelled" } else { "complete" };
                    let _ = app_handle.emit(
                        EVENT_CAPTURE_ENDED,
                        CaptureEndedPayload {
                            reason: reason.to_string(),
                            message: None,
                        },
                    );
                }
            }

            session.buffer.lock().ok().map(|g| g.clone())
        } else {
            self.last_buffer.lock().unwrap().take()
        };

        // Clear any leftover cached buffer
        {
            let mut last_guard = self.last_buffer.lock().unwrap();
            *last_guard = None;
        }

        if cancel {
            return StopCaptureResponse {
                wav_base64: String::new(),
                duration_ms: 0,
                sample_rate: TARGET_SAMPLE_RATE,
                metrics: QualityMetrics::default(),
            };
        }

        match captured_buf {
            Some(buf) if !buf.samples.is_empty() && buf.sample_rate > 0 => {
                let processed = preprocess_and_encode(&buf.samples, buf.sample_rate);
                StopCaptureResponse {
                    wav_base64: processed.wav_base64,
                    duration_ms: processed.duration_ms,
                    sample_rate: processed.sample_rate,
                    metrics: processed.metrics,
                }
            }
            _ => StopCaptureResponse {
                wav_base64: String::new(),
                duration_ms: 0,
                sample_rate: TARGET_SAMPLE_RATE,
                metrics: QualityMetrics::default(),
            },
        }
    }
}

#[tauri::command]
pub fn audio_capabilities() -> AudioCapabilities {
    CaptureManager::query_capabilities()
}

#[tauri::command]
pub fn list_audio_inputs() -> Vec<AudioInputDevice> {
    CaptureManager::list_inputs()
}

#[tauri::command]
pub async fn start_capture(
    app: AppHandle,
    state: State<'_, CaptureManager>,
    args: Option<StartCaptureArgs>,
    device_id: Option<String>,
    mode: Option<CaptureMode>,
    max_seconds: Option<f64>,
) -> Result<(), String> {
    // Stop any previous capture cleanly first
    {
        let _ = state.stop_and_collect(true, None);
    }

    let resolved_device_id = args
        .as_ref()
        .and_then(|a| a.device_id.clone())
        .or(device_id);
    let resolved_mode = args
        .as_ref()
        .and_then(|a| a.mode)
        .or(mode)
        .unwrap_or(CaptureMode::Microphone);
    let resolved_max_seconds = args
        .as_ref()
        .and_then(|a| a.max_seconds)
        .or(max_seconds)
        .unwrap_or(10.0)
        .clamp(0.5, 12.0);

    let buffer = Arc::new(Mutex::new(SharedCaptureBuffer::new(
        48_000,
        resolved_max_seconds,
    )));
    let device_lost = Arc::new(AtomicBool::new(false));
    let fatal_error = Arc::new(AtomicBool::new(false));
    let error_message = Arc::new(Mutex::new(None::<String>));

    let start_result: Result<(ActiveStreamHandle, u32), String> = match resolved_mode {
        CaptureMode::Microphone => mic::start_microphone_capture(
            resolved_device_id.as_deref(),
            Arc::clone(&buffer),
            Arc::clone(&device_lost),
            Arc::clone(&error_message),
        )
        .map(|(s, sr)| (ActiveStreamHandle::Microphone(s), sr)),

        CaptureMode::System => {
            #[cfg(target_os = "macos")]
            {
                macos::start_system_capture(
                    resolved_max_seconds,
                    Arc::clone(&buffer),
                    Arc::clone(&fatal_error),
                    Arc::clone(&error_message),
                )
                .map(|(s, sr)| (ActiveStreamHandle::MacOSSystem(s), sr))
            }
            #[cfg(target_os = "windows")]
            {
                windows::start_system_capture(
                    resolved_device_id.as_deref(),
                    Arc::clone(&buffer),
                    Arc::clone(&device_lost),
                    Arc::clone(&error_message),
                )
                .map(|(s, sr)| (ActiveStreamHandle::WindowsSystem(s), sr))
            }
            #[cfg(target_os = "linux")]
            {
                linux::start_system_capture(
                    resolved_device_id.as_deref(),
                    Arc::clone(&buffer),
                    Arc::clone(&device_lost),
                    Arc::clone(&fatal_error),
                    Arc::clone(&error_message),
                )
                .map(|(s, sr)| (ActiveStreamHandle::LinuxSystem(s), sr))
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
            {
                Err("System audio capture is not supported on this platform.".to_string())
            }
        }
    };

    let (stream_handle, actual_sample_rate) = match start_result {
        Ok(pair) => pair,
        Err(err_msg) => {
            let _ = app.emit(
                EVENT_CAPTURE_ENDED,
                CaptureEndedPayload {
                    reason: "error".to_string(),
                    message: Some(err_msg.clone()),
                },
            );
            return Err(err_msg);
        }
    };

    {
        let mut guard = buffer.lock().unwrap();
        guard.sample_rate = actual_sample_rate;
        guard.max_samples = ((actual_sample_rate as f64) * resolved_max_seconds).ceil() as usize;
    }

    let stop_flag = Arc::new(AtomicBool::new(false));
    let ended_emitted = Arc::new(AtomicBool::new(false));

    {
        let mut active_guard = state.active.lock().unwrap();
        *active_guard = Some(ActiveSession {
            stream: stream_handle,
            buffer: Arc::clone(&buffer),
            stop_flag: Arc::clone(&stop_flag),
            ended_emitted: Arc::clone(&ended_emitted),
        });
    }

    let sup_active = Arc::clone(&state.active);
    let sup_last_buf = Arc::clone(&state.last_buffer);
    let sup_buf = Arc::clone(&buffer);
    let sup_stop = Arc::clone(&stop_flag);
    let sup_ended = Arc::clone(&ended_emitted);
    let sup_lost = Arc::clone(&device_lost);
    let sup_fatal = Arc::clone(&fatal_error);
    let sup_err_msg = Arc::clone(&error_message);
    let sup_app = app.clone();

    thread::spawn(move || {
        let started_at = Instant::now();
        let max_dur = Duration::from_secs_f64(resolved_max_seconds);
        let tick = Duration::from_millis(50); // ~20 Hz level emission

        loop {
            thread::sleep(tick);
            if sup_stop.load(Ordering::SeqCst) {
                break;
            }

            if sup_lost.load(Ordering::SeqCst) {
                let msg = sup_err_msg.lock().ok().and_then(|g| g.clone()).or_else(|| {
                    Some("Audio input device was disconnected or lost.".to_string())
                });
                if let Ok(mut guard) = sup_active.lock() {
                    if let Some(sess) = guard.take() {
                        sess.stream.stop();
                    }
                }
                if !sup_ended.swap(true, Ordering::SeqCst) {
                    let _ = sup_app.emit(
                        EVENT_CAPTURE_ENDED,
                        CaptureEndedPayload {
                            reason: "device_lost".to_string(),
                            message: msg,
                        },
                    );
                }
                break;
            }

            if sup_fatal.load(Ordering::SeqCst) {
                let msg = sup_err_msg.lock().ok().and_then(|g| g.clone()).or_else(|| {
                    Some("Audio capture encountered an unexpected error.".to_string())
                });
                if let Ok(mut guard) = sup_active.lock() {
                    if let Some(sess) = guard.take() {
                        sess.stream.stop();
                    }
                }
                if !sup_ended.swap(true, Ordering::SeqCst) {
                    let _ = sup_app.emit(
                        EVENT_CAPTURE_ENDED,
                        CaptureEndedPayload {
                            reason: "error".to_string(),
                            message: msg,
                        },
                    );
                }
                break;
            }

            // Emit live ~20 Hz level reading from the most recent ~50 ms window
            let (window, reached_max_samples) = {
                if let Ok(guard) = sup_buf.lock() {
                    let w = guard.recent_window(50);
                    let full =
                        guard.max_samples > 0 && guard.samples.len() >= guard.max_samples;
                    (w, full)
                } else {
                    (Vec::new(), false)
                }
            };

            let (rms, peak) = compute_live_level(&window);
            let _ = sup_app.emit(EVENT_LEVEL, LevelEventPayload { rms, peak });

            if started_at.elapsed() >= max_dur || reached_max_samples {
                // Save buffer so subsequent stop_capture({ cancel: false }) can retrieve it
                if let Ok(buf_guard) = sup_buf.lock() {
                    if let Ok(mut last_guard) = sup_last_buf.lock() {
                        *last_guard = Some(buf_guard.clone());
                    }
                }
                if let Ok(mut guard) = sup_active.lock() {
                    if let Some(sess) = guard.take() {
                        sess.stream.stop();
                    }
                }
                if !sup_ended.swap(true, Ordering::SeqCst) {
                    let _ = sup_app.emit(
                        EVENT_CAPTURE_ENDED,
                        CaptureEndedPayload {
                            reason: "complete".to_string(),
                            message: None,
                        },
                    );
                }
                break;
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_capture(
    app: AppHandle,
    state: State<'_, CaptureManager>,
    args: Option<StopCaptureArgs>,
    cancel: Option<bool>,
) -> Result<StopCaptureResponse, String> {
    let resolved_cancel = args
        .as_ref()
        .and_then(|a| a.cancel)
        .or(cancel)
        .unwrap_or(false);
    Ok(state.stop_and_collect(resolved_cancel, Some(&app)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::PI;

    #[test]
    fn test_audio_capabilities_contract_shape() {
        let caps = audio_capabilities();
        let json = serde_json::to_value(&caps).expect("serialize capabilities");
        assert!(json.get("microphone").unwrap().is_boolean());
        let sys = json.get("system").unwrap();
        assert!(sys.get("supported").unwrap().is_boolean());
        let method = sys.get("method").unwrap().as_str().unwrap();
        assert!(
            ["wasapi-loopback", "screencapturekit", "pulse-monitor", "none"].contains(&method),
            "Unexpected method: {}",
            method
        );
    }

    #[test]
    fn test_list_audio_inputs_contract_shape() {
        let inputs = list_audio_inputs();
        let json = serde_json::to_value(&inputs).expect("serialize inputs");
        assert!(json.is_array());
        for item in json.as_array().unwrap() {
            assert!(item.get("id").unwrap().is_string());
            assert!(item.get("name").unwrap().is_string());
            assert!(item.get("isDefault").unwrap().is_boolean());
            let kind = item.get("kind").unwrap().as_str().unwrap();
            assert!(kind == "microphone" || kind == "system");
        }
    }

    #[test]
    fn test_stop_capture_cancel_and_complete_flow() {
        let manager = CaptureManager::new();
        let sr = 48_000_u32;
        let mut buf = SharedCaptureBuffer::new(sr, 2.0);
        let samples: Vec<f32> = (0..(sr as usize))
            .map(|i| 0.35 * ((2.0 * PI * 440.0 * (i as f64) / (sr as f64)).sin() as f32))
            .collect();
        buf.push_samples(&samples);

        {
            let mut last = manager.last_buffer.lock().unwrap();
            *last = Some(buf.clone());
        }

        // Non-cancelled stop encodes 16 kHz mono PCM16 WAV in base64
        let resp = manager.stop_and_collect(false, None);
        assert!(!resp.wav_base64.is_empty());
        assert_eq!(resp.sample_rate, 16_000);
        assert!(resp.duration_ms >= 990 && resp.duration_ms <= 1010);
        assert!(resp.metrics.rms_dbfs > -20.0);

        // Cancelled stop returns empty wavBase64
        {
            let mut last = manager.last_buffer.lock().unwrap();
            *last = Some(buf);
        }
        let cancelled = manager.stop_and_collect(true, None);
        assert!(cancelled.wav_base64.is_empty());
        assert_eq!(cancelled.sample_rate, 16_000);
    }
}
