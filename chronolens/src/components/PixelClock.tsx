// 8×8 sprite rendered as crisp SVG rects (a = sakura ring, b = mint hands).
const SPRITE = [
  ".aaaaaa.",
  "aa....aa",
  "a..b...a",
  "a..b...a",
  "a..bbb.a",
  "a......a",
  "aa....aa",
  ".aaaaaa.",
];
const FILL: Record<string, string> = { a: "#FFB7C5", b: "#74ECCF" };

export default function PixelClock({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden>
      {SPRITE.flatMap((row, y) =>
        [...row].map((c, x) => (c === "." ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={FILL[c]} />)),
      )}
    </svg>
  );
}
