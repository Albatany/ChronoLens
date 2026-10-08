import type { CSSProperties, ReactNode } from "react";

type Accent = "mint" | "sakura" | "gold";

interface Props {
  title: string;
  jp: string;
  accent?: Accent;
  right?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Retro game window: notched 3px frame + coloured title bar with a Japanese sub-label. */
export default function PixelWindow({ title, jp, accent = "mint", right, className = "", children }: Props) {
  const style = { "--accent": `var(--${accent})` } as CSSProperties;
  return (
    <section className={`pixel-box flex flex-col ${className}`} style={style}>
      <header className="pixel-titlebar">
        <span className="flex items-baseline gap-3">
          <span>{title}</span>
          <span className="jp">{jp}</span>
        </span>
        {right ?? (
          <span className="flex gap-1" aria-hidden>
            <i className="block h-2 w-2 bg-abyss/60" />
            <i className="block h-2 w-2 bg-abyss/60" />
            <i className="block h-2 w-2 bg-abyss" />
          </span>
        )}
      </header>
      <div className="min-h-0 flex-1 p-3">{children}</div>
    </section>
  );
}
