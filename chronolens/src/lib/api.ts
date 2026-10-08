import { Channel, invoke } from "@tauri-apps/api/core";
import type { LiveTick, Overview, ProcInfo, StateSnapshot, Status } from "./types";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const api = {
  stateAt: (ms: number) => invoke<StateSnapshot>("get_state_at_timestamp", { ms }),
  overview: (buckets: number) => invoke<Overview>("get_timeline_overview", { buckets }),
  status: () => invoke<Status>("get_status"),
  setWorkspace: (path: string) => invoke<Status>("set_workspace", { path }),
  setTarget: (pid: number | null) => invoke<Status>("set_target_pid", { pid }),
  listProcesses: () => invoke<ProcInfo[]>("list_processes"),
  demo: () => invoke<void>("generate_demo_activity"),
};

type Handler = (t: LiveTick) => void;
const handlers = new Set<Handler>();
let channel: Channel<LiveTick> | null = null;

export function subscribeLive(h: Handler): () => void {
  handlers.add(h);
  if (!channel) {
    channel = new Channel<LiveTick>();
    channel.onmessage = (t) => handlers.forEach((fn) => fn(t));
    invoke("stream_live_telemetry", { onEvent: channel }).catch(console.error);
  }
  return () => {
    handlers.delete(h);
  };
}
