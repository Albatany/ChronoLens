import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { fmtKb } from "../lib/format";
import type { ProcInfo, Status } from "../lib/types";

interface Props {
  status: Status | null;
  onWorkspace: (path: string) => void;
  onTarget: (pid: number | null) => void;
  onDemo: () => void;
}

export default function ConfigBar({ status, onWorkspace, onTarget, onDemo }: Props) {
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [procs, setProcs] = useState<ProcInfo[]>([]);

  const workspace = status?.workspace ?? "";
  useEffect(() => {
    if (!dirty) setDraft(workspace);
  }, [workspace, dirty]);

  const apply = () => {
    if (!draft.trim()) return;
    onWorkspace(draft);
    setDirty(false);
  };

  const scanProcs = () => {
    api.listProcesses().then(setProcs).catch(() => {});
  };

  const targetPid = status?.target_pid ?? 0;
  const options = procs.some((p) => p.pid === targetPid)
    ? procs
    : [{ pid: targetPid, name: status?.target_name || "ChronoLens (self)", rss_kb: 0 }, ...procs];

  return (
    <div className="pixel-box mb-4 flex flex-wrap items-end gap-x-5 gap-y-3 p-3">
      <label className="flex min-w-[260px] flex-1 flex-col gap-1">
        <span className="label-dim text-[16px]">
          WORKSPACE <span className="jp-sub">作業フォルダ</span>
        </span>
        <span className="flex gap-2">
          <input
            className="pixel-input flex-1"
            value={draft}
            spellCheck={false}
            onChange={(e) => {
              setDraft(e.target.value);
              setDirty(true);
            }}
            onKeyDown={(e) => e.key === "Enter" && apply()}
          />
          <button className="pixel-btn" onClick={apply}>
            SET
          </button>
        </span>
      </label>

      <label className="flex min-w-[240px] flex-col gap-1">
        <span className="label-dim text-[16px]">
          TARGET PROCESS <span className="jp-sub">監視対象</span>
        </span>
        <span className="flex gap-2">
          <select
            className="pixel-input max-w-[260px]"
            value={targetPid}
            onFocus={scanProcs}
            onChange={(e) => onTarget(Number(e.target.value))}
          >
            {options.map((p) => (
              <option key={p.pid} value={p.pid}>
                {p.name} #{p.pid}
                {p.rss_kb ? ` · ${fmtKb(p.rss_kb)}` : ""}
              </option>
            ))}
          </select>
          <button className="pixel-btn ghost" onClick={() => onTarget(null)} title="Monitor ChronoLens itself">
            SELF
          </button>
        </span>
      </label>

      <button className="pixel-btn gold" onClick={onDemo} title="Create / edit / delete a few files in the workspace">
        DEMO <span className="jp-sub !text-abyss">デモ</span>
      </button>
    </div>
  );
}
