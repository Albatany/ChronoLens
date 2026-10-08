//! Ring-buffer time-series store.
//!
//! Memory model (all bounded, nothing grows forever):
//!
//! * `events`  – the newest `cap_events` file mutations, ordered by millisecond timestamp.
//! * `mem`     – the newest `cap_mem` process samples.
//! * `base`    – the file-tree state *just before* `events[0]`. Whenever the ring is full and
//!               the oldest event is evicted, it is folded into `base`, so the state at any
//!               timestamp inside the retained window can always be rebuilt exactly:
//!
//!               state(t) = base + replay(events where ts <= t)
//!
//! Reconstruction is O(F + E) (F = tracked files, E = events in window); with the default
//! caps that is well under a millisecond or two, so no checkpointing is required.

use serde::Serialize;
use std::collections::{BTreeMap, VecDeque};

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OpKind {
    Created,
    Modified,
    Removed,
}

/// One delta mutation of the workspace, stamped with an exact unix-epoch millisecond.
#[derive(Clone, Debug, Serialize)]
pub struct Entry {
    pub ts_ms: u64,
    pub kind: OpKind,
    /// Path relative to the workspace root, always `/`-separated.
    pub path: String,
    pub size: u64,
}

/// One process telemetry sample.
#[derive(Clone, Copy, Debug, Serialize, Default)]
pub struct MemSample {
    pub ts_ms: u64,
    pub rss_kb: u64,
    pub vsz_kb: u64,
    pub threads: u32,
    pub handles: u32,
    pub cpu_pct: f32,
}

#[derive(Clone, Copy, Debug)]
pub struct FileNode {
    pub size: u64,
    pub modified_ms: u64,
}

pub type FileMap = BTreeMap<String, FileNode>;

#[derive(Serialize)]
pub struct FileEntry {
    pub path: String,
    pub size: u64,
    /// How long before the requested timestamp this file last changed (0 = right at the cursor).
    pub age_ms: u64,
}

#[derive(Serialize)]
pub struct StateSnapshot {
    pub ts_ms: u64,
    pub files: Vec<FileEntry>,
    pub file_count: usize,
    pub files_truncated: bool,
    pub total_bytes: u64,
    pub mem: Option<MemSample>,
    pub mem_history: Vec<MemSample>,
    pub recent_events: Vec<Entry>,
    pub events_applied: usize,
}

#[derive(Clone, Copy, Default, Serialize)]
pub struct Bucket {
    pub events: u32,
    pub rss_kb: u64,
}

#[derive(Serialize)]
pub struct Overview {
    pub start_ms: u64,
    pub end_ms: u64,
    pub buckets: Vec<Bucket>,
    pub total_events: u64,
    pub buffered_events: usize,
    pub mem_samples: usize,
}

fn apply(files: &mut FileMap, e: &Entry) {
    match e.kind {
        OpKind::Created | OpKind::Modified => {
            files.insert(
                e.path.clone(),
                FileNode { size: e.size, modified_ms: e.ts_ms },
            );
        }
        OpKind::Removed => {
            // A removed *directory* arrives as a single event; drop everything beneath it.
            if files.remove(&e.path).is_none() {
                let prefix = format!("{}/", e.path);
                let doomed: Vec<String> = files
                    .range(prefix.clone()..)
                    .take_while(|(k, _)| k.starts_with(&prefix))
                    .map(|(k, _)| k.clone())
                    .collect();
                for k in doomed {
                    files.remove(&k);
                }
            }
        }
    }
}

pub struct Store {
    events: VecDeque<Entry>,
    mem: VecDeque<MemSample>,
    base: FileMap,
    cap_events: usize,
    cap_mem: usize,
    total_events: u64,
}

impl Store {
    pub fn new(cap_events: usize, cap_mem: usize) -> Self {
        Self {
            events: VecDeque::with_capacity(cap_events.min(4096)),
            mem: VecDeque::with_capacity(cap_mem.min(4096)),
            base: FileMap::new(),
            cap_events: cap_events.max(1),
            cap_mem: cap_mem.max(1),
            total_events: 0,
        }
    }

    /// Replace the baseline (e.g. after switching workspace) and forget old file events.
    pub fn reset_files(&mut self, baseline: FileMap) {
        self.events.clear();
        self.base = baseline;
        self.total_events = 0;
    }

    pub fn reset_mem(&mut self) {
        self.mem.clear();
    }

    pub fn total_events(&self) -> u64 {
        self.total_events
    }

    pub fn buffered_events(&self) -> usize {
        self.events.len()
    }

    /// Batch insert. Timestamps are forced to be monotonic so binary search stays valid.
    pub fn push_batch(&mut self, batch: Vec<Entry>) {
        for mut e in batch {
            if let Some(last) = self.events.back() {
                if e.ts_ms < last.ts_ms {
                    e.ts_ms = last.ts_ms;
                }
            }
            if self.events.len() >= self.cap_events {
                if let Some(old) = self.events.pop_front() {
                    apply(&mut self.base, &old);
                }
            }
            self.events.push_back(e);
            self.total_events += 1;
        }
    }

    pub fn push_mem(&mut self, s: MemSample) {
        if self.mem.len() >= self.cap_mem {
            self.mem.pop_front();
        }
        self.mem.push_back(s);
    }

