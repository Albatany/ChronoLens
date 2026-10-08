import { fmtKb } from "../lib/format";
import type { MemSample } from "../lib/types";
import PixelWindow from "./PixelWindow";

function Cell({ label, jp, value, tone }: { label: string; jp: string; value: string; tone: string }) {
  return (
    <div className="border-3 border-frame bg-abyss px-3 py-2">
      <div className="label-dim flex items-baseline gap-2 text-[16px]">
        {label} <span className="jp-sub !text-[12px]">{jp}</span>
      </div>
      <div className={`text-[26px] ${tone}`}>{value}</div>
    </div>
  );
}

export default function StatsPanel({ mem, name, pid }: { mem: MemSample | null; name: string; pid: number }) {
  return (
    <PixelWindow
      title="PROCESS VITALS"
      jp="プロセス状態"
      accent="sakura"
      right={<span className="font-body max-w-[11rem] truncate text-[18px]">{name || "—"} #{pid}</span>}
    >
      <div className="grid grid-cols-2 gap-2">
        <Cell label="RSS" jp="実メモリ" value={mem ? fmtKb(mem.rss_kb) : "—"} tone="text-mint" />
        <Cell label="VIRT" jp="仮想" value={mem ? fmtKb(mem.vsz_kb) : "—"} tone="text-ink" />
        <Cell label="THREADS" jp="スレッド" value={mem ? String(mem.threads) : "—"} tone="text-gold" />
        <Cell label="HANDLES" jp="ハンドル" value={mem ? String(mem.handles) : "—"} tone="text-gold" />
        <Cell label="CPU" jp="使用率" value={mem ? `${mem.cpu_pct.toFixed(1)}%` : "—"} tone="text-sakura" />
      </div>
    </PixelWindow>
  );
}
