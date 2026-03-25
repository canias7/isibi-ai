import { useState } from "react";
import { User, Power, Download, Trash2, ExternalLink } from "lucide-react";

interface AppNode {
  id: string;
  name: string;
  type: "software" | "website" | "app" | "agent";
  status: "online" | "offline";
  color: string;
  url?: string;
}

const MOCK_APPS: AppNode[] = [
  { id: "1", name: "Real Estate CRM", type: "software", status: "online", color: "#3b82f6" },
  { id: "2", name: "Portfolio Site", type: "website", status: "online", color: "#10b981" },
  { id: "3", name: "Fitness Tracker", type: "app", status: "offline", color: "#8b5cf6" },
  { id: "4", name: "Support Agent", type: "agent", status: "online", color: "#f59e0b" },
  { id: "5", name: "Inventory System", type: "software", status: "offline", color: "#ef4444" },
  { id: "6", name: "Landing Page", type: "website", status: "online", color: "#06b6d4" },
];

const TYPE_LABEL: Record<string, string> = {
  software: "Software",
  website: "Website",
  app: "App",
  agent: "Agent",
};

export function MyAppsPage() {
  const [apps, setApps] = useState(MOCK_APPS);
  const [selected, setSelected] = useState<AppNode | null>(null);

  const toggleStatus = (id: string) => {
    setApps((prev) =>
      prev.map((a) =>
        a.id === id ? { ...a, status: a.status === "online" ? "offline" : "online" } : a
      )
    );
  };

  // Calculate positions in a circle around center
  const getPosition = (index: number, total: number, radius: number) => {
    const angle = (index * 2 * Math.PI) / total - Math.PI / 2;
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-black">My Apps</h1>
          <p className="mt-1 text-sm text-gray-500">
            Your connected apps and services. Click an app to manage it.
          </p>
        </div>

        {/* Octopus visualization */}
        <div className="relative mx-auto mb-10" style={{ height: 520, maxWidth: 600 }}>
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
          <div
            className="absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
          >
            <div className="flex h-20 w-20 items-center justify-center rounded-full border-[3px] border-black bg-white shadow-lg">
              <User className="h-8 w-8 text-black" />
            </div>
            <span className="mt-2 text-sm font-semibold text-black">You</span>
            <span className="text-[11px] text-gray-400">{apps.filter((a) => a.status === "online").length} online</span>
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
                  onClick={() => setSelected(selected?.id === app.id ? null : app)}
                  className={`group relative flex flex-col items-center transition-transform hover:scale-110 ${
                    selected?.id === app.id ? "scale-110" : ""
                  }`}
                >
                  {/* Node circle */}
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

                  {/* Status dot */}
                  <div
                    className={`absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-white ${
                      isOnline ? "bg-green-500" : "bg-gray-300"
                    }`}
                  />

                  {/* Label */}
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
        {selected && (
          <div className="mx-auto max-w-md rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-full"
                  style={{ backgroundColor: selected.color + "15", color: selected.color }}
                >
                  <span className="text-base font-bold">{selected.name.charAt(0)}</span>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-black">{selected.name}</h3>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">{TYPE_LABEL[selected.type]}</span>
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-medium ${
                        selected.status === "online" ? "text-green-600" : "text-gray-400"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          selected.status === "online" ? "bg-green-500" : "bg-gray-300"
                        }`}
                      />
                      {selected.status === "online" ? "Online" : "Offline"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => toggleStatus(selected.id)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition ${
                  selected.status === "online"
                    ? "border-red-200 text-red-600 hover:bg-red-50"
                    : "border-green-200 text-green-600 hover:bg-green-50"
                }`}
              >
                <Power className="h-3.5 w-3.5" />
                {selected.status === "online" ? "Turn Off" : "Turn On"}
              </button>
              <button className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 transition hover:bg-gray-50">
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </button>
              <button className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 transition hover:bg-gray-50">
                <Download className="h-3.5 w-3.5" />
                Download
              </button>
              <button className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-red-500 transition hover:bg-red-50">
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
                onClick={() => setSelected(app)}
                className={`flex cursor-pointer items-center justify-between rounded-lg border px-4 py-3 transition hover:border-gray-300 ${
                  selected?.id === app.id ? "border-gray-300 bg-gray-50" : "border-gray-200"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-full"
                    style={{ backgroundColor: app.color + "15", color: app.color }}
                  >
                    <span className="text-xs font-bold">{app.name.charAt(0)}</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-black">{app.name}</p>
                    <p className="text-xs text-gray-400">{TYPE_LABEL[app.type]}</p>
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
