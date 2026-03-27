/**
 * preview-bundle.tsx — Standalone entry point for the deployed app.
 *
 * This file gets built (via vite.preview.config.ts) into a single IIFE JS
 * bundle + a CSS file.  The deployer injects spec data into the HTML page
 * and this bundle renders SpecPreview with it.
 *
 * Global contract:
 *   window.__ISIBI_SPEC__   — the full spec object
 *   window.__ISIBI_CONFIG__ — { projectId, apiBase }
 */
import "./preview-bundle.css";
import { createRoot } from "react-dom/client";
import { SpecPreview } from "./components/SpecPreview";

declare global {
  interface Window {
    __ISIBI_SPEC__: any;
    __ISIBI_CONFIG__: {
      projectId: string;
      apiBase: string;
    };
  }
}

function DeployedApp() {
  const spec = window.__ISIBI_SPEC__;
  const config = window.__ISIBI_CONFIG__;

  if (!spec) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        fontFamily: "'Inter', system-ui, sans-serif",
        color: "#9ca3af",
        fontSize: 14,
      }}>
        Loading...
      </div>
    );
  }

  return (
    <SpecPreview
      spec={spec}
      device="desktop"
      projectId={config?.projectId || null}
      apiBase={config?.apiBase || ""}
      startLive={true}
    />
  );
}

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<DeployedApp />);
}
