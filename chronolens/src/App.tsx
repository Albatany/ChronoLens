import { useEffect, useState } from "react";
import ConfigBar from "./components/ConfigBar";
import EventLog from "./components/EventLog";
import FileTree from "./components/FileTree";
import MemoryGraph from "./components/MemoryGraph";
import PixelClock from "./components/PixelClock";
import StatsPanel from "./components/StatsPanel";
import TimelineLens from "./components/TimelineLens";
import { useTimeTravel } from "./hooks/useTimeTravel";
import { api, isTauri } from "./lib/api";
import type { Status } from "./lib/types";

const CRT_KEY = "chronolens.crt";
const VERSION = "1.0.0";

export default function App() {
  const tt = useTimeTravel();
  const [status, setStatus] = useState<Status | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [crt, setCrt] = useState<boolean>(() => {
    try {
      return localStorage.getItem(CRT_KEY) !== "off";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (!isTauri) return;
    let alive = true;
    const load = () =>
      api
        .status()
        .then((s) => {
          if (alive) setStatus(s);
        })
        .catch(() => {});
    load();
    const id = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const toggleCrt = () => {
    const next = !crt;
    setCrt(next);
    try {
      localStorage.setItem(CRT_KEY, next ? "on" : "off");
    } catch {
      /* storage unavailable: keep in-memory only */
    }
  };

  const run = (p: Promise<Status | void>) =>
    p
      .then((s) => {
        if (s) setStatus(s);
        setNotice(null);
      })
      .catch((e) => setNotice(String(e)));

  const snap = tt.snap;
  const problem = tt.error ?? notice ?? status?.error ?? null;

  return (
    <div className="mx-auto flex min-h-full max-w-[1280px] flex-col px-4 pb-3 pt-4">
      {crt && <div className="crt-overlay" aria-hidden />}

      <header className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <PixelClock />
          <div>
            <h1 className="font-pixel text-[20px] leading-none text-sakura">
              CHRONO<span className="text-mint">LENS</span>
            </h1>
            <p className="jp-sub mt-2">クロノレンズ — 時間旅行ローカルステートデバッガ</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className={`text-[20px] ${status?.watching ? "text-mint" : "text-sakura"}`}>
            {status?.watching ? "● WATCHING" : "○ IDLE"}
            <span className="jp-sub ml-2">{status?.watching ? "監視中" : "待機中"}</span>
          </span>
          <button className="pixel-btn ghost" aria-pressed={crt} onClick={toggleCrt} title="Toggle CRT scanlines">
            CRT
          </button>
        </div>
      </header>

      {problem && (
        <div role="alert" className="pixel-box mb-4 px-3 py-2 text-[20px] text-sakura">
          ! {problem}
        </div>
      )}

      <ConfigBar
        status={status}
        onWorkspace={(p) => {
          void run(api.setWorkspace(p));
          tt.goLive();
        }}
        onTarget={(pid) => void run(api.setTarget(pid))}
        onDemo={() => void run(api.demo())}
      />

      <div className="mb-4">
        <TimelineLens
          overview={tt.overview}
          cursorMs={tt.cursor}
          live={tt.live}
          onScrub={tt.scrub}
          onGoLive={tt.goLive}
        />
      </div>

      <main className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <FileTree
            files={snap?.files ?? []}
            fileCount={snap?.file_count ?? 0}
            totalBytes={snap?.total_bytes ?? 0}
            truncated={snap?.files_truncated ?? false}
          />
        </div>
        <div className="flex flex-col gap-4 lg:col-span-7">
          <MemoryGraph history={snap?.mem_history ?? []} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <StatsPanel mem={snap?.mem ?? null} name={status?.target_name ?? ""} pid={status?.target_pid ?? 0} />
            <EventLog events={snap?.recent_events ?? []} />
          </div>
        </div>
      </main>

      <footer className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t-3 border-frame pt-3 text-[18px]">
        <span className="text-gold">Copyright © 2026 Albatany</span>
        <span className="label-dim">
          ChronoLens v{VERSION} <span className="jp-sub">· 時を超えるデバッガ</span>
        </span>
      </footer>
    </div>
  );
}
