// "Set as default Markdown editor" — one-click cross-platform implementation.
//
// Each platform has its own OS-level mechanism:
//   - macOS   → LSSetDefaultRoleHandlerForContentType (LaunchServices)
//   - Windows → HKCU\Software\Classes\... + SystemFileAssociations + RegisteredApplications + SHChangeNotify
//   - Linux   → xdg-mime default CatstepMD.desktop <mime>
//
// The Rust command returns Ok(message) on success, Err(message) otherwise.
// The frontend surfaces this to the user via toast.

#[tauri::command]
pub fn set_as_default_markdown_editor(lang: Option<String>) -> Result<String, String> {
    let is_zh = lang.as_deref().unwrap_or("zh").starts_with("zh");
    #[cfg(target_os = "macos")]
    {
        return macos::set_default(is_zh);
    }
    #[cfg(target_os = "windows")]
    {
        return windows::set_default(is_zh);
    }
    #[cfg(target_os = "linux")]
    {
        return linux::set_default(is_zh);
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = is_zh;
        Err(if is_zh {
            "当前操作系统暂不支持自动设置默认程序".to_string()
        } else {
            "Unsupported platform".to_string()
        })
    }
}

// ====================================================================
// macOS: LaunchServices
// ====================================================================

#[cfg(target_os = "macos")]
mod macos {
    use core_foundation::base::TCFType;
    use core_foundation::string::{CFString, CFStringRef};

    // kLSRolesAll = 0xFFFFFFFF — any role (viewer/editor/shell)
    const K_LS_ROLES_ALL: u32 = 0xFFFFFFFF;

    #[link(name = "CoreServices", kind = "framework")]
    unsafe extern "C" {
        fn LSSetDefaultRoleHandlerForContentType(
            in_content_type: CFStringRef,
            in_role: u32,
            in_handler_bundle_id: CFStringRef,
        ) -> i32;
    }

    pub fn set_default(is_zh: bool) -> Result<String, String> {
        // Bundle identifier declared in tauri.conf.json
        let bundle_id = CFString::new("app.catstepmd");

        // UTIs that map to Markdown / plain text. Multiple UTIs exist because
        // different apps have historically declared their own: we claim them all.
        let utis = [
            "net.daringfireball.markdown",
            "public.markdown",
            "com.solomd.markdown",
            "app.catstepmd.markdown",
        ];

        let mut ok_count = 0;
        let mut first_error: Option<i32> = None;

        for uti in &utis {
            let content_type = CFString::new(uti);
            let status = unsafe {
                LSSetDefaultRoleHandlerForContentType(
                    content_type.as_concrete_TypeRef(),
                    K_LS_ROLES_ALL,
                    bundle_id.as_concrete_TypeRef(),
                )
            };
            if status == 0 {
                ok_count += 1;
            } else if first_error.is_none() {
                first_error = Some(status);
            }
        }

        if ok_count > 0 {
            Ok(if is_zh {
                format!("已成功将猫步 MD 设为 {} 种 Markdown 格式的默认打开程序！如未即时生效可尝试重启访达 (Finder)。", ok_count)
            } else {
                format!("Set as default for {} Markdown type(s). You may need to restart Finder.", ok_count)
            })
        } else {
            Err(if is_zh {
                format!("系统拒绝了修改请求 (OSStatus {})。请尝试在 Markdown 文件上右键 → 显示简介 → 打开方式 → 全部更改。", first_error.unwrap_or(-1))
            } else {
                format!(
                    "LaunchServices rejected the request (OSStatus {}). Try right-click → Get Info → Open with → Change All.",
                    first_error.unwrap_or(-1)
                )
            })
        }
    }
}

// ====================================================================
// Windows: Registry (HKCU) + Context Menu + RegisteredApplications + SHChangeNotify
// ====================================================================

#[cfg(target_os = "windows")]
mod windows {
    use std::env;
    use std::path::{Path, PathBuf};
    use winreg::enums::*;
    use winreg::RegKey;

