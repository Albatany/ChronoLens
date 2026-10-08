import { useEffect, useRef } from "react";
import { useLogicalWidth } from "../hooks/useLogicalWidth";
import { fmtClock, fmtSpan } from "../lib/format";
import { PAL, SCALE } from "../lib/palette";
import type { Overview } from "../lib/types";
import PixelWindow from "./PixelWindow";

const H = 56; 
const PAD = 6; 
const STEP_MS = 1000;

interface Props {
  overview: Overview | null;
  cursorMs: number;
  live: boolean;
  onScrub: (ms: number) => void;
  onGoLive: () => void;
}

function makeDither(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const c = document.createElement("canvas");
  c.width = 2;
  c.height = 2;
  const g = c.getContext("2d");
  if (!g) return null;
  g.fillStyle = PAL.bg;
  g.fillRect(0, 0, 1, 1);
  g.fillRect(1, 1, 1, 1);
  return ctx.createPattern(c, "repeat");
}

function draw(
  ctx: CanvasRenderingContext2D,
  W: number,
  ov: Overview | null,
  cursorMs: number,
  live: boolean,
  dither: CanvasPattern | null,
) {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = PAL.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = PAL.grid;
  for (let x = 0; x < W; x += 8) ctx.fillRect(x, 0, 1, H);
  for (let y = 0; y < H; y += 8) ctx.fillRect(0, y, W, 1);
  if (!ov || ov.buckets.length === 0) return;

  const n = ov.buckets.length;
  const colW = Math.max(1, Math.ceil(W / n));
  const plotH = H - PAD * 2;
  let maxRss = 1;
  for (const b of ov.buckets) if (b.rss_kb > maxRss) maxRss = b.rss_kb;

  ctx.fillStyle = PAL.mint;
  for (let i = 0; i < n; i++) {
    const ev = ov.buckets[i].events;
    if (ev === 0) continue;
    const h = Math.min(plotH, Math.round(Math.log2(1 + ev) * 6));
    ctx.fillRect(Math.floor((i * W) / n), H - PAD - h, colW, h);
  }

  ctx.fillStyle = PAL.sakura;
  let prev = -1;
  for (let i = 0; i < n; i++) {
    const r = ov.buckets[i].rss_kb;
    if (r === 0) {
      prev = -1;
      continue;
    }
    const y = H - PAD - 2 - Math.round((r / maxRss) * (plotH - 2));
    const x = Math.floor((i * W) / n);
    const top = prev < 0 ? y : Math.min(prev, y);
    const bottom = prev < 0 ? y : Math.max(prev, y);
    ctx.fillRect(x, top, colW, bottom - top + 2);
    prev = y;
  }

  ctx.fillStyle = PAL.dim;
  for (let k = 0; k <= 8; k++) ctx.fillRect(Math.min(W - 1, Math.floor((k * W) / 8)), H - 3, 1, 3);

  const span = Math.max(1, ov.end_ms - ov.start_ms);
  const cx = Math.min(W - 2, Math.max(1, Math.round(((cursorMs - ov.start_ms) / span) * (W - 1))));
  if (!live && dither) {
    ctx.fillStyle = dither;
    ctx.fillRect(cx, 0, W - cx, H);
  }
  ctx.fillStyle = PAL.gold;
  ctx.fillRect(cx - 1, 0, 2, H);
  ctx.fillStyle = PAL.sakura;
  ctx.fillRect(cx - 3, 0, 6, 4);
  ctx.fillRect(cx - 3, H - 4, 6, 4);
}

export default function TimelineLens({ overview, cursorMs, live, onScrub, onGoLive }: Props) {
  const { ref: wrapRef, width } = useLogicalWidth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ditherRef = useRef<CanvasPattern | null>(null);
  const dragging = useRef(false);

  const start = overview?.start_ms ?? 0;
  const end = overview?.end_ms ?? 1;
  const span = Math.max(1, end - start);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || width === 0) return;
    const raf = requestAnimationFrame(() => {
      if (cv.width !== width) cv.width = width;
      if (cv.height !== H) cv.height = H;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      if (!ditherRef.current) ditherRef.current = makeDither(ctx);
      draw(ctx, width, overview, cursorMs, live, ditherRef.current);
    });
    return () => cancelAnimationFrame(raf);
  }, [overview, cursorMs, live, width]);

  const msFromPointer = (clientX: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return start + t * span;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    onScrub(msFromPointer(e.clientX));
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragging.current) onScrub(msFromPointer(e.clientX));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const big = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowLeft") onScrub(cursorMs - (span / 200) * big);
    else if (e.key === "ArrowRight") onScrub(cursorMs + (span / 200) * big);
    else if (e.key === "Home") onScrub(start);
    else if (e.key === "End") onGoLive();
    else return;
    e.preventDefault();
  };

  return (
    <PixelWindow
      title="TIME-TRAVEL TIMELINE"
      jp="タイムトラベル"
      accent="sakura"
      right={
        <span className="font-body text-[18px] tracking-normal">
          {overview ? `${overview.buffered_events.toLocaleString()} 件 / ${fmtSpan(span)}` : "—"}
        </span>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button className="pixel-btn ghost" onClick={() => onScrub(start)} title="Jump to the oldest record">
          |&lt; START
        </button>
        <button className="pixel-btn ghost" onClick={() => onScrub(cursorMs - STEP_MS)}>
          &lt; 1s
        </button>
        <button className="pixel-btn ghost" onClick={() => onScrub(cursorMs + STEP_MS)}>
          1s &gt;
        </button>
        <button className="pixel-btn pink" aria-pressed={live} onClick={onGoLive}>
          <span className={`mr-2 inline-block h-2 w-2 bg-abyss ${live ? "animate-blink" : ""}`} />
          LIVE <span className="jp-sub !text-abyss">ライブ</span>
        </button>
        <span className="jp-sub ml-auto hidden md:inline">ドラッグで過去へ · ← → キー</span>
      </div>

      <div
        ref={wrapRef}
        role="slider"
        tabIndex={0}
        aria-label="Time-travel cursor"
        aria-valuemin={start}
        aria-valuemax={end}
        aria-valuenow={Math.round(cursorMs)}
        aria-valuetext={fmtClock(cursorMs)}
        onKeyDown={onKeyDown}
        className="border-3 border-frame bg-abyss"
      >
        <canvas
          ref={canvasRef}
          className="pixel-canvas cursor-ew-resize"
          style={{ width: width * SCALE, height: H * SCALE }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>

      <div className="mt-2 flex items-end justify-between text-[20px]">
        <span className="label-dim">{fmtClock(start)}</span>
        <span className="text-gold">
          ▼ {fmtClock(cursorMs)}
          <span className="label-dim"> {live ? "(live)" : `(T-${fmtSpan(end - cursorMs)})`}</span>
        </span>
        <span className="label-dim">{fmtClock(end)}</span>
      </div>
      <div className="mt-1 flex gap-6 text-[18px]">
        <span className="text-mint">■ file events <span className="jp-sub">ファイル</span></span>
        <span className="text-sakura">■ peak RSS <span className="jp-sub">メモリ</span></span>
      </div>
    </PixelWindow>
  );
}
