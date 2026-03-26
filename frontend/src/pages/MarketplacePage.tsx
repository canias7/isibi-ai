import { useState } from "react";
import { Search, Download, Eye, X, Star, Check } from "lucide-react";
import JSZip from "jszip";
import { useAppStore } from "@/stores/appStore";

type Category = "all" | "software" | "websites" | "apps" | "agents";

interface MarketplaceItem {
  id: string;
  title: string;
  description: string;
  creator: string;
  category: Exclude<Category, "all">;
  price: number; // 0 = free
  rating: number;
  downloads: number;
  preview: string; // placeholder color/gradient
  tags: string[];
  downloadable?: string; // HTML content to download as a standalone app
}

const TASK_TRACKER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Task Tracker Pro</title>
<link rel="manifest" href="data:application/json;base64,">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#ffffff">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;color:#1a1a1a;min-height:100vh}
.header{background:#fff;border-bottom:1px solid #e5e7eb;padding:16px 24px;display:flex;align-items:center;justify-content:space-between}
.header h1{font-size:18px;font-weight:600}
.header .badge{background:#000;color:#fff;font-size:10px;padding:2px 8px;border-radius:99px}
.container{max-width:800px;margin:0 auto;padding:24px}
.add-bar{display:flex;gap:8px;margin-bottom:24px}
.add-bar input{flex:1;padding:10px 14px;border:1px solid #e5e7eb;border-radius:10px;font-size:14px;outline:none}
.add-bar input:focus{border-color:#000}
.add-bar select{padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px;font-size:14px;outline:none;background:#fff}
.add-bar button{padding:10px 20px;background:#000;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:500;cursor:pointer}
.add-bar button:hover{background:#333}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
.stat{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;text-align:center}
.stat .num{font-size:28px;font-weight:700}
.stat .lbl{font-size:12px;color:#6b7280;margin-top:2px}
.filters{display:flex;gap:6px;margin-bottom:16px}
.filters button{padding:6px 14px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;background:#fff;cursor:pointer}
.filters button.active{background:#000;color:#fff;border-color:#000}
.task{display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;margin-bottom:8px;transition:all .15s}
.task:hover{border-color:#ccc}
.task.done{opacity:.5}
.task.done .title{text-decoration:line-through}
.cb{width:20px;height:20px;border:2px solid #d1d5db;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.cb.checked{background:#000;border-color:#000}
.cb.checked::after{content:'\\2713';color:#fff;font-size:12px}
.title{flex:1;font-size:14px}
.priority{font-size:11px;padding:2px 8px;border-radius:99px;font-weight:500}
.priority.high{background:#fee2e2;color:#dc2626}
.priority.medium{background:#fef3c7;color:#d97706}
.priority.low{background:#d1fae5;color:#059669}
.del{width:28px;height:28px;border:none;background:transparent;cursor:pointer;border-radius:6px;font-size:16px;color:#9ca3af;display:flex;align-items:center;justify-content:center}
.del:hover{background:#fee2e2;color:#dc2626}
.empty{text-align:center;padding:60px 20px;color:#9ca3af;font-size:14px}
</style>
</head>
<body>
<div class="header">
<h1>Task Tracker Pro</h1>
<span class="badge">Built with isibi.ai</span>
</div>
<div class="container">
<div class="add-bar">
<input id="inp" type="text" placeholder="Add a new task..." onkeydown="if(event.key==='Enter')addTask()">
<select id="pri"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option></select>
<button onclick="addTask()">Add Task</button>
</div>
<div class="stats" id="stats"></div>
<div class="filters" id="filters"></div>
<div id="list"></div>
</div>
<script>
let tasks=JSON.parse(localStorage.getItem('tt_tasks')||'[]');
let filter='all';
function id(){return Math.random().toString(36).slice(2,9)}
function addTask(){const inp=document.getElementById('inp');const v=inp.value.trim();if(!v)return;tasks.push({id:id(),title:v,priority:document.getElementById('pri').value,done:false,created:Date.now()});inp.value='';save();render()}
function toggle(tid){const t=tasks.find(x=>x.id===tid);if(t)t.done=!t.done;save();render()}
function del(tid){tasks=tasks.filter(x=>x.id!==tid);save();render()}
function save(){localStorage.setItem('tt_tasks',JSON.stringify(tasks))}
function setFilter(f){filter=f;render()}
function render(){
const list=document.getElementById('list');
const filtered=filter==='all'?tasks:filter==='active'?tasks.filter(t=>!t.done):tasks.filter(t=>t.done);
const total=tasks.length,done=tasks.filter(t=>t.done).length,active=total-done;
const high=tasks.filter(t=>t.priority==='high'&&!t.done).length;
document.getElementById('stats').innerHTML=\`
<div class="stat"><div class="num">\${total}</div><div class="lbl">Total</div></div>
<div class="stat"><div class="num">\${active}</div><div class="lbl">Active</div></div>
<div class="stat"><div class="num">\${done}</div><div class="lbl">Completed</div></div>
<div class="stat"><div class="num">\${high}</div><div class="lbl">High Priority</div></div>\`;
document.getElementById('filters').innerHTML=['all','active','completed'].map(f=>\`<button class="\${filter===f?'active':''}" onclick="setFilter('\${f}')">\${f.charAt(0).toUpperCase()+f.slice(1)}</button>\`).join('');
if(!filtered.length){list.innerHTML='<div class="empty">No tasks here. Add one above!</div>';return}
list.innerHTML=filtered.map(t=>\`<div class="task \${t.done?'done':''}">
<div class="cb \${t.done?'checked':''}" onclick="toggle('\${t.id}')"></div>
<span class="title">\${t.title}</span>
<span class="priority \${t.priority}">\${t.priority}</span>
<button class="del" onclick="del('\${t.id}')">&#10005;</button>
</div>\`).join('')}
render();
<\/script>
</body>
</html>`;

const MOCK_ITEMS: MarketplaceItem[] = [
  {
    id: "0",
    title: "Task Tracker Pro",
    description: "A complete task management app with priority levels (high/medium/low), filters, stats dashboard, and local storage persistence. Add tasks, mark complete, delete, and filter by status. Works entirely offline — no server needed.",
    creator: "isibi",
    category: "software",
    price: 0,
    rating: 4.9,
    downloads: 4820,
    preview: "from-emerald-500 to-teal-600",
    tags: ["Tasks", "Productivity", "Offline", "Free"],
    downloadable: TASK_TRACKER_HTML,
  },
  {
    id: "1",
    title: "Real Estate CRM",
    description: "Complete CRM for real estate agents with lead tracking, deal pipeline, property management, and automated follow-ups.",
    creator: "isibi",
    category: "software",
    price: 49,
    rating: 4.8,
    downloads: 1240,
    preview: "from-blue-500 to-indigo-600",
    tags: ["CRM", "Real Estate", "Lead Management"],
  },
  {
    id: "2",
    title: "Restaurant Inventory",
    description: "Inventory management system for restaurants. Track ingredients, suppliers, orders, and waste with real-time alerts.",
    creator: "chefdev",
    category: "software",
    price: 29,
    rating: 4.5,
    downloads: 830,
    preview: "from-orange-500 to-red-500",
    tags: ["Inventory", "Restaurant", "Supply Chain"],
  },
  {
    id: "3",
    title: "Portfolio Template",
    description: "Modern developer portfolio website with project showcase, blog, contact form, and dark mode support.",
    creator: "webcraft",
    category: "websites",
    price: 0,
    rating: 4.9,
    downloads: 3200,
    preview: "from-gray-700 to-gray-900",
    tags: ["Portfolio", "Developer", "Responsive"],
  },
  {
    id: "4",
    title: "Fitness Tracker",
    description: "Cross-platform fitness app with workout logging, progress charts, meal planning, and social features.",
    creator: "fitlabs",
    category: "apps",
    price: 39,
    rating: 4.6,
    downloads: 560,
    preview: "from-green-500 to-emerald-600",
    tags: ["Fitness", "Health", "Tracking"],
  },
  {
    id: "5",
    title: "Customer Support Agent",
    description: "AI-powered customer support agent that handles tickets, FAQ responses, escalation routing, and satisfaction surveys.",
    creator: "agentforge",
    category: "agents",
    price: 79,
    rating: 4.7,
    downloads: 410,
    preview: "from-purple-500 to-violet-600",
    tags: ["AI Agent", "Support", "Automation"],
  },
  {
    id: "6",
    title: "E-commerce Store",
    description: "Full-featured online store with product catalog, shopping cart, Stripe payments, and order management.",
    creator: "shopbuilder",
    category: "websites",
    price: 59,
    rating: 4.4,
    downloads: 1870,
    preview: "from-pink-500 to-rose-600",
    tags: ["E-commerce", "Payments", "Store"],
  },
  {
    id: "7",
    title: "Project Management",
    description: "Kanban-style project tracker with team assignments, deadlines, file sharing, and time tracking.",
    creator: "isibi",
    category: "software",
    price: 0,
    rating: 4.3,
    downloads: 2100,
    preview: "from-cyan-500 to-blue-600",
    tags: ["Project Management", "Kanban", "Teams"],
  },
  {
    id: "8",
    title: "Sales Outreach Agent",
    description: "Automated sales agent that researches prospects, personalizes emails, schedules follow-ups, and tracks engagement.",
    creator: "growthbot",
    category: "agents",
    price: 99,
    rating: 4.9,
    downloads: 320,
    preview: "from-amber-500 to-orange-600",
    tags: ["Sales", "AI Agent", "Outreach"],
  },
];

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "all", label: "All" },
  { value: "software", label: "Software" },
  { value: "websites", label: "Websites" },
  { value: "apps", label: "Apps" },
  { value: "agents", label: "Agents" },
];

const CATEGORY_BADGE: Record<string, string> = {
  software: "bg-pink-100 text-pink-700",
  websites: "bg-green-100 text-green-700",
  apps: "bg-pink-100 text-pink-700",
  agents: "bg-amber-100 text-amber-700",
};

const GRADIENT_TO_COLOR: Record<string, string> = {
  "from-emerald-500 to-teal-600": "#10b981",
  "from-blue-500 to-indigo-600": "#3b82f6",
  "from-orange-500 to-red-500": "#f97316",
  "from-gray-700 to-gray-900": "#374151",
  "from-green-500 to-emerald-600": "#22c55e",
  "from-purple-500 to-violet-600": "#8b5cf6",
  "from-pink-500 to-rose-600": "#ec4899",
  "from-cyan-500 to-blue-600": "#06b6d4",
  "from-amber-500 to-orange-600": "#f59e0b",
};

export function MarketplacePage() {
  const [category, setCategory] = useState<Category>("all");
  const [search, setSearch] = useState("");
  const [previewItem, setPreviewItem] = useState<MarketplaceItem | null>(null);
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());
  const { addApp, apps } = useAppStore();

  const filtered = MOCK_ITEMS.filter((item) => {
    if (category !== "all" && item.category !== category) return false;
    if (search && !item.title.toLowerCase().includes(search.toLowerCase()) && !item.description.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleDownload = async (item: MarketplaceItem) => {
    if (!item.downloadable) return;

    // Add to My Apps if not already there
    const alreadyInApps = apps.some(
      (a) => a.name === item.title && a.source === "marketplace"
    );
    if (!alreadyInApps) {
      addApp({
        name: item.title,
        type: item.category === "websites" ? "website" : item.category === "agents" ? "agent" : item.category === "apps" ? "app" : "software",
        status: "online",
        color: GRADIENT_TO_COLOR[item.preview] || "#3b82f6",
        source: "marketplace",
        htmlContent: item.downloadable,
      });
    }
    setJustAdded((prev) => new Set(prev).add(item.id));

    // Also download to PC
    const slug = item.title.toLowerCase().replace(/\s+/g, "-");
    const zip = new JSZip();
    const folder = zip.folder(slug)!;

    // index.html — the actual app
    folder.file("index.html", item.downloadable);

    // package.json — Electron wrapper
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

    // main.js — Electron entry point
    folder.file(
      "main.js",
      `const { app, BrowserWindow } = require("electron");
const path = require("path");

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1024,
    height: 700,
    title: ${JSON.stringify(item.title)},
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  win.loadFile("index.html");
  win.setMenuBarVisibility(false);
});

app.on("window-all-closed", () => app.quit());
`
    );

    // start.command — double-click launcher for Mac
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
echo "Launching ${item.title}..."
npx electron .
`,
      { unixPermissions: "755" }
    );

    // start.bat — double-click launcher for Windows
    folder.file(
      "start.bat",
      `@echo off
cd /d "%~dp0"
where npm >nul 2>nul || (echo. & echo   Node.js is required. Install from https://nodejs.org & echo. & pause & exit /b 1)
if not exist node_modules (
  echo Installing dependencies [first run only, may take a minute]...
  npm install --no-fund --no-audit
)
echo Launching ${item.title}...
npx electron .
`
    );

    // README
    folder.file(
      "README.md",
      `# ${item.title}

Built with [isibi.ai](https://isibi.ai)

## Run as Desktop App

### Mac
1. Unzip this folder
2. Open Terminal
3. Run: \`cd ${slug} && chmod +x start.command && open start.command\`

Or right-click \`start.command\` > Open (to bypass macOS Gatekeeper)

### Windows
Double-click \`start.bat\`

### Manual (any OS)
\`\`\`
cd ${slug}
npm install
npm start
\`\`\`

Requires [Node.js](https://nodejs.org) installed.
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

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-black">isibi marketplace</h1>
          <p className="mt-1 text-sm text-gray-500">
            Browse, preview, and download software, websites, apps, and agents built by the community.
          </p>
        </div>

        {/* Search + Categories */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search marketplace..."
              className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-black placeholder-gray-400 focus:border-gray-300 focus:outline-none"
            />
          </div>
          <div className="flex gap-1">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setCategory(cat.value)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  category === cat.value
                    ? "bg-black text-white"
                    : "text-gray-500 hover:bg-gray-100 hover:text-black"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((item) => (
            <div
              key={item.id}
              className="group rounded-xl border border-gray-200 bg-white transition hover:border-gray-300 hover:shadow-sm"
            >
              {/* Preview thumbnail */}
              <div
                className={`relative h-40 rounded-t-xl bg-gradient-to-br ${item.preview} flex items-center justify-center`}
              >
                <span className="text-3xl font-bold text-white/30">
                  {item.title.charAt(0)}
                </span>
                <button
                  onClick={() => setPreviewItem(item)}
                  className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100"
                >
                  <Eye className="h-6 w-6 text-white" />
                </button>
              </div>

              {/* Info */}
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-black">{item.title}</h3>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${CATEGORY_BADGE[item.category]}`}
                  >
                    {item.category}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500">by {item.creator}</p>

                <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
                  <span className="flex items-center gap-0.5">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    {item.rating}
                  </span>
                  <span>{item.downloads.toLocaleString()} downloads</span>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <span className="text-sm font-semibold text-black">
                    {item.price === 0 ? "Free" : `$${item.price}`}
                  </span>
                  <button
                    onClick={() => handleDownload(item)}
                    disabled={!item.downloadable && item.price > 0}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${
                      justAdded.has(item.id)
                        ? "bg-green-600 text-white"
                        : "bg-black text-white hover:bg-gray-800"
                    }`}
                  >
                    {justAdded.has(item.id) ? (
                      <>
                        <Check className="h-3 w-3" />
                        Added & Downloaded
                      </>
                    ) : (
                      <>
                        <Download className="h-3 w-3" />
                        {item.downloadable ? "Download" : item.price === 0 ? "Download" : "Buy"}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="py-20 text-center">
            <p className="text-sm text-gray-400">No items found.</p>
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {previewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="relative w-full max-w-2xl rounded-2xl bg-white shadow-xl">
            <button
              onClick={() => setPreviewItem(null)}
              className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 transition hover:bg-gray-100"
            >
              <X className="h-4 w-4 text-gray-600" />
            </button>

            {/* Preview image */}
            <div
              className={`h-64 rounded-t-2xl bg-gradient-to-br ${previewItem.preview} flex items-center justify-center`}
            >
              <span className="text-6xl font-bold text-white/20">
                {previewItem.title.charAt(0)}
              </span>
            </div>

            {/* Details */}
            <div className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-bold text-black">{previewItem.title}</h2>
                  <p className="mt-0.5 text-sm text-gray-500">
                    by {previewItem.creator}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${CATEGORY_BADGE[previewItem.category]}`}
                >
                  {previewItem.category}
                </span>
              </div>

              <p className="mt-4 text-sm leading-relaxed text-gray-600">
                {previewItem.description}
              </p>

              <div className="mt-4 flex flex-wrap gap-1.5">
                {previewItem.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <div className="mt-4 flex items-center gap-4 text-sm text-gray-500">
                <span className="flex items-center gap-1">
                  <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                  {previewItem.rating}
                </span>
                <span>{previewItem.downloads.toLocaleString()} downloads</span>
              </div>

              <div className="mt-6 flex items-center justify-between border-t border-gray-100 pt-4">
                <span className="text-2xl font-bold text-black">
                  {previewItem.price === 0 ? "Free" : `$${previewItem.price}`}
                </span>
                <button
                  onClick={() => { handleDownload(previewItem); setPreviewItem(null); }}
                  disabled={!previewItem.downloadable && previewItem.price > 0}
                  className="flex items-center gap-2 rounded-xl bg-black px-6 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Download className="h-4 w-4" />
                  Download & Add to My Apps
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
