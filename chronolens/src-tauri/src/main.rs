//! ChronoLens — Time-Travel Local State & Data Debugger (Rust core).
//! Copyright © 2026 Albatany
//!
//! Architecture
//! ────────────
//!   notify watcher ──(ts, event)──▶ ┐
//!                                    ├─▶ "hub" thread ──batch insert──▶ Store (ring buffers)
//!   sysinfo / procfs sampler ──────▶ ┘        │                              ▲
//!                                             └─▶ live ticks ─▶ Tauri Channel │
//!   async IPC commands (get_state_at_timestamp, get_timeline_overview, …) ───┘
//!
//! * One background OS thread owns the watcher, the sampler and all writes → the UI thread and
//!   the async command pool never wait on I/O, and there is no async runtime of our own.
//! * File events are stamped with `now_ms()` *inside the notify callback*, so timestamps are
//!   exact to the millisecond even though inserts are batched every 500 ms.
//! * Every `#[tauri::command]` is `async`, so Tauri runs it on its worker pool instead of the
//!   main (event-loop) thread.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod store;
mod telemetry;

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{mpsc, Arc},
    thread,
    time::{Duration, Instant},
};

use notify::RecommendedWatcher;
use parking_lot::Mutex;
use serde::Serialize;
use tauri::{ipc::Channel, State};

use store::{Entry, MemSample, OpKind, Overview, StateSnapshot, Store};
use telemetry::{now_ms, ProcInfo, Sampler};

// ───────────────────────────── tunables ─────────────────────────────
const TICK: Duration = Duration::from_millis(500); // sampler + batch-insert + live push
const EVENT_CAP: usize = 30_000; // ≈ 3 MB worst case
const MEM_CAP: usize = 20_000; // ≈ 2.7 h at 500 ms
const SCAN_LIMIT: usize = 20_000; // baseline files tracked
const MAX_FILES_IN_SNAPSHOT: usize = 600; // keeps one IPC payload small
const HISTORY_POINTS: usize = 120; // memory-graph window
const LIVE_EVENTS_PER_TICK: usize = 40;

type FsMsg = (u64, notify::Event);

// ───────────────────────────── shared state ─────────────────────────────

/// Pushed to the frontend through `stream_live_telemetry`.
#[derive(Clone, Serialize)]
struct LiveTick {
    ts_ms: u64,
    mem: Option<MemSample>,
    new_events: Vec<Entry>,
    total_events: u64,
    buffered_events: usize,
}

#[derive(Clone, Serialize, Default)]
struct Status {
    workspace: String,
    target_pid: u32,
    target_name: String,
    target_alive: bool,
    watching: bool,
    error: Option<String>,
    tracked_files: usize,
    event_capacity: usize,
}

enum Control {
    SetWorkspace(PathBuf),
    SetTarget(Option<u32>),
}

#[derive(Clone)]
struct Shared {
    store: Arc<Mutex<Store>>,
    status: Arc<Mutex<Status>>,
    subs: Arc<Mutex<Vec<Channel<LiveTick>>>>,
}

struct AppState {
    shared: Shared,
    control: mpsc::Sender<Control>,
}

// ───────────────────────────── background hub ─────────────────────────────

/// (Re)attach the recursive watcher to `root` and rebuild the baseline.
/// The watcher starts *before* the scan so nothing is missed; replayed events are idempotent.
fn attach_workspace(
    root: &Path,
    fs_tx: &mpsc::Sender<FsMsg>,
    shared: &Shared,
) -> Option<RecommendedWatcher> {
    use notify::{RecursiveMode, Watcher};

    let tx = fs_tx.clone();
    let started = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            let _ = tx.send((now_ms(), ev)); // timestamp at the moment the OS told us
        }
    })
    .and_then(|mut w| w.watch(root, RecursiveMode::Recursive).map(|_| w));

    let baseline = telemetry::scan(root, SCAN_LIMIT);
    let tracked = baseline.len();
    shared.store.lock().reset_files(baseline);

    let mut st = shared.status.lock();
    st.tracked_files = tracked;
    match started {
        Ok(w) => {
            st.watching = true;
            st.error = None;
            Some(w)
        }
        Err(e) => {
            st.watching = false;
            st.error = Some(format!("watcher failed: {e}"));
            None
        }
    }
}

