# ChronoLens クロノレンズ
Time-Travel Local State & Data Debugger, Tauri v2 · Rust · React · TypeScript · Tailwind.

Copyright © 2026 Albatany

## Layout
```
chronolens/
├── package.json · vite.config.ts · tsconfig.json · tailwind.config.js · postcss.config.js · index.html
├── make_icons.py · app-icon.png         (placeholder icons; replace + run `npm run tauri icon app-icon.png`)
├── .github/workflows/build.yml          (Linux + Windows bundles in CI)
├── src/
│   ├── main.tsx · App.tsx · index.css   (design tokens, CRT overlay, pixel buttons)
│   ├── lib/        api.ts · types.ts · format.ts · palette.ts
│   ├── hooks/      useTimeTravel.ts · useLogicalWidth.ts
│   └── components/ TimelineLens.tsx · MemoryGraph.tsx · FileTree.tsx · EventLog.tsx
│                   StatsPanel.tsx · ConfigBar.tsx · PixelWindow.tsx · PixelClock.tsx
└── src-tauri/
    ├── Cargo.toml · build.rs · tauri.conf.json · capabilities/default.json · icons/
    └── src/        main.rs (hub thread + IPC) · store.rs (ring buffer + tests) · telemetry.rs (notify, sysinfo, #[cfg] platform code)
```

## Run (dev)
```bash
npm install
npm run tauri dev
```

### CachyOS / Arch (Hyprland)
```bash
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
```bash
cargo test --manifest-path src-tauri/Cargo.toml
```
