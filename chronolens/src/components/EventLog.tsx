import { fmtBytes, fmtClock } from "../lib/format";
import type { Entry, OpKind } from "../lib/types";
import PixelWindow from "./PixelWindow";

const GLYPH: Record<OpKind, { ch: string; tone: string }> = {
  created: { ch: "+", tone: "text-mint" },
  modified: { ch: "~", tone: "text-gold" },
  removed: { ch: "-", tone: "text-sakura" },
};

export default function EventLog({ events }: { events: Entry[] }) {
  return (
    <PixelWindow title="EVENT LOG" jp="イベントログ" accent="gold" className="h-full">
      {events.length === 0 ? (
        <div className="retro-grid flex h-[190px] items-center justify-center border-3 border-frame">
          <span className="jp-sub">イベントなし</span>
        </div>
      ) : (
        <ul className="h-[190px] overflow-y-auto border-3 border-frame bg-abyss p-2 text-[18px]">
          {events.map((e, i) => (
            <li key={`${e.ts_ms}-${e.path}-${i}`} className="flex gap-2 whitespace-nowrap">
              <span className={`${GLYPH[e.kind].tone} w-3`}>{GLYPH[e.kind].ch}</span>
              <span className="label-dim">{fmtClock(e.ts_ms).slice(0, 12)}</span>
              <span className="truncate">{e.path}</span>
              {e.kind !== "removed" && <span className="label-dim ml-auto">{fmtBytes(e.size)}</span>}
            </li>
          ))}
        </ul>
      )}
    </PixelWindow>
  );
}
