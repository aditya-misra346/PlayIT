pub mod capture;

use capture::{
    audio_capabilities, list_audio_inputs, start_capture, stop_capture, CaptureManager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(CaptureManager::new())
        .invoke_handler(tauri::generate_handler![
            audio_capabilities,
            list_audio_inputs,
            start_capture,
            stop_capture,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Auralis desktop application");
}
