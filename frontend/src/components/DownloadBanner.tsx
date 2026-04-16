import { Monitor, Apple, Terminal, Download } from "lucide-react";

const GITHUB_RELEASE_BASE =
  "https://github.com/canias7/isibi-ai/releases/latest/download";

const DOWNLOAD_LINKS = {
  mac: `${GITHUB_RELEASE_BASE}/ISIBI-Control-Center-macOS.zip`,
  win: `${GITHUB_RELEASE_BASE}/ISIBI-Control-Center-Setup.exe`,
  linux: `${GITHUB_RELEASE_BASE}/ISIBI-Control-Center.AppImage`,
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

/**
 * Full-width gradient download banner for the Control Center / Landing page.
 */
export function DownloadBanner({ compact = false }: { compact?: boolean }) {
  // Hide banner when running inside the desktop app
  if ((window as any).isibiDesktop?.isDesktop) return null;

  const detected = getDetectedPlatform();

  if (compact) {
    return (
      <div
        className="overflow-hidden rounded-xl p-4"
        style={{
          background:
            "linear-gradient(135deg, #ec4899 0%, #8b5cf6 50%, #6366f1 100%)",
        }}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Monitor className="h-5 w-5 text-white" />
            <div>
              <p className="text-sm font-bold text-white">
                Get the Desktop App
              </p>
              <p className="text-xs text-white/70">
                Manage your apps from your desktop
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {PLATFORMS.map(({ id, label, Icon }) => (
              <a
                key={id}
                href={DOWNLOAD_LINKS[id]}
                download
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  detected === id
                    ? "bg-white text-purple-700 shadow-lg"
                    : "bg-white/20 text-white hover:bg-white/30 backdrop-blur-sm"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </a>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-2xl p-6"
      style={{
        background:
          "linear-gradient(135deg, #ec4899 0%, #8b5cf6 50%, #6366f1 100%)",
      }}
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm">
            <Monitor className="h-6 w-6 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">
              Download ISIBI Control Center
            </h2>
            <p className="text-sm text-white/80">
              Manage all your apps from your desktop
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {PLATFORMS.map(({ id, label, Icon }) => (
            <a
              key={id}
              href={DOWNLOAD_LINKS[id]}
              download
              className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
                detected === id
                  ? "bg-white text-purple-700 shadow-lg"
                  : "bg-white/20 text-white hover:bg-white/30 backdrop-blur-sm"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
              <Download className="h-3.5 w-3.5 opacity-60" />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
