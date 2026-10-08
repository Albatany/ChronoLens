import { useEffect, useRef, useState } from "react";
import { SCALE } from "../lib/palette";

export function useLogicalWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setWidth(Math.max(32, Math.floor(entry.contentRect.width / SCALE))),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}