/// One sampling + batch-insert + broadcast cycle.
fn tick(root: &Path, fs_rx: &mpsc::Receiver<FsMsg>, sampler: &mut Sampler, shared: &Shared) {
    let now = now_ms();
    let mem = sampler.sample(now);

    // Drain raw events, translate, and coalesce bursts of "modified" for the same path.
    let mut batch: Vec<Entry> = Vec::new();
    let mut last_modified: HashMap<String, usize> = HashMap::new();
    while let Ok((ts, ev)) = fs_rx.try_recv() {
        for e in telemetry::translate(root, ts, &ev) {
            if e.kind == OpKind::Modified {
                if let Some(&i) = last_modified.get(&e.path) {
                    batch[i].size = e.size;
                    continue;
                }
                last_modified.insert(e.path.clone(), batch.len());
            } else {
                last_modified.remove(&e.path);
            }
            batch.push(e);
        }
    }

    let new_events: Vec<Entry> = batch
        .iter()
        .rev()
        .take(LIVE_EVENTS_PER_TICK)
        .rev()
        .cloned()
        .collect();

    let (total_events, buffered_events) = {
        let mut s = shared.store.lock();
        s.push_batch(batch);
        if let Some(m) = mem {
            s.push_mem(m);
        }
        (s.total_events(), s.buffered_events())
    };

    {
        let mut st = shared.status.lock();
        st.target_alive = mem.is_some();
        if mem.is_some() && st.target_name != sampler.name() {
            st.target_name = sampler.name().to_string();
        }
    }

    let mut subs = shared.subs.lock();
    if subs.is_empty() {
        return;
    }
    let payload = LiveTick { ts_ms: now, mem, new_events, total_events, buffered_events };
    // A failed send means the webview went away → drop that subscriber.
    subs.retain(|ch| ch.send(payload.clone()).is_ok());
}

