import { useState } from "react";
import { Search, Download, Eye, X, Star, Check, ChevronDown } from "lucide-react";
import JSZip from "jszip";
import { useAppStore } from "@/stores/appStore";

type Category =
  | "all"
  | "software"
  | "websites"
  | "apps"
  | "agents"
  | "crm"
  | "restaurant"
  | "gym"
  | "ecommerce"
  | "healthcare";

type SortOption = "popular" | "recent" | "price-low" | "price-high";

interface MarketplaceItem {
  id: string;
  title: string;
  description: string;
  creator: string;
  category: Exclude<Category, "all">;
  price: number; // 0 = free
  rating: number;
  ratingCount: number;
  downloads: number;
  tags: string[];
  downloadable?: string; // HTML content to download as a standalone app
  featured?: boolean;
}

const TASK_TRACKER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Task Tracker Pro</title>
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
    description: "Complete task management with priority levels, filters, stats dashboard, and local storage persistence.",
    creator: "isibi",
    category: "software",
    price: 0,
    rating: 4.9,
    ratingCount: 284,
    downloads: 4820,
    tags: ["Tasks", "Productivity", "Offline", "Free"],
    downloadable: TASK_TRACKER_HTML,
    featured: true,
  },
  {
    id: "1",
    title: "Real Estate CRM",
    description: "Complete CRM for real estate agents with lead tracking, deal pipeline, and automated follow-ups.",
    creator: "isibi",
    category: "crm",
    price: 49,
    rating: 4.8,
    ratingCount: 156,
    downloads: 1240,
    tags: ["CRM", "Real Estate", "Lead Management"],
    featured: true,
  },
  {
    id: "2",
    title: "Restaurant Manager",
    description: "Inventory management system for restaurants. Track ingredients, suppliers, orders, and waste.",
    creator: "chefdev",
    category: "restaurant",
    price: 29,
    rating: 4.5,
    ratingCount: 89,
    downloads: 830,
    tags: ["Inventory", "Restaurant", "Supply Chain"],
  },
  {
    id: "3",
    title: "Portfolio Builder",
    description: "Modern developer portfolio with project showcase, blog, contact form, and dark mode support.",
    creator: "webcraft",
    category: "websites",
    price: 0,
    rating: 4.9,
    ratingCount: 412,
    downloads: 3200,
    tags: ["Portfolio", "Developer", "Responsive"],
    featured: true,
  },
  {
    id: "4",
    title: "FitTrack",
    description: "Cross-platform fitness app with workout logging, progress charts, and meal planning.",
    creator: "fitlabs",
    category: "gym",
    price: 39,
    rating: 4.6,
    ratingCount: 73,
    downloads: 560,
    tags: ["Fitness", "Health", "Tracking"],
  },
  {
    id: "5",
    title: "Support Agent AI",
    description: "AI-powered customer support agent that handles tickets, FAQ responses, and escalation routing.",
    creator: "agentforge",
    category: "agents",
    price: 79,
    rating: 4.7,
    ratingCount: 64,
    downloads: 410,
    tags: ["AI Agent", "Support", "Automation"],
  },
  {
    id: "6",
    title: "ShopFront",
    description: "Full-featured online store with product catalog, shopping cart, Stripe payments, and order management.",
    creator: "shopbuilder",
    category: "ecommerce",
    price: 59,
    rating: 4.4,
    ratingCount: 198,
    downloads: 1870,
    tags: ["E-commerce", "Payments", "Store"],
  },
  {
    id: "7",
    title: "KanbanFlow",
    description: "Kanban-style project tracker with team assignments, deadlines, file sharing, and time tracking.",
    creator: "isibi",
    category: "software",
    price: 0,
    rating: 4.3,
    ratingCount: 231,
    downloads: 2100,
    tags: ["Project Management", "Kanban", "Teams"],
  },
  {
    id: "8",
    title: "OutreachBot",
    description: "Automated sales agent that researches prospects, personalizes emails, and tracks engagement.",
    creator: "growthbot",
    category: "agents",
    price: 99,
    rating: 4.9,
    ratingCount: 42,
    downloads: 320,
    tags: ["Sales", "AI Agent", "Outreach"],
  },
  {
    id: "9",
    title: "PatientCare",
    description: "Healthcare appointment scheduling, patient records management, and telemedicine integration.",
    creator: "medtech",
    category: "healthcare",
    price: 89,
    rating: 4.8,
    ratingCount: 57,
    downloads: 390,
    tags: ["Healthcare", "Appointments", "Telemedicine"],
  },
  {
    id: "10",
    title: "GymPro Manager",
    description: "Gym membership management with class scheduling, trainer assignments, and payment processing.",
    creator: "fitlabs",
    category: "gym",
    price: 49,
    rating: 4.5,
    ratingCount: 83,
    downloads: 620,
    tags: ["Gym", "Membership", "Scheduling"],
  },
  {
    id: "11",
    title: "Landing Page Kit",
    description: "Collection of 12 responsive landing page templates for SaaS, agencies, and startups.",
    creator: "webcraft",
    category: "websites",
    price: 0,
    rating: 4.7,
    ratingCount: 345,
    downloads: 5200,
    tags: ["Landing Pages", "Templates", "SaaS"],
  },
];

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "all", label: "All" },
  { value: "software", label: "Software" },
  { value: "websites", label: "Websites" },
  { value: "apps", label: "Apps" },
  { value: "agents", label: "Agents" },
  { value: "crm", label: "CRM" },
  { value: "restaurant", label: "Restaurant" },
  { value: "gym", label: "Gym" },
  { value: "ecommerce", label: "E-commerce" },
  { value: "healthcare", label: "Healthcare" },
];

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  software: { bg: "#fce7f3", text: "#be185d" },
  websites: { bg: "#d1fae5", text: "#065f46" },
  apps: { bg: "#dbeafe", text: "#1e40af" },
  agents: { bg: "#fef3c7", text: "#92400e" },
  crm: { bg: "#ede9fe", text: "#5b21b6" },
  restaurant: { bg: "#ffedd5", text: "#9a3412" },
  gym: { bg: "#ccfbf1", text: "#115e59" },
  ecommerce: { bg: "#fce7f3", text: "#9d174d" },
  healthcare: { bg: "#e0e7ff", text: "#3730a3" },
};

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "popular", label: "Popular" },
  { value: "recent", label: "Recent" },
  { value: "price-low", label: "Price: Low-High" },
  { value: "price-high", label: "Price: High-Low" },
];

