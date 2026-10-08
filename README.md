# ChronoLens クロノレンズ
Time-Travel Local State & Data Debugger, Tauri v2 · Rust · React · TypeScript · Tailwind.

<img width="1920" height="1080" alt="screenshot_20261009_004914-region" src="https://github.com/user-attachments/assets/661decfa-6380-4473-8d05-cdc01cb7ca63" />

## Run (dev)
```
npm install
npm run tauri dev
```

## If there's "error[E0599]: no associated function or constant named `new` found for struct `ProcessRefreshKind` in the current scope" kinda error
```
sed -i 's/ProcessRefreshKind::new()/ProcessRefreshKind::nothing()/g' src-tauri/src/telemetry.rs
npm run tauri dev
```

### Arch Based
```
sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl \
  appmenu-gtk-module libappindicator-gtk3 librsvg xdotool nodejs npm rustup
rustup default stable
```
If the window is blank on Hyprland/NVIDIA: `WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev`.
Large workspaces on Linux may need `sudo sysctl fs.inotify.max_user_watches=524288`.

### Windows
Install Rust (MSVC toolchain), "Desktop development with C++" from VS Build Tools, Node 20+.
WebView2 ships with Windows 10 (1803+) / 11. Then the same two commands.

## Release build
```bash
npm run tauri build
```
Binary: `src-tauri/target/release/chronolens` (`chronolens.exe` on Windows); installers in
`src-tauri/target/release/bundle/`. Build each OS on that OS (or use the GitHub workflow).

## Tests
```
cargo test --manifest-path src-tauri/Cargo.toml
```

<img width="1920" height="1080" alt="screenshot_20261009_004909-region" src="https://github.com/user-attachments/assets/4e64c88e-3401-433b-8f0e-2a97762a184d" />

<br>

##

Copyright © 2026 Albatany

