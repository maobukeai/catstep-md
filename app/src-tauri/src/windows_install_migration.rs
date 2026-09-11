//! Windows installation migration module.
//!
//! Catstep MD (猫步 MD) is an independent application.
//! It must NEVER touch, inspect, migrate, or uninstall SoloMD installations.

pub fn migrate_legacy_nsis_install() {
    // Explicit No-Op: Catstep MD never touches or uninstalls SoloMD.
}

pub fn remove_stale_taskbar_pins() {
    // Explicit No-Op: Catstep MD does not modify taskbar shortcuts of other apps.
}

