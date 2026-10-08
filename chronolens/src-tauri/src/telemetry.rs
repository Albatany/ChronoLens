//! Telemetry sources: file-system events (via `notify`) and process sampling (via `sysinfo`).
//!
//! Everything platform specific lives in the private `platform` module, selected with `#[cfg]`:
//!   * Linux   – reads `/proc/<pid>/{status,fd}` directly (no extra crate, ~zero overhead)
//!   * Windows – `GetProcessHandleCount` + a ToolHelp snapshot for the thread count
//!   * others  – returns 0 so the project still compiles (macOS is not a target but won't break)

use crate::store::{Entry, FileMap, FileNode, MemSample, OpKind};
use serde::Serialize;
use std::{
    ffi::OsStr,
    fs,
    path::{Component, Path},
    time::{SystemTime, UNIX_EPOCH},
};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

/// Directory names that are never tracked (huge, noisy, rarely interesting).
const IGNORED: [&str; 4] = [".git", "node_modules", "target", ".cache"];

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ─────────────────────────── platform specific counters ───────────────────────────

#[cfg(target_os = "linux")]
mod platform {
    pub fn handle_count(pid: u32) -> u32 {
        std::fs::read_dir(format!("/proc/{pid}/fd"))
            .map(|d| d.count() as u32)
            .unwrap_or(0)
    }

    pub fn thread_count(pid: u32) -> u32 {
        std::fs::read_to_string(format!("/proc/{pid}/status"))
            .ok()
            .and_then(|s| {
                s.lines()
                    .find_map(|l| l.strip_prefix("Threads:"))
                    .and_then(|v| v.trim().parse().ok())
            })
            .unwrap_or(0)
    }
}

#[cfg(windows)]
mod platform {
    use windows_sys::Win32::Foundation::{CloseHandle, FALSE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Threading::{
        GetProcessHandleCount, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    pub fn handle_count(pid: u32) -> u32 {
        // SAFETY: plain Win32 calls; the handle is closed before returning.
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
            if h.is_null() {
                return 0;
            }
            let mut count: u32 = 0;
            let ok = GetProcessHandleCount(h, &mut count);
            CloseHandle(h);
            if ok != 0 { count } else { 0 }
        }
    }

    pub fn thread_count(pid: u32) -> u32 {
        // SAFETY: PROCESSENTRY32W is plain-old-data; dwSize must be set before first use.
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap == INVALID_HANDLE_VALUE {
                return 0;
            }
            let mut entry: PROCESSENTRY32W = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            let mut threads = 0;
            if Process32FirstW(snap, &mut entry) != 0 {
                loop {
                    if entry.th32ProcessID == pid {
                        threads = entry.cntThreads;
                        break;
                    }
                    if Process32NextW(snap, &mut entry) == 0 {
                        break;
                    }
                }
            }
            CloseHandle(snap);
            threads
        }
    }
}

#[cfg(not(any(target_os = "linux", windows)))]
mod platform {
    pub fn handle_count(_pid: u32) -> u32 {
        0
    }
    pub fn thread_count(_pid: u32) -> u32 {
        0
    }
}

// ─────────────────────────────── process sampler ───────────────────────────────

pub struct Sampler {
    sys: System,
    pid: Pid,
    name: String,
}

impl Sampler {
    /// `None` = monitor ChronoLens' own process.
    pub fn new(target: Option<u32>) -> Self {
        Self {
            sys: System::new(),
            pid: Self::resolve(target),
            name: String::new(),
        }
    }

    fn resolve(target: Option<u32>) -> Pid {
        target
            .map(Pid::from_u32)
            .or_else(|| sysinfo::get_current_pid().ok())
            .unwrap_or_else(|| Pid::from_u32(std::process::id()))
    }