fn run_hub(shared: Shared, ctrl_rx: mpsc::Receiver<Control>, mut root: PathBuf) {
    let (fs_tx, fs_rx) = mpsc::channel::<FsMsg>();
    let mut sampler = Sampler::new(None);
    let mut _watcher = attach_workspace(&root, &fs_tx, &shared);
    let mut next_tick = Instant::now() + TICK;

    loop {
        let wait = next_tick.saturating_duration_since(Instant::now());
        match ctrl_rx.recv_timeout(wait) {
            Ok(Control::SetWorkspace(p)) => {
                _watcher = None; // stop the old watcher first
                root = p;
                while fs_rx.try_recv().is_ok() {} // discard stale events
                _watcher = attach_workspace(&root, &fs_tx, &shared);
            }
            Ok(Control::SetTarget(pid)) => {
                sampler.set_target(pid);
                shared.store.lock().reset_mem();
                let mut st = shared.status.lock();
                st.target_pid = sampler.pid();
                st.target_name.clear();
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
        if Instant::now() >= next_tick {
            next_tick = Instant::now() + TICK;
            tick(&root, &fs_rx, &mut sampler, &shared);
        }
    }
}

// ───────────────────────────── IPC commands ─────────────────────────────

/// Rebuild file tree + memory/thread/handle readings exactly as they were at `ms`.
#[tauri::command]
async fn get_state_at_timestamp(ms: u64, state: State<'_, AppState>) -> Result<StateSnapshot, String> {
    Ok(state
        .shared
        .store
        .lock()
        .snapshot_at(ms, MAX_FILES_IN_SNAPSHOT, HISTORY_POINTS))
}

/// Register a Tauri `Channel`; the hub pushes a `LiveTick` through it every 500 ms.
#[tauri::command]
async fn stream_live_telemetry(
    on_event: Channel<LiveTick>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.shared.subs.lock().push(on_event);
    Ok(())
}

/// Down-sampled whole-timeline picture for the canvas (event density + peak RSS per bucket).
#[tauri::command]
async fn get_timeline_overview(buckets: usize, state: State<'_, AppState>) -> Result<Overview, String> {
    Ok(state
        .shared
        .store
        .lock()
        .overview(now_ms(), buckets.clamp(16, 1024)))
}

#[tauri::command]
async fn get_status(state: State<'_, AppState>) -> Result<Status, String> {
    Ok(state.shared.status.lock().clone())
}

#[tauri::command]
async fn set_workspace(path: String, state: State<'_, AppState>) -> Result<Status, String> {
    let p = std::fs::canonicalize(path.trim()).map_err(|e| format!("cannot open path: {e}"))?;
    if !p.is_dir() {
        return Err("workspace must be a directory".into());
    }
    state
        .control
        .send(Control::SetWorkspace(p.clone()))
        .map_err(|e| e.to_string())?;
    let mut st = state.shared.status.lock();
    st.workspace = p.display().to_string();
    st.watching = false;
    st.error = None;
    Ok(st.clone())
}

/// `None` = monitor ChronoLens itself.
#[tauri::command]
async fn set_target_pid(pid: Option<u32>, state: State<'_, AppState>) -> Result<Status, String> {
    state
        .control
        .send(Control::SetTarget(pid))
        .map_err(|e| e.to_string())?;
    let mut st = state.shared.status.lock();
    st.target_pid = pid.unwrap_or_else(std::process::id);
    st.target_name.clear();
    Ok(st.clone())
}

#[tauri::command]
async fn list_processes() -> Result<Vec<ProcInfo>, String> {
    Ok(telemetry::list_processes(60))
}

/// Writes / edits / deletes a few files inside the workspace so a fresh install has something
/// to look at. Everything it creates is removed again at the end.
#[tauri::command]
async fn generate_demo_activity(state: State<'_, AppState>) -> Result<(), String> {
    let root = PathBuf::from(state.shared.status.lock().workspace.clone());
    if !root.is_dir() {
        return Err("workspace is not available".into());
    }
    thread::spawn(move || run_demo(root));
    Ok(())
}

fn run_demo(root: PathBuf) {
    use std::fs;
    let dir = root.join("chronolens-demo");
    let _ = fs::create_dir_all(dir.join("src"));
    let _ = fs::create_dir_all(dir.join("docs"));
    let mut seed = now_ms() | 1;
    let mut rnd = move || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    };
    for step in 0..40u32 {
        let r = rnd();
        let module = dir.join(format!("src/module_{}.rs", r % 6));
        match r % 5 {
            0..=2 => {
                let _ = fs::write(&module, "x".repeat(((r >> 8) % 4096 + 64) as usize));
            }
            3 => {
                let _ = fs::write(dir.join(format!("docs/note_{step}.md")), "# note\n");
            }
            _ => {
                let _ = fs::remove_file(&module);
            }
        }
        thread::sleep(Duration::from_millis(300));
    }
    let _ = fs::remove_dir_all(&dir);
}

// ───────────────────────────── entry point ─────────────────────────────

fn default_workspace() -> PathBuf {
    let p = std::env::temp_dir().join("chronolens-workspace");
    let _ = std::fs::create_dir_all(&p);
    std::fs::canonicalize(&p).unwrap_or(p)
}

fn main() {
    let shared = Shared {
        store: Arc::new(Mutex::new(Store::new(EVENT_CAP, MEM_CAP))),
        status: Arc::new(Mutex::new(Status::default())),
        subs: Arc::new(Mutex::new(Vec::new())),
    };
    let workspace = default_workspace();
    {
        let mut st = shared.status.lock();
        st.workspace = workspace.display().to_string();
        st.target_pid = std::process::id();
        st.event_capacity = EVENT_CAP;
    }

    let (control, ctrl_rx) = mpsc::channel();
    {
        let shared = shared.clone();
        thread::Builder::new()
            .name("chronolens-hub".into())
            .spawn(move || run_hub(shared, ctrl_rx, workspace))
            .expect("failed to spawn telemetry hub");
    }

    tauri::Builder::default()
        .manage(AppState { shared, control })
        .invoke_handler(tauri::generate_handler![
            get_state_at_timestamp,
            stream_live_telemetry,
            get_timeline_overview,
            get_status,
            set_workspace,
            set_target_pid,
            list_processes,
            generate_demo_activity,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ChronoLens");
}