    pub fn set_default(is_zh: bool) -> Result<String, String> {
        let exe_path_buf = env::current_exe().map_err(|e| {
            if is_zh {
                format!("无法获取当前程序路径: {e}")
            } else {
                format!("Can't locate current executable: {e}")
            }
        })?;
        let exe_path = exe_path_buf.to_string_lossy().to_string();

        let command_value = format!("\"{}\" \"%1\"", exe_path);
        let dir_command_value = format!("\"{}\" \"%V\"", exe_path);
        let icon_value = default_file_icon_value(&exe_path_buf);
        let exe_icon_value = format!("\"{}\",0", exe_path);

        let friendly_app_name = if is_zh { "猫步 MD" } else { "Catstep MD" };
        let friendly_md_name = if is_zh { "Markdown 文档" } else { "Markdown Document" };
        let friendly_txt_name = if is_zh { "文本文档" } else { "Plain Text Document" };
        let menu_open_file = if is_zh { "用猫步 MD 打开" } else { "Open with Catstep MD" };
        let menu_open_dir = if is_zh { "在猫步 MD 中打开" } else { "Open in Catstep MD" };

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        // 1. Register the app under Applications\CatstepMD.exe so Windows shows
        //    it in the "Open with" list.
        let app_root = r"Software\Classes\Applications\CatstepMD.exe";
        let (app_key, _) = hkcu
            .create_subkey(app_root)
            .map_err(|e| format!("Can't create Applications key: {e}"))?;
        app_key.set_value("FriendlyAppName", &friendly_app_name).ok();

        // Supported file extensions
        let (st_key, _) = hkcu
            .create_subkey(format!("{}\\SupportedTypes", app_root))
            .map_err(|e| format!("Can't create SupportedTypes: {e}"))?;
        for ext in &[".md", ".markdown", ".mdown", ".mkd", ".txt"] {
            st_key.set_value(ext, &"").ok();
        }

        // Shell open command
        let (cmd_key, _) = hkcu
            .create_subkey(format!("{}\\shell\\open\\command", app_root))
            .map_err(|e| format!("Can't create shell command: {e}"))?;
        cmd_key.set_value("", &command_value.as_str()).ok();

        // 2. Register Windows Default Programs capabilities (RegisteredApplications)
        if let Ok((reg_apps, _)) = hkcu.create_subkey(r"Software\RegisteredApplications") {
            reg_apps.set_value("CatstepMD", &r"Software\CatstepMD\Capabilities").ok();
        }
        let cap_root = r"Software\CatstepMD\Capabilities";
        if let Ok((cap_key, _)) = hkcu.create_subkey(cap_root) {
            cap_key.set_value("ApplicationName", &friendly_app_name).ok();
            let desc = if is_zh {
                "猫步 MD (Catstep MD) — 轻量优雅的 Markdown 文本编辑器与个人知识库"
            } else {
                "Catstep MD — lightweight Markdown editor"
            };
            cap_key.set_value("ApplicationDescription", &desc).ok();
            if let Ok((assoc_key, _)) = hkcu.create_subkey(format!("{}\\FileAssociations", cap_root)) {
                assoc_key.set_value(".md", &"CatstepMD.md").ok();
                assoc_key.set_value(".markdown", &"CatstepMD.md").ok();
                assoc_key.set_value(".mdown", &"CatstepMD.md").ok();
                assoc_key.set_value(".mkd", &"CatstepMD.md").ok();
                assoc_key.set_value(".txt", &"CatstepMD.txt").ok();
            }
        }

        // 3. Create ProgIDs with dedicated document icon, FriendlyTypeName and open command.
        register_progid(
            &hkcu,
            r"Software\Classes\CatstepMD.md",
            friendly_md_name,
            friendly_app_name,
            menu_open_file,
            &icon_value,
            &exe_icon_value,
            &command_value,
        )?;
        register_progid(
            &hkcu,
            r"Software\Classes\CatstepMD.txt",
            friendly_txt_name,
            friendly_app_name,
            menu_open_file,
            &icon_value,
            &exe_icon_value,
            &command_value,
        )?;

        // 4. For each extension, attach the ProgId as an OpenWith candidate and set default
        let extensions = [".md", ".markdown", ".mdown", ".mkd"];
        let mut ok_count = 0;
        for ext in &extensions {
            let ext_key_path = format!("Software\\Classes\\{}", ext);
            if let Ok((ext_key, _)) = hkcu.create_subkey(&ext_key_path) {
                ext_key.set_value("", &"CatstepMD.md").ok();
                if let Ok((owp, _)) = hkcu.create_subkey(format!("{}\\OpenWithProgids", ext_key_path)) {
                    owp.set_value("CatstepMD.md", &"").ok();
                }
                ok_count += 1;
            }

            // Also register in OpenWithList
            let owl_path = format!("Software\\Classes\\{}\\OpenWithList", ext);
            if let Ok((owl, _)) = hkcu.create_subkey(&owl_path) {
                owl.set_value("a", &"CatstepMD.exe").ok();
                owl.set_value("MRUList", &"a").ok();
            }

            // Explorer FileExts OpenWithProgids & OpenWithList
            let explorer_base = format!(r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\{}", ext);
            if let Ok((e_owp, _)) = hkcu.create_subkey(format!(r"{}\OpenWithProgids", explorer_base)) {
                e_owp.set_value("CatstepMD.md", &"").ok();
            }
            if let Ok((e_owl, _)) = hkcu.create_subkey(format!(r"{}\OpenWithList", explorer_base)) {
                e_owl.set_value("a", &"CatstepMD.exe").ok();
                e_owl.set_value("MRUList", &"a").ok();
            }
        }

        // 5. System Right-Click Context Menus (系统右键快捷菜单集成)
        // A) For Markdown and Text file types: "用猫步 MD 打开"
        let all_types = [".md", ".markdown", ".mdown", ".mkd", ".txt"];
        for ext in &all_types {
            let sfa_shell_path = format!(r"Software\Classes\SystemFileAssociations\{}\shell\CatstepMD", ext);
            if let Ok((sfa_key, _)) = hkcu.create_subkey(&sfa_shell_path) {
                sfa_key.set_value("", &menu_open_file).ok();
                sfa_key.set_value("Icon", &exe_icon_value.as_str()).ok();
                if let Ok((sfa_cmd, _)) = hkcu.create_subkey(format!(r"{}\command", sfa_shell_path)) {
                    sfa_cmd.set_value("", &command_value.as_str()).ok();
                }
            }
        }

        // B) For Directories / Folders: "在猫步 MD 中打开"
        for dir_target in &[
            r"Software\Classes\Directory\shell\CatstepMD",
            r"Software\Classes\Directory\Background\shell\CatstepMD",
        ] {
            if let Ok((dir_key, _)) = hkcu.create_subkey(dir_target) {
                dir_key.set_value("", &menu_open_dir).ok();
                dir_key.set_value("Icon", &exe_icon_value.as_str()).ok();
                if let Ok((dir_cmd, _)) = hkcu.create_subkey(format!(r"{}\command", dir_target)) {
                    dir_cmd.set_value("", &dir_command_value.as_str()).ok();
                }
            }
        }

        // 6. Notify the shell that associations have changed.
        unsafe {
            sh_change_notify();
        }

        // 7. On Windows 10/11, launch Default Apps settings to assist user confirmation
        let _ = std::process::Command::new("cmd")
            .args(["/c", "start", "ms-settings:defaultapps"])
            .spawn();

        if is_zh {
            Ok(format!(
                "已成功为 {} 类 Markdown 格式注册文件关联，并集成系统右键菜单「{}」！\n（已打开系统默认应用设置，可按需确认默认打开方式）",
                ok_count, menu_open_file
            ))
        } else {
            Ok(format!(
                "Registered as default for {} Markdown extension(s) and integrated \"{}\" context menu! (Windows Default Apps settings opened)",
                ok_count, menu_open_file
            ))
        }
    }

    fn register_progid(
        hkcu: &RegKey,
        progid_root: &str,
        friendly_type_name: &str,
        friendly_app_name: &str,
        menu_open_text: &str,
        icon_value: &str,
        exe_icon_value: &str,
        command_value: &str,
    ) -> Result<(), String> {
        let (progid_key, _) = hkcu
            .create_subkey(progid_root)
            .map_err(|e| format!("Can't create ProgId: {e}"))?;
        progid_key.set_value("", &friendly_type_name).ok();
        progid_key.set_value("FriendlyTypeName", &friendly_type_name).ok();

        let (icon_key, _) = hkcu
            .create_subkey(format!("{}\\DefaultIcon", progid_root))
            .map_err(|e| format!("Can't create DefaultIcon: {e}"))?;
        icon_key.set_value("", &icon_value).ok();

        let (open_key, _) = hkcu
            .create_subkey(format!("{}\\shell\\open", progid_root))
            .map_err(|e| format!("Can't create shell open: {e}"))?;
        open_key.set_value("", &menu_open_text).ok();
        open_key.set_value("FriendlyAppName", &friendly_app_name).ok();
        open_key.set_value("Icon", &exe_icon_value).ok();

        let (progid_cmd_key, _) = hkcu
            .create_subkey(format!("{}\\shell\\open\\command", progid_root))
            .map_err(|e| format!("Can't create ProgId open command: {e}"))?;
        progid_cmd_key.set_value("", &command_value).ok();

        Ok(())
    }

    fn default_file_icon_value(exe_path: &Path) -> String {
        let icon_path = bundled_file_icon_path(exe_path);
        let path = if icon_path.is_file() {
            icon_path
        } else {
            exe_path.to_path_buf()
        };
        format!("\"{}\",0", path.to_string_lossy())
    }

    fn bundled_file_icon_path(exe_path: &Path) -> PathBuf {
        exe_path
            .parent()
            .unwrap_or_else(|| Path::new(""))
            .join("icons")
            .join("file_icon.ico")
    }

    // SHCNE_ASSOCCHANGED = 0x08000000, SHCNF_IDLIST = 0
    unsafe fn sh_change_notify() {
        #[link(name = "shell32")]
        unsafe extern "system" {
            fn SHChangeNotify(
                w_event_id: i32,
                u_flags: u32,
                dw_item1: *const std::ffi::c_void,
                dw_item2: *const std::ffi::c_void,
            );
        }
        SHChangeNotify(0x08000000, 0, std::ptr::null(), std::ptr::null());
    }
}

// ====================================================================
// Linux: xdg-mime
// ====================================================================

#[cfg(target_os = "linux")]
mod linux {
    use std::process::Command;

