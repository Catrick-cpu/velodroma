/// Velodroma desktop shell (Tauri v2).
/// Serves the bundled web build; all game logic runs client-side, so rides
/// work offline. Social features hit the hosted API when reachable.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Velodroma");
}
