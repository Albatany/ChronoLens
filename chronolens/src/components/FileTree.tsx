import { memo, useMemo, useState } from "react";
import { fmtBytes } from "../lib/format";
import type { FileEntry } from "../lib/types";
import PixelWindow from "./PixelWindow";

const ROW_H = 22;
const VIEW_H = 270;
const FRESH_MS = 1500;

interface Row {
  key: string;
  depth: number;
  name: string;
  dir: boolean;
  size: number;
  fresh: boolean;
}

/** Paths arrive sorted; derive directory rows by diffing consecutive path prefixes. */
function buildRows(files: FileEntry[]): Row[] {
  const rows: Row[] = [];
  let prev: string[] = [];
  for (const f of files) {
    const parts = f.path.split("/");
    const dirs = parts.slice(0, -1);
    let common = 0;
    while (common < prev.length && common < dirs.length && prev[common] === dirs[common]) common++;
    for (let d = common; d < dirs.length; d++) {
      rows.push({ key: "d:" + dirs.slice(0, d + 1).join("/"), depth: d, name: dirs[d] + "/", dir: true, size: 0, fresh: false });
    }
    rows.push({ key: f.path, depth: dirs.length, name: parts[parts.length - 1], dir: false, size: f.size, fresh: f.age_ms < FRESH_MS });
    prev = dirs;
  }
  return rows;
}

const RowView = memo(function RowView({ r, top }: { r: Row; top: number }) {
  return (
    <div
      className="absolute left-0 right-0 flex items-center justify-between pr-2"
      style={{ top, height: ROW_H, paddingLeft: 8 + r.depth * 14 }}
    >
      <span className={`truncate ${r.dir ? "text-gold" : r.fresh ? "text-sakura" : "text-ink"}`}>
        {r.dir ? "▸ " : r.fresh ? "★ " : "· "}
        {r.name}
      </span>
      {!r.dir && <span className="label-dim ml-3 shrink-0">{fmtBytes(r.size)}</span>}
    </div>
  );
});

interface Props {
  files: FileEntry[];
  fileCount: number;
  totalBytes: number;
  truncated: boolean;
}

/** Windowed list: only ~15 rows exist in the DOM no matter how large the snapshot is. */
export default function FileTree({ files, fileCount, totalBytes, truncated }: Props) {
  const rows = useMemo(() => buildRows(files), [files]);
  const [top, setTop] = useState(0);
  const first = Math.max(0, Math.floor(top / ROW_H) - 2);
  const last = Math.min(rows.length, first + Math.ceil(VIEW_H / ROW_H) + 5);

  return (
    <PixelWindow
      title="FILE TREE SNAPSHOT"
      jp="ファイルツリー"
      accent="gold"
      className="h-full"
      right={<span className="font-body text-[18px]">{fileCount.toLocaleString()} files · {fmtBytes(totalBytes)}</span>}
    >
      {rows.length === 0 ? (
        <div className="retro-grid flex items-center justify-center border-3 border-frame text-center" style={{ height: VIEW_H }}>
          <div>
            <div className="font-pixel text-[10px] text-mint">EMPTY WORKSPACE</div>
            <div className="jp-sub">ファイルがありません — DEMO を押してみて</div>
          </div>
        </div>
      ) : (
        <div className="overflow-y-auto border-3 border-frame bg-abyss" style={{ height: VIEW_H }} onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
          <div className="relative" style={{ height: rows.length * ROW_H }}>
            {rows.slice(first, last).map((r, i) => (
              <RowView key={r.key} r={r} top={(first + i) * ROW_H} />
            ))}
          </div>
        </div>
      )}
      {truncated && <div className="jp-sub mt-1">先頭 {files.length} 件のみ表示 / showing first {files.length}</div>}
    </PixelWindow>
  );
}
