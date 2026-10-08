import { useEffect, useRef } from "react";
import { useLogicalWidth } from "../hooks/useLogicalWidth";
import { fmtKb } from "../lib/format";
import { PAL, SCALE } from "../lib/palette";
import type { MemSample } from "../lib/types";
import PixelWindow from "./PixelWindow";

const H = 40;

function makeChecker(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const c = document.createElement("canvas");
  c.width = 2;
  c.height = 2;
  const g = c.getContext("2d");
  if (!g) return null;
  g.fillStyle = PAL.mint;
  g.globalAlpha = 0.55;
  g.fillRect(0, 0, 1, 1);
  g.fillRect(1, 1, 1, 1);
  return ctx.createPattern(c, "repeat");
}

export default function MemoryGraph({ history }: { history: MemSample[] }) {
  const { ref, width } = useLogicalWidth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const patternRef = useRef<CanvasPattern | null>(null);
  const hasData = history.length >= 2;

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || width === 0 || !hasData) return;
    const raf = requestAnimationFrame(() => {
      if (cv.width !== width) cv.width = width;
      if (cv.height !== H) cv.height = H;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      if (!patternRef.current) patternRef.current = makeChecker(ctx);

      ctx.fillStyle = PAL.bg;
      ctx.fillRect(0, 0, width, H);
      ctx.fillStyle = PAL.grid;
      for (let y = 0; y < H; y += 8) ctx.fillRect(0, y, width, 1);
      for (let x = 0; x < width; x += 8) ctx.fillRect(x, 0, 1, H);

      let max = 1;
      for (const s of history) if (s.rss_kb > max) max = s.rss_kb;
      max *= 1.15;
      const n = history.length;
      const yOf = (kb: number) => H - 2 - Math.round((kb / max) * (H - 6));

      for (let x = 0; x < width; x++) {
        const s = history[Math.min(n - 1, Math.round((x * (n - 1)) / (width - 1)))];
        const y = yOf(s.rss_kb);
        if (patternRef.current) {
          ctx.fillStyle = patternRef.current;
          ctx.fillRect(x, y, 1, H - y);
        }
        ctx.fillStyle = PAL.sakura;
        ctx.fillRect(x, y, 1, 2);
      }
      ctx.fillStyle = PAL.gold;
      ctx.fillRect(width - 2, 0, 2, H); // "now" marker at the cursor
    });
    return () => cancelAnimationFrame(raf);
  }, [history, width, hasData]);

  const last = history.length ? history[history.length - 1] : null;

  return (
    <PixelWindow
      title="MEMORY GRAPH"
      jp="メモリグラフ"
      accent="mint"
      right={<span className="font-body text-[18px]">{last ? fmtKb(last.rss_kb) : "—"}</span>}
    >
      <div ref={ref} className="border-3 border-frame">
        {hasData ? (
          <canvas ref={canvasRef} className="pixel-canvas" style={{ width: width * SCALE, height: H * SCALE }} />
        ) : (
          <div className="retro-grid flex items-center justify-center text-center" style={{ height: H * SCALE }}>
            <div>
              <div className="font-pixel text-[10px] text-sakura">NO SIGNAL</div>
              <div className="jp-sub">シグナルなし</div>
            </div>
          </div>
        )}
      </div>
    </PixelWindow>
  );
}