    pub fn set_default(is_zh: bool) -> Result<String, String> {
        // The .desktop file name comes from Tauri's deb/rpm packaging.
        // With [[bin]] name = "CatstepMD" in Cargo.toml, the file is CatstepMD.desktop.
        let desktop_file = "CatstepMD.desktop";

        // Markdown MIME types (some distros use one, some another)
        let mimes = ["text/markdown", "text/x-markdown", "application/x-markdown"];

        let mut ok_count = 0;
        let mut last_error = String::new();

        for mime in &mimes {
            match Command::new("xdg-mime")
                .args(["default", desktop_file, mime])
                .output()
            {
                Ok(out) if out.status.success() => {
                    ok_count += 1;
                }
                Ok(out) => {
                    last_error = String::from_utf8_lossy(&out.stderr).to_string();
                }
                Err(e) => {
                    last_error = format!("Failed to run xdg-mime: {e}");
                }
            }
        }

        if ok_count > 0 {
            Ok(if is_zh {
                format!("已成功将猫步 MD 设为 {} 类 MIME 格式的默认 Markdown 打开程序！", ok_count)
            } else {
                format!("Set as default for {} MIME type(s).", ok_count)
            })
        } else {
            Err(if is_zh {
                format!("xdg-mime 执行失败，请确保系统已安装 xdg-utils 软件包。错误: {}", last_error)
            } else {
                format!(
                    "xdg-mime failed. Install `xdg-utils` and try again. Error: {}",
                    last_error
                )
            })
        }
    }
}