    /// First / last timestamp covered by the store (end is never before `now_ms`).
    pub fn bounds(&self, now_ms: u64) -> (u64, u64) {
        let first = [
            self.events.front().map(|e| e.ts_ms),
            self.mem.front().map(|m| m.ts_ms),
        ]
        .into_iter()
        .flatten()
        .min()
        .unwrap_or_else(|| now_ms.saturating_sub(1_000));
        (first, now_ms.max(first + 1_000))
    }

    /// Rebuild the workspace + telemetry state as it was at `ms`.
    pub fn snapshot_at(&self, ms: u64, max_files: usize, hist_points: usize) -> StateSnapshot {
        let idx = self.events.partition_point(|e| e.ts_ms <= ms);

        let mut files = self.base.clone();
        for e in self.events.iter().take(idx) {
            apply(&mut files, e);
        }

        let total_bytes = files.values().map(|f| f.size).sum();
        let file_count = files.len();
        let listed: Vec<FileEntry> = files
            .iter()
            .take(max_files)
            .map(|(p, n)| FileEntry {
                path: p.clone(),
                size: n.size,
                age_ms: ms.saturating_sub(n.modified_ms),
            })
            .collect();

        let recent_events: Vec<Entry> = self
            .events
            .range(idx.saturating_sub(14)..idx)
            .rev()
            .cloned()
            .collect();

        let m_idx = self.mem.partition_point(|s| s.ts_ms <= ms);
        let mem = if m_idx > 0 { self.mem.get(m_idx - 1).copied() } else { None };
        let mem_history: Vec<MemSample> = self
            .mem
            .range(m_idx.saturating_sub(hist_points)..m_idx)
            .copied()
            .collect();

        StateSnapshot {
            ts_ms: ms,
            files_truncated: file_count > listed.len(),
            files: listed,
            file_count,
            total_bytes,
            mem,
            mem_history,
            recent_events,
            events_applied: idx,
        }
    }

    /// Down-sampled picture of the whole timeline for the canvas (one pass, O(E + M)).
    pub fn overview(&self, now_ms: u64, buckets: usize) -> Overview {
        let (start, end) = self.bounds(now_ms);
        let n = buckets.max(1);
        let span = (end - start).max(1) as u128;
        let idx = |ts: u64| -> usize {
            ((ts.saturating_sub(start) as u128 * n as u128 / span) as usize).min(n - 1)
        };
        let mut out = vec![Bucket::default(); n];
        for e in &self.events {
            out[idx(e.ts_ms)].events += 1;
        }
        for m in &self.mem {
            let b = &mut out[idx(m.ts_ms)];
            b.rss_kb = b.rss_kb.max(m.rss_kb);
        }
        Overview {
            start_ms: start,
            end_ms: end,
            buckets: out,
            total_events: self.total_events,
            buffered_events: self.events.len(),
            mem_samples: self.mem.len(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(ts: u64, kind: OpKind, path: &str, size: u64) -> Entry {
        Entry { ts_ms: ts, kind, path: path.into(), size }
    }

    #[test]
    fn replays_state_at_timestamp() {
        let mut s = Store::new(100, 100);
        s.push_batch(vec![
            e(10, OpKind::Created, "a.txt", 1),
            e(20, OpKind::Modified, "a.txt", 5),
            e(30, OpKind::Removed, "a.txt", 0),
        ]);
        assert_eq!(s.snapshot_at(5, 10, 10).file_count, 0);
        let mid = s.snapshot_at(25, 10, 10);
        assert_eq!(mid.file_count, 1);
        assert_eq!(mid.total_bytes, 5);
        assert_eq!(s.snapshot_at(30, 10, 10).file_count, 0);
    }

    #[test]
    fn eviction_folds_into_baseline() {
        let mut s = Store::new(2, 2);
        s.push_batch(vec![
            e(1, OpKind::Created, "a", 1),
            e(2, OpKind::Created, "b", 1),
            e(3, OpKind::Created, "c", 1),
        ]);
        assert_eq!(s.buffered_events(), 2);
        assert_eq!(s.snapshot_at(u64::MAX, 10, 10).file_count, 3);
        assert_eq!(s.snapshot_at(0, 10, 10).file_count, 1); // "a" now lives in the baseline
    }

    #[test]
    fn removing_a_directory_drops_children() {
        let mut s = Store::new(10, 10);
        s.push_batch(vec![
            e(1, OpKind::Created, "src/a.rs", 1),
            e(2, OpKind::Created, "src/b.rs", 1),
            e(3, OpKind::Created, "src-extra.txt", 1),
            e(4, OpKind::Removed, "src", 0),
        ]);
        assert_eq!(s.snapshot_at(10, 10, 10).file_count, 1);
    }

    #[test]
    fn overview_buckets_events() {
        let mut s = Store::new(10, 10);
        s.push_batch(vec![e(1_000, OpKind::Created, "a", 1), e(2_000, OpKind::Created, "b", 1)]);
        let o = s.overview(3_000, 4);
        assert_eq!(o.buckets.iter().map(|b| b.events).sum::<u32>(), 2);
    }
}
