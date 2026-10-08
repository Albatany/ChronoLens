import ReactDOM from "react-dom/client";
import "@fontsource/press-start-2p";
import "@fontsource/vt323";
import "@fontsource/dotgothic16";
import "./index.css";
import App from "./App";

// No <StrictMode>: its dev-only double mount would register the live channel twice.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
