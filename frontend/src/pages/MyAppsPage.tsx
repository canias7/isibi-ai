import { useState } from "react";
import {
  User,
  Power,
  Download,
  Trash2,
  Pencil,
  X,
  Save,
  AppWindow,
} from "lucide-react";
import { useAppStore, type UserApp } from "@/stores/appStore";
import JSZip from "jszip";

const TYPE_LABEL: Record<string, string> = {
  software: "Software",
  website: "Website",
  app: "App",
  agent: "Agent",
};

export function MyAppsPage() {
  const { apps, toggleStatus, removeApp, updateApp } = useAppStore();
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editName, setEditName] = useState("");

  const selectedApp = apps.find((a) => a.id === selected);

  const getPosition = (index: number, total: number, radius: number) => {
    const angle = (index * 2 * Math.PI) / total - Math.PI / 2;
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
  };

  const startEdit = (app: UserApp) => {
    setEditing(app.id);
    setEditContent(app.htmlContent || "");
    setEditName(app.name);
  };

  const saveEdit = () => {
    if (!editing) return;
    updateApp(editing, { name: editName, htmlContent: editContent });
    setEditing(null);
  };

  const handleDownloadToPC = async (app: UserApp) => {
    if (!app.htmlContent) return;

    const slug = app.name.toLowerCase().replace(/\s+/g, "-");
    const zip = new JSZip();
    const folder = zip.folder(slug)!;

    folder.file("index.html", app.htmlContent);

    folder.file(
      "package.json",
      JSON.stringify(
        {
          name: slug,
          version: "1.0.0",
          main: "main.js",
          scripts: { start: "electron ." },
          dependencies: { electron: "^33.0.0" },
        },
        null,
        2
      )
    );

    folder.file(
      "main.js",
      `const { app, BrowserWindow } = require("electron");
const path = require("path");

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1024,
    height: 700,
    title: ${JSON.stringify(app.name)},
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  win.loadFile("index.html");
  win.setMenuBarVisibility(false);
});

app.on("window-all-closed", () => app.quit());
`
    );

    folder.file(
      "start.command",
      `#!/bin/bash
cd "$(dirname "$0")"
if ! command -v npm &>/dev/null; then
  echo ""
  echo "  Node.js is required to run this app."
  echo "  Install it from: https://nodejs.org"
  echo ""
  read -p "Press Enter to exit..."
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only, may take a minute)..."
  npm install --no-fund --no-audit
fi
echo "Launching ${app.name}..."
npx electron .
`,
      { unixPermissions: "755" }
    );

    folder.file(
      "start.bat",
      `@echo off
cd /d "%~dp0"
where npm >nul 2>nul || (echo. & echo   Node.js is required. Install from https://nodejs.org & echo. & pause & exit /b 1)
if not exist node_modules (
  echo Installing dependencies [first run only, may take a minute]...
  npm install --no-fund --no-audit
)
echo Launching ${app.name}...
npx electron .
`
    );

    const blob = await zip.generateAsync({ type: "blob", platform: "UNIX" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Empty state
  if (apps.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <AppWindow className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm font-medium text-black">No apps yet</p>
          <p className="mt-1 max-w-xs text-xs text-gray-400">
            Build something in the chat or download from the marketplace to see
            your apps here.
          </p>
        </div>
      </div>
    );
  }

  // Edit mode
  if (editing) {
    const app = apps.find((a) => a.id === editing);
    if (!app) return null;

    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Edit header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setEditing(null)}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-gray-100"
            >
              <X className="h-4 w-4 text-gray-500" />
            </button>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="border-b border-transparent bg-transparent text-sm font-semibold text-black focus:border-gray-300 focus:outline-none"
            />
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">
              Editing
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditing(null)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={saveEdit}
              className="flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white transition hover:bg-gray-800"
            >
              <Save className="h-3 w-3" />
              Save
            </button>
          </div>
        </div>

        {/* Edit body — two columns: code editor + live preview */}
        <div className="flex flex-1 overflow-hidden">
          {/* Code editor */}
          <div className="flex w-1/2 flex-col border-r border-gray-200">
            <div className="border-b border-gray-200 px-4 py-2">
              <span className="text-xs font-medium text-gray-500">
                HTML / Code
              </span>
            </div>
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              spellCheck={false}
              className="flex-1 resize-none bg-gray-50 p-4 font-mono text-xs text-black focus:outline-none"
            />
          </div>

          {/* Live preview */}
          <div className="flex w-1/2 flex-col">
            <div className="border-b border-gray-200 px-4 py-2">
              <span className="text-xs font-medium text-gray-500">
                Preview
              </span>
            </div>
            <iframe
              srcDoc={editContent}
              sandbox="allow-scripts"
              className="flex-1 bg-white"
              title="App preview"
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-black">My Apps</h1>
          <p className="mt-1 text-sm text-gray-500">
            Your apps hub. Click an app to manage or edit it.
          </p>
        </div>

        {/* Octopus visualization */}
        <div
          className="relative mx-auto mb-10"
          style={{ height: 520, maxWidth: 600 }}
        >
          {/* Connection lines (tentacles) */}
          <svg
            className="absolute inset-0"
            width="100%"
            height="100%"
            viewBox="-300 -260 600 520"
          >
            {apps.map((app, i) => {
              const pos = getPosition(i, apps.length, 180);
              return (
                <line
                  key={app.id}
                  x1={0}
                  y1={0}
                  x2={pos.x}
                  y2={pos.y}
                  stroke={app.status === "online" ? app.color : "#d1d5db"}
                  strokeWidth={app.status === "online" ? 2.5 : 1.5}
                  strokeDasharray={app.status === "offline" ? "6 4" : "none"}
                  opacity={app.status === "online" ? 0.6 : 0.3}
                />
              );
            })}
          </svg>

          {/* Center node — Customer */}
          <div className="absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full border-[3px] border-black bg-white shadow-lg">
              <User className="h-8 w-8 text-black" />
            </div>
            <span className="mt-2 text-sm font-semibold text-black">You</span>
            <span className="text-[11px] text-gray-400">
              {apps.filter((a) => a.status === "online").length} online
            </span>
          </div>

          {/* App nodes around the center */}
          {apps.map((app, i) => {
            const pos = getPosition(i, apps.length, 180);
            const isOnline = app.status === "online";
            return (
              <div
                key={app.id}
                className="absolute left-1/2 top-1/2 z-10"
                style={{
                  transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))`,
                }}
              >
                <button
                  onClick={() =>
                    setSelected(selected === app.id ? null : app.id)
                  }
                  className={`group relative flex flex-col items-center transition-transform hover:scale-110 ${
                    selected === app.id ? "scale-110" : ""
                  }`}
                >
                  <div
                    className="flex h-14 w-14 items-center justify-center rounded-full border-2 bg-white shadow-md transition"
                    style={{
                      borderColor: isOnline ? app.color : "#d1d5db",
                    }}
                  >
                    <span
                      className="text-lg font-bold"
                      style={{ color: isOnline ? app.color : "#9ca3af" }}
                    >
                      {app.name.charAt(0)}
                    </span>
                  </div>

                  <div
                    className={`absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-white ${
                      isOnline ? "bg-green-500" : "bg-gray-300"
                    }`}
                  />

                  <span className="mt-1.5 max-w-[100px] truncate text-center text-xs font-medium text-black">
                    {app.name}
                  </span>
                  <span
                    className={`text-[10px] font-medium ${
                      isOnline ? "text-green-600" : "text-gray-400"
                    }`}
                  >
                    {isOnline ? "Online" : "Offline"}
                  </span>
                </button>
              </div>
            );
          })}
        </div>

        {/* Selected app details */}
        {selectedApp && (
          <div className="mx-auto max-w-md rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-full"
                  style={{
                    backgroundColor: selectedApp.color + "15",
                    color: selectedApp.color,
                  }}
                >
                  <span className="text-base font-bold">
                    {selectedApp.name.charAt(0)}
                  </span>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-black">
                    {selectedApp.name}
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">
                      {TYPE_LABEL[selectedApp.type]}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-medium ${
                        selectedApp.status === "online"
                          ? "text-green-600"
                          : "text-gray-400"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          selectedApp.status === "online"
                            ? "bg-green-500"
                            : "bg-gray-300"
                        }`}
                      />
                      {selectedApp.status === "online" ? "Online" : "Offline"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => toggleStatus(selectedApp.id)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition ${
                  selectedApp.status === "online"
                    ? "border-red-200 text-red-600 hover:bg-red-50"
                    : "border-green-200 text-green-600 hover:bg-green-50"
                }`}
              >
                <Power className="h-3.5 w-3.5" />
                {selectedApp.status === "online" ? "Turn Off" : "Turn On"}
              </button>
              {selectedApp.htmlContent && (
                <button
                  onClick={() => startEdit(selectedApp)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </button>
              )}
              {selectedApp.htmlContent && (
                <button
                  onClick={() => handleDownloadToPC(selectedApp)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </button>
              )}
              <button
                onClick={() => {
                  removeApp(selectedApp.id);
                  setSelected(null);
                }}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-red-500 transition hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* App list (compact) */}
        <div className="mx-auto mt-8 max-w-2xl">
          <h2 className="mb-3 text-sm font-semibold text-black">All Apps</h2>
          <div className="space-y-2">
            {apps.map((app) => (
              <div
                key={app.id}
                onClick={() => setSelected(app.id)}
                className={`flex cursor-pointer items-center justify-between rounded-lg border px-4 py-3 transition hover:border-gray-300 ${
                  selected === app.id
                    ? "border-gray-300 bg-gray-50"
                    : "border-gray-200"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-full"
                    style={{
                      backgroundColor: app.color + "15",
                      color: app.color,
                    }}
                  >
                    <span className="text-xs font-bold">
                      {app.name.charAt(0)}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-black">{app.name}</p>
                    <p className="text-xs text-gray-400">
                      {TYPE_LABEL[app.type]} · {app.source === "marketplace" ? "Marketplace" : "Created"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      app.status === "online"
                        ? "bg-green-50 text-green-700"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        app.status === "online" ? "bg-green-500" : "bg-gray-300"
                      }`}
                    />
                    {app.status === "online" ? "Online" : "Offline"}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleStatus(app.id);
                    }}
                    className={`rounded-md p-1.5 transition ${
                      app.status === "online"
                        ? "text-gray-400 hover:bg-red-50 hover:text-red-500"
                        : "text-gray-400 hover:bg-green-50 hover:text-green-500"
                    }`}
                  >
                    <Power className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
