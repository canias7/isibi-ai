/// <reference types="vite/client" />

// Desktop (Electron) bridge — injected by electron/preload.cjs. Absent on
// web/mobile, so every use must feature-detect with optional chaining.
interface Window {
  gfDesktop?: {
    onNewChat(cb: () => void): () => void;
  };
}