// Generate a deterministic gradient from a string
function hashGradient(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h1 = Math.abs(hash % 360);
  const h2 = (h1 + 40 + Math.abs((hash >> 8) % 40)) % 360;
  return `linear-gradient(135deg, hsl(${h1}, 70%, 60%) 0%, hsl(${h2}, 80%, 45%) 100%)`;
}

function StarRating({ rating, count }: { rating: number; count: number }) {
  return (
    <span className="flex items-center gap-1 text-xs text-gray-500">
      <span className="flex">
        {[1, 2, 3, 4, 5].map((s) => (
          <Star
            key={s}
            className="h-3 w-3"
            fill={s <= Math.round(rating) ? "#f59e0b" : "none"}
            stroke={s <= Math.round(rating) ? "#f59e0b" : "#d1d5db"}
          />
        ))}
      </span>
      <span className="text-gray-400">({count})</span>
    </span>
  );
}

export function MarketplacePage() {
  const [category, setCategory] = useState<Category>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOption>("popular");
  const [showSort, setShowSort] = useState(false);
  const [previewItem, setPreviewItem] = useState<MarketplaceItem | null>(null);
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());
  const { addApp, apps } = useAppStore();

  const filtered = MOCK_ITEMS.filter((item) => {
    if (category !== "all" && item.category !== category) return false;
    if (
      search &&
      !item.title.toLowerCase().includes(search.toLowerCase()) &&
      !item.description.toLowerCase().includes(search.toLowerCase())
    )
      return false;
    return true;
  }).sort((a, b) => {
    switch (sort) {
      case "popular":
        return b.downloads - a.downloads;
      case "recent":
        return parseInt(b.id) - parseInt(a.id);
      case "price-low":
        return a.price - b.price;
      case "price-high":
        return b.price - a.price;
      default:
        return 0;
    }
  });

  const featuredItems = MOCK_ITEMS.filter((item) => item.featured);

  const handleDownload = async (item: MarketplaceItem) => {
    if (!item.downloadable) return;

    const alreadyInApps = apps.some(
      (a) => a.name === item.title && a.source === "marketplace"
    );
    if (!alreadyInApps) {
      addApp({
        name: item.title,
        type:
          item.category === "websites"
            ? "website"
            : item.category === "agents"
            ? "agent"
            : item.category === "apps"
            ? "app"
            : "software",
        status: "online",
        color: "#ec4899",
        source: "marketplace",
        htmlContent: item.downloadable,
      });
    }
    setJustAdded((prev) => new Set(prev).add(item.id));

    const slug = item.title.toLowerCase().replace(/\s+/g, "-");
    const zip = new JSZip();
    const folder = zip.folder(slug)!;

    folder.file("index.html", item.downloadable);

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
    title: ${JSON.stringify(item.title)},
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
echo "Launching ${item.title}..."
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
echo Launching ${item.title}...
npx electron .
`
    );

    folder.file(
      "README.md",
      `# ${item.title}\n\nBuilt with [isibi.ai](https://isibi.ai)\n\n## Run as Desktop App\n\n### Mac\n1. Unzip this folder\n2. Open Terminal\n3. Run: \`cd ${slug} && chmod +x start.command && open start.command\`\n\n### Windows\nDouble-click \`start.bat\`\n\n### Manual (any OS)\n\`\`\`\ncd ${slug}\nnpm install\nnpm start\n\`\`\`\n\nRequires [Node.js](https://nodejs.org) installed.\n`
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
    <div className="flex-1 overflow-y-auto bg-white">
      {/* Hero Banner */}
      <div
        className="relative overflow-hidden px-6 py-16 sm:py-20"
        style={{ background: "linear-gradient(135deg, #ec4899 0%, #db2777 50%, #9d174d 100%)" }}
      >
        <div className="relative z-10 mx-auto max-w-4xl text-center">
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
            isibi marketplace
          </h1>
          <p className="mt-3 text-base text-white/80 sm:text-lg">
            Discover apps built by developers worldwide
          </p>

          {/* Search bar */}
          <div className="mx-auto mt-8 max-w-xl">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search apps, tools, templates..."
                className="w-full rounded-2xl border-0 bg-white py-4 pl-12 pr-4 text-sm text-black shadow-lg placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white/50"
              />
            </div>
          </div>
        </div>

        {/* Decorative elements */}
        <div className="absolute -bottom-10 -left-10 h-40 w-40 rounded-full bg-white/5" />
        <div className="absolute -top-10 -right-10 h-60 w-60 rounded-full bg-white/5" />
        <div className="absolute top-10 left-1/4 h-20 w-20 rounded-full bg-white/5" />
      </div>

      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* Category filter bar */}
        <div className="mb-8 -mx-6 px-6 overflow-x-auto">
          <div className="flex gap-2 pb-2" style={{ minWidth: "max-content" }}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setCategory(cat.value)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition whitespace-nowrap ${
                  category === cat.value
                    ? "text-white shadow-md"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-black"
                }`}
                style={
                  category === cat.value
                    ? { backgroundColor: "#ec4899" }
                    : undefined
                }
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Featured section (only show when "All" is selected and no search) */}
        {category === "all" && !search && (
          <div className="mb-12">
            <h2 className="mb-4 text-xl font-bold text-black">Featured Apps</h2>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {featuredItems.map((item) => (
                <div
                  key={item.id}
                  className="group relative overflow-hidden rounded-2xl border border-gray-200 bg-white transition hover:shadow-lg hover:border-gray-300 cursor-pointer"
                  onClick={() => setPreviewItem(item)}
                >
                  <div
                    className="flex h-48 items-end p-5"
                    style={{ background: hashGradient(item.title) }}
                  >
                    <div className="relative z-10">
                      <span
                        className="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium"
                        style={{
                          backgroundColor: CATEGORY_COLORS[item.category]?.bg || "#f3f4f6",
                          color: CATEGORY_COLORS[item.category]?.text || "#374151",
                        }}
                      >
                        {item.category}
                      </span>
                      <h3 className="mt-2 text-lg font-bold text-white drop-shadow-md">
                        {item.title}
                      </h3>
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                  </div>
                  <div className="p-4">
                    <p className="text-sm text-gray-600 line-clamp-1">{item.description}</p>
                    <div className="mt-3 flex items-center justify-between">
                      <StarRating rating={item.rating} count={item.ratingCount} />
                      <span className="text-sm font-bold" style={{ color: item.price === 0 ? "#059669" : "#000" }}>
                        {item.price === 0 ? "Free" : `$${item.price}`}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sort and results count */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-black">
            {category === "all" && !search ? "All Apps" : `${filtered.length} result${filtered.length !== 1 ? "s" : ""}`}
          </h2>
          <div className="relative">
            <button
              onClick={() => setShowSort(!showSort)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 transition hover:border-gray-300"
            >
              Sort by: {SORT_OPTIONS.find((o) => o.value === sort)?.label}
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {showSort && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowSort(false)} />
                <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        setSort(opt.value);
                        setShowSort(false);
                      }}
                      className={`w-full px-4 py-2 text-left text-sm transition hover:bg-gray-50 ${
                        sort === opt.value ? "font-medium" : "text-gray-600"
                      }`}
                      style={sort === opt.value ? { color: "#ec4899" } : undefined}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* App grid */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => (
            <div
              key={item.id}
              className="group rounded-2xl border border-gray-200 bg-white transition hover:shadow-md hover:border-gray-300"
            >
              {/* Gradient thumbnail */}
              <div
                className="relative h-36 rounded-t-2xl flex items-center justify-center cursor-pointer"
                style={{ background: hashGradient(item.title) }}
                onClick={() => setPreviewItem(item)}
              >
                <span className="text-4xl font-bold text-white/25 select-none">
                  {item.title.charAt(0)}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setPreviewItem(item);
                  }}
                  className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100 rounded-t-2xl"
                >
                  <Eye className="h-6 w-6 text-white" />
                </button>
              </div>

              {/* Card content */}
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-bold text-black">{item.title}</h3>
                  <span
                    className="shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: CATEGORY_COLORS[item.category]?.bg || "#f3f4f6",
                      color: CATEGORY_COLORS[item.category]?.text || "#374151",
                    }}
                  >
                    {item.category}
                  </span>
                </div>

                <p className="mt-1.5 text-xs text-gray-500 line-clamp-1">{item.description}</p>

                <div className="mt-3 flex items-center justify-between">
                  <StarRating rating={item.rating} count={item.ratingCount} />
                  <span className="flex items-center gap-1 text-xs text-gray-400">
                    <Download className="h-3 w-3" />
                    {item.downloads.toLocaleString()}
                  </span>
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
                  <span
                    className="text-sm font-bold"
                    style={{ color: item.price === 0 ? "#059669" : "#000" }}
                  >
                    {item.price === 0 ? "Free" : `$${item.price}`}
                  </span>
                  <button
                    onClick={() =>
                      item.downloadable ? handleDownload(item) : setPreviewItem(item)
                    }
                    className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold transition ${
                      justAdded.has(item.id)
                        ? "bg-green-600 text-white"
                        : "text-white hover:opacity-90"
                    }`}
                    style={
                      justAdded.has(item.id)
                        ? undefined
                        : { backgroundColor: "#ec4899" }
                    }
                  >
                    {justAdded.has(item.id) ? (
                      <>
                        <Check className="h-3 w-3" />
                        Added
                      </>
                    ) : item.downloadable ? (
                      <>
                        <Download className="h-3 w-3" />
                        Get App
                      </>
                    ) : (
                      "View"
                    )}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="py-24 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
              <Search className="h-7 w-7 text-gray-400" />
            </div>
            <p className="text-sm font-medium text-gray-500">No apps found</p>
            <p className="mt-1 text-xs text-gray-400">Try adjusting your search or category filter</p>
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {previewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="relative w-full max-w-2xl rounded-2xl bg-white shadow-xl max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setPreviewItem(null)}
              className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 shadow transition hover:bg-gray-100"
            >
              <X className="h-4 w-4 text-gray-600" />
            </button>

            {/* Preview gradient */}
            <div
              className="relative h-56 rounded-t-2xl flex items-center justify-center"
              style={{ background: hashGradient(previewItem.title) }}
            >
              <span className="relative z-10 text-6xl font-bold text-white/20 select-none">
                {previewItem.title.charAt(0)}
              </span>
              <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent rounded-t-2xl" />
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
                  className="rounded-full px-3 py-1 text-xs font-medium"
                  style={{
                    backgroundColor: CATEGORY_COLORS[previewItem.category]?.bg || "#f3f4f6",
                    color: CATEGORY_COLORS[previewItem.category]?.text || "#374151",
                  }}
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

              <div className="mt-4 flex items-center gap-6 text-sm text-gray-500">
                <StarRating rating={previewItem.rating} count={previewItem.ratingCount} />
                <span className="flex items-center gap-1">
                  <Download className="h-4 w-4" />
                  {previewItem.downloads.toLocaleString()} downloads
                </span>
              </div>

              <div className="mt-6 flex items-center justify-between border-t border-gray-100 pt-5">
                <span
                  className="text-2xl font-bold"
                  style={{ color: previewItem.price === 0 ? "#059669" : "#000" }}
                >
                  {previewItem.price === 0 ? "Free" : `$${previewItem.price}`}
                </span>
                <button
                  onClick={() => {
                    handleDownload(previewItem);
                    setPreviewItem(null);
                  }}
                  disabled={!previewItem.downloadable && previewItem.price > 0}
                  className="flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ backgroundColor: "#ec4899" }}
                >
                  <Download className="h-4 w-4" />
                  {previewItem.downloadable ? "Download & Add to My Apps" : previewItem.price === 0 ? "Download" : "Buy Now"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
