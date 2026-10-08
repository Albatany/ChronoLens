/** ChronoLens — pixel-perfect Tailwind extensions (Lo-Fi Synthwave × Tokyo-night). */
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    // Retro windows have no rounded corners. Ever.
    borderRadius: { none: "0px", DEFAULT: "0px" },
    extend: {
      colors: {
        abyss: "#0D0E15",    // deep midnight-indigo background
        charcoal: "#1E1F29", // window borders & cards
        frame: "#34364A",    // lighter charcoal for 3px window frames
        sakura: "#FFB7C5",   // pastel sakura pink
        mint: "#74ECCF",     // cyber mint / cyan
        gold: "#E8D898",     // soft lavender gold
        ink: "#E6E6F0",
        dim: "#8A8CA6",
      },
      fontFamily: {
        // Press Start 2P / VT323 have no kana, so DotGothic16 is the pixel-style JP fallback.
        pixel: ['"Press Start 2P"', '"DotGothic16"', "monospace"],
        body: ['"VT323"', '"DotGothic16"', "monospace"],
        jp: ['"DotGothic16"', "monospace"],
      },
      borderWidth: { 3: "3px" },
      spacing: { px2: "2px", px3: "3px", px4: "4px" },
      boxShadow: {
        pixel: "4px 4px 0 0 #000",
        "pixel-inset":
          "inset -3px -3px 0 0 rgba(0,0,0,.3), inset 3px 3px 0 0 rgba(255,255,255,.3)",
      },
      keyframes: {
        "grid-scroll": {
          "0%": { backgroundPosition: "0 0" },
          "100%": { backgroundPosition: "0 16px" },
        },
        blink: { "0%,49%": { opacity: "1" }, "50%,100%": { opacity: "0" } },
      },
      animation: {
        "grid-scroll": "grid-scroll 1.6s steps(8) infinite",
        blink: "blink 1s steps(1) infinite",
      },
    },
  },
  plugins: [],
};
