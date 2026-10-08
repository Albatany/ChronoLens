
export type OpKind = "created" | "modified" | "removed";

export interface Entry {
  ts_ms: number;
  kind: OpKind;
  path: string;
  size: number;
}

export interface MemSample {
  ts_ms: number;
  rss_kb: number;
  vsz_kb: number;
  threads: number;
  handles: number;
  cpu_pct: number;
}

export interface FileEntry {
  path: string;
  size: number;
  age_ms: number;
}

export interface StateSnapshot {
  ts_ms: number;
  files: FileEntry[];
  file_count: number;
  files_truncated: boolean;
  total_bytes: number;
  mem: MemSample | null;
  mem_history: MemSample[];
  recent_events: Entry[];
  events_applied: number;
}

export interface Bucket {
  events: number;
  rss_kb: number;
}

export interface Overview {
  start_ms: number;
  end_ms: number;
  buckets: Bucket[];
  total_events: number;
  buffered_events: number;
  mem_samples: number;
}

export interface LiveTick {
  ts_ms: number;
  mem: MemSample | null;
  new_events: Entry[];
  total_events: number;
  buffered_events: number;
}

export interface Status {
  workspace: string;
  target_pid: number;
  target_name: string;
  target_alive: boolean;
  watching: boolean;
  error: string | null;
  tracked_files: number;
  event_capacity: number;
}

export interface ProcInfo {
  pid: number;
  name: string;
  rss_kb: number;
}
