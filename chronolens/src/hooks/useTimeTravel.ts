import { useCallback, useEffect, useRef, useState } from "react";
import { api, isTauri, subscribeLive } from "../lib/api";
import type { Overview, StateSnapshot } from "../lib/types";

const OVERVIEW_BUCKETS = 256;

/**
 * Owns the time-travel cursor.
 *  • live  → the cursor follows the newest telemetry tick
 *  • scrub → the cursor sits at an arbitrary past millisecond
 * State requests use a "single in-flight, latest wins" pump so dragging the slider never
 * queues hundreds of IPC calls on a slow machine.
 */
export function useTimeTravel() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [cursor, setCursor] = useState(0);
  const [live, setLive] = useState(true);
  const [snap, setSnap] = useState<StateSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const liveRef = useRef(true);
  const inflight = useRef(false);
  const pending = useRef<number | null>(null);

  const pump = useCallback(async () => {
    if (inflight.current || pending.current === null) return;
    inflight.current = true;
    const ms = pending.current;
    pending.current = null;
    try {
      setSnap(await api.stateAt(ms));
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      inflight.current = false;
      if (pending.current !== null) void pump();
    }
  }, []);

  const request = useCallback(
    (ms: number) => {
      pending.current = ms;
      void pump();
    },
    [pump],
  );

  // live telemetry stream (Rust → Channel → here)
  useEffect(() => {
    if (!isTauri) {
      setError("Not running inside Tauri. Start the app with `npm run tauri dev`.");
      return;
    }
    return subscribeLive((t) => {
      if (liveRef.current) {
        setCursor(t.ts_ms);
        request(t.ts_ms);
      }
    });
  }, [request]);

  // whole-timeline overview for the canvas, refreshed once per second
  useEffect(() => {
    if (!isTauri) return;
    let alive = true;
    const load = async () => {
      try {
        const o = await api.overview(OVERVIEW_BUCKETS);
        if (alive) setOverview(o);
      } catch (e) {
        if (alive) setError(String(e));
      }
    };
    void load();
    const id = setInterval(load, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const scrub = useCallback(
    (ms: number) => {
      const lo = overview?.start_ms ?? ms;
      const hi = overview?.end_ms ?? ms;
      const clamped = Math.min(hi, Math.max(lo, Math.round(ms)));
      liveRef.current = false;
      setLive(false);
      setCursor(clamped);
      request(clamped);
    },
    [overview, request],
  );

  const goLive = useCallback(() => {
    liveRef.current = true;
    setLive(true);
    const end = overview?.end_ms ?? Date.now();
    setCursor(end);
    request(end);
  }, [overview, request]);

  return { overview, cursor, live, snap, error, scrub, goLive };
}
