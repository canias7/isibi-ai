import { Monitor, Apple, Terminal, Download, Mic, Eye, MousePointer } from "lucide-react";

const API_BASE = "https://isibi-backend.onrender.com/api";

const DOWNLOAD_LINKS = {
  mac: `${API_BASE}/ghost-mode/download/mac`,
  win: `${API_BASE}/ghost-mode/download/win`,
  linux: `${API_BASE}/ghost-mode/download/linux`,
} as const;

const PLATFORMS = [
  { id: "mac" as const, label: "macOS", Icon: Apple },
  { id: "win" as const, label: "Windows", Icon: Monitor },
  { id: "linux" as const, label: "Linux", Icon: Terminal },
];

function getDetectedPlatform(): "mac" | "win" | "linux" {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "win";
  if (ua.includes("linux")) return "linux";
  return "mac";
}

const FEATURES = [
  { icon: Mic, label: "Voice Commands" },
  { icon: Eye, label: "Screen Vision" },
  { icon: MousePointer, label: "Full Control" },
];

export function GhostModeDownload() {
  const detected = getDetectedPlatform();
  const primary = PLATFORMS.find((p) => p.id === detected) || PLATFORMS[0];

  return (
    <section
      className="mx-auto max-w-5xl px-4 py-16"
      data-animate
      id="ghost-mode"
    >
      <div
        className="relative overflow-hidden rounded-3xl p-8 md:p-12"
        style={{ background: "#0a0015" }}
      >
        {/* Glow effects */}
        <div
          className="pointer-events-none absolute -top-24 left-1/2 h-48 w-96 -translate-x-1/2 rounded-full opacity-30 blur-3xl"
          style={{ background: "radial-gradient(circle, #ec4899, transparent)" }}
        />
        <div
          className="pointer-events-none absolute -bottom-24 right-12 h-40 w-40 rounded-full opacity-20 blur-3xl"
          style={{ background: "radial-gradient(circle, #8b5cf6, transparent)" }}
        />

        <div className="relative flex flex-col items-center gap-8 text-center">
          {/* Orb */}
          <div
            className="h-20 w-20 rounded-full"
            style={{
              background:
                "radial-gradient(circle at 40% 40%, #f472b6, #ec4899 40%, #a855f7 70%, #6366f1)",
              boxShadow:
                "0 0 30px rgba(236,72,153,.5), 0 0 60px rgba(236,72,153,.2)",
              animation: "ghost-float 3s ease-in-out infinite",
            }}
          />

          {/* Text */}
          <div>
            <h2
              className="mb-2 text-3xl font-bold md:text-4xl"
              style={{
                background: "linear-gradient(135deg, #ec4899, #8b5cf6)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Ghost Mode
            </h2>
            <p className="text-base text-white/50">
              Your AI takes the wheel. Speak a command and watch it happen.
            </p>
          </div>

          {/* Feature pills */}
          <div className="flex flex-wrap justify-center gap-3">
            {FEATURES.map(({ icon: Icon, label }) => (
              <span
                key={label}
                className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium"
                style={{
                  background: "rgba(255,255,255,.05)",
                  border: "1px solid rgba(236,72,153,.15)",
                  color: "#c4b5fd",
                }}
              >
                <Icon className="h-4 w-4" style={{ color: "#ec4899" }} />
                {label}
              </span>
            ))}
          </div>

          {/* Primary download button */}
          <a
            href={DOWNLOAD_LINKS[detected]}
            download
            className="flex items-center gap-3 rounded-xl px-8 py-4 text-base font-semibold text-white transition hover:-translate-y-0.5"
            style={{
              background: "linear-gradient(135deg, #ec4899, #8b5cf6)",
              boxShadow: "0 0 24px rgba(236,72,153,.35)",
            }}
          >
            <Download className="h-5 w-5" />
            Download for {primary.label}
          </a>

          {/* Secondary platform row */}
          <div className="flex gap-3">
            {PLATFORMS.filter((p) => p.id !== detected).map(({ id, label, Icon }) => (
              <a
                key={id}
                href={DOWNLOAD_LINKS[id]}
                download
                className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition"
                style={{
                  background: "rgba(255,255,255,.06)",
                  color: "rgba(240,230,255,.5)",
                  border: "1px solid rgba(255,255,255,.08)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,.1)";
                  e.currentTarget.style.color = "#f0e6ff";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,.06)";
                  e.currentTarget.style.color = "rgba(240,230,255,.5)";
                }}
              >
                <Icon className="h-4 w-4" />
                {label}
              </a>
            ))}
          </div>

          <p className="text-xs" style={{ color: "rgba(240,230,255,.25)" }}>
            Press F9 after install to summon Ghost Mode
          </p>
        </div>

        {/* Keyframe animation */}
        <style>{`
          @keyframes ghost-float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-8px); }
          }
        `}</style>
      </div>
    </section>
  );
}