    pub fn pid(&self) -> u32 {
        self.pid.as_u32()
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn set_target(&mut self, target: Option<u32>) {
        self.pid = Self::resolve(target);
        self.name.clear();
    }

    /// Refresh only the one target process (cheap) and read its counters.
    #[allow(deprecated)]
    pub fn sample(&mut self, ts_ms: u64) -> Option<MemSample> {
        let kind = ProcessRefreshKind::new().with_cpu().with_memory();
        self.sys
            .refresh_processes_specifics(ProcessesToUpdate::Some(&[self.pid]), true, kind);
        let p = self.sys.process(self.pid)?;
        if self.name.is_empty() {
            self.name = p.name().to_string_lossy().into_owned();
        }
        let pid = self.pid.as_u32();
        Some(MemSample {
            ts_ms,
            rss_kb: p.memory() / 1024,
            vsz_kb: p.virtual_memory() / 1024,
            threads: platform::thread_count(pid),
            handles: platform::handle_count(pid),
            cpu_pct: p.cpu_usage(),
        })
    }
}

#[derive(Serialize)]
pub struct ProcInfo {
    pub pid: u32,
    pub name: String,
    pub rss_kb: u64,
}

/// Top processes by resident memory (used by the "pick target" dropdown).
#[allow(deprecated)]
pub fn list_processes(limit: usize) -> Vec<ProcInfo> {
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::new().with_memory(),
    );
    let mut v: Vec<ProcInfo> = sys
        .processes()
        .values()
        .map(|p| ProcInfo {
            pid: p.pid().as_u32(),
            name: p.name().to_string_lossy().into_owned(),
            rss_kb: p.memory() / 1024,
        })
        .collect();
    // Highest RSS first; on Linux threads show up with their parent's numbers, so keep only
    // the lowest pid (the thread-group leader) of each identical (name, rss) run.
    v.sort_by(|a, b| {
        b.rss_kb
            .cmp(&a.rss_kb)
            .then_with(|| a.name.cmp(&b.name))
            .then_with(|| a.pid.cmp(&b.pid))
    });
    v.dedup_by(|b, a| a.name == b.name && a.rss_kb == b.rss_kb);
    v.truncate(limit);
    v
}

// ─────────────────────────────── file-system side ───────────────────────────────

fn is_ignored_name(name: &OsStr) -> bool {
    IGNORED.iter().any(|i| name == OsStr::new(i))
}

fn rel_path(root: &Path, p: &Path) -> Option<String> {
    let rel = p.strip_prefix(root).ok()?;
    if rel.as_os_str().is_empty() {
        return None;
    }
    if rel
        .components()
        .any(|c| matches!(c, Component::Normal(n) if is_ignored_name(n)))
    {
        return None;
    }
    Some(rel.to_string_lossy().replace('\\', "/"))
}

fn entry_for(root: &Path, ts_ms: u64, p: &Path, kind: OpKind) -> Option<Entry> {
    let path = rel_path(root, p)?;
    match kind {
        OpKind::Removed => Some(Entry { ts_ms, kind, path, size: 0 }),
        _ => {
            let md = fs::metadata(p).ok()?;
            if md.is_dir() {
                return None; // directories are implied by their files
            }
            Some(Entry { ts_ms, kind, path, size: md.len() })
        }
    }
}

/// Map one raw `notify` event onto zero or more store entries.
pub fn translate(root: &Path, ts_ms: u64, ev: &notify::Event) -> Vec<Entry> {
    use notify::event::{EventKind, ModifyKind, RenameMode};
    let mut out = Vec::new();
    match &ev.kind {
        EventKind::Create(_) => {
            for p in &ev.paths {
                out.extend(entry_for(root, ts_ms, p, OpKind::Created));
            }
        }
        EventKind::Remove(_) => {
            for p in &ev.paths {
                out.extend(entry_for(root, ts_ms, p, OpKind::Removed));
            }
        }
        EventKind::Modify(ModifyKind::Name(RenameMode::From)) => {
            for p in &ev.paths {
                out.extend(entry_for(root, ts_ms, p, OpKind::Removed));
            }
        }
        EventKind::Modify(ModifyKind::Name(RenameMode::To)) => {
            for p in &ev.paths {
                out.extend(entry_for(root, ts_ms, p, OpKind::Created));
            }
        }
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => {
            if let [from, to] = ev.paths.as_slice() {
                out.extend(entry_for(root, ts_ms, from, OpKind::Removed));
                out.extend(entry_for(root, ts_ms, to, OpKind::Created));
            }
        }
        EventKind::Modify(ModifyKind::Name(_)) => {
            // Platform could not say which side of the rename this is: ask the file system.
            for p in &ev.paths {
                let kind = if p.exists() { OpKind::Created } else { OpKind::Removed };
                out.extend(entry_for(root, ts_ms, p, kind));
            }
        }
        EventKind::Modify(_) => {
            for p in &ev.paths {
                out.extend(entry_for(root, ts_ms, p, OpKind::Modified));
            }
        }
        _ => {} // Access / Other: not a state change
    }
    out
}

/// Baseline scan (iterative DFS, no symlink following, capped at `limit` files).
pub fn scan(root: &Path, limit: usize) -> FileMap {
    let mut out = FileMap::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        for ent in rd.flatten() {
            let Ok(ft) = ent.file_type() else { continue };
            if ft.is_dir() {
                if !is_ignored_name(&ent.file_name()) {
                    stack.push(ent.path());
                }
            } else if ft.is_file() {
                if out.len() >= limit {
                    return out;
                }
                if let Some(rel) = rel_path(root, &ent.path()) {
                    let size = ent.metadata().map(|m| m.len()).unwrap_or(0);
                    out.insert(rel, FileNode { size, modified_ms: 0 });
                }
            }
        }
    }
    out
}
