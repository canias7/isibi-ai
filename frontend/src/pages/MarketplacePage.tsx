import { useState, useEffect } from "react";
import { Search, Download, Eye, X, Star, Check, ChevronDown, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import JSZip from "jszip";
import { useAppStore } from "@/stores/appStore";
import { useAuthStore } from "@/stores/authStore";
import { get, post } from "@/api/client";

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
    title: "Task Tracker Pro (Example)",
    description: "Complete task management with priority levels, filters, stats dashboard, and local storage persistence.",
    creator: "isibi",
    category: "software",
    price: 0,
    rating: 0,
    ratingCount: 0,
    downloads: 0,
    tags: ["Tasks", "Productivity", "Offline", "Free"],
    downloadable: TASK_TRACKER_HTML,
    featured: true,
  },
  {
    id: "1",
    title: "Real Estate CRM (Example)",
    description: "Complete CRM for real estate agents with lead tracking, deal pipeline, and automated follow-ups.",
    creator: "isibi",
    category: "crm",
    price: 49,
    rating: 0,
    ratingCount: 0,
    downloads: 0,
    tags: ["CRM", "Real Estate", "Lead Management"],
    featured: true,
  },
  {
    id: "2",
    title: "Restaurant Manager (Example)",
    description: "Inventory management system for restaurants. Track ingredients, suppliers, orders, and waste.",
    creator: "chefdev",
    category: "restaurant",
    price: 29,
    rating: 0,
    ratingCount: 0,
    downloads: 0,
    tags: ["Inventory", "Restaurant", "Supply Chain"],
  },
  {
    id: "3",
    title: "Portfolio Builder (Example)",
    description: "Modern developer portfolio with project showcase, blog, contact form, and dark mode support.",
    creator: "webcraft",
    category: "websites",
    price: 0,
    rating: 0,
    ratingCount: 0,
    downloads: 0,
    tags: ["Portfolio", "Developer", "Responsive"],
    featured: true,
  },
  {
    id: "4",
    title: "FitTrack (Example)",
    description: "Cross-platform fitness app with workout logging, progress charts, and meal planning.",
    creator: "fitlabs",
    category: "gym",
    price: 39,
    rating: 0,
    ratingCount: 0,
    downloads: 0,
    tags: ["Fitness", "Health", "Tracking"],
  },
  {
    id: "5",
    title: "Support Agent AI (Example)",
    description: "AI-powered customer support agent that handles tickets, FAQ responses, and escalation routing.",
    creator: "agentforge",
    category: "agents",
    price: 79,
    rating: 0,
    ratingCount: 0,
    downloads: 0,
    tags: ["AI Agent", "Support", "Automation"],
  },
  {
    id: "6",
    title: "ShopFront (Example)",
    description: "Full-featured online store with product catalog, shopping cart, Stripe payments, and order management.",
    creator: "shopbuilder",
    category: "ecommerce",
    price: 59,
    rating: 0,
    ratingCount: 0,
    downloads: 0,
    tags: ["E-commerce", "Payments", "Store"],
  },
  {
    id: "7",
    title: "KanbanFlow (Example)",
    description: "Kanban-style project tracker with team assignments, deadlines, file sharing, and time tracking.",
    creator: "isibi",
    category: "software",
    price: 0,
    rating: 0,
    ratingCount: 0,
    downloads: 0,
    tags: ["Project Management", "Kanban", "Teams"],
  },
  {
    id: "8",
    title: "OutreachBot (Example)",
    description: "Automated sales agent that researches prospects, personalizes emails, and tracks engagement.",
    creator: "growthbot",
    category: "agents",
    price: 99,
    rating: 0,
    ratingCount: 0,
    downloads: 0,
    tags: ["Sales", "AI Agent", "Outreach"],
  },
  {
    id: "9",
    title: "PatientCare (Example)",
    description: "Healthcare appointment scheduling, patient records management, and telemedicine integration.",
    creator: "medtech",
    category: "healthcare",
    price: 89,
    rating: 0,
    ratingCount: 0,
    downloads: 0,
    tags: ["Healthcare", "Appointments", "Telemedicine"],
  },
  {
    id: "10",
    title: "GymPro Manager (Example)",
    description: "Gym membership management with class scheduling, trainer assignments, and payment processing.",
    creator: "fitlabs",
    category: "gym",
    price: 49,
    rating: 0,
    ratingCount: 0,
    downloads: 0,
    tags: ["Gym", "Membership", "Scheduling"],
  },
  {
    id: "11",
    title: "Landing Page Kit (Example)",
    description: "Collection of 12 responsive landing page templates for SaaS, agencies, and startups.",
    creator: "webcraft",
    category: "websites",
    price: 0,
    rating: 0,
    ratingCount: 0,
    downloads: 0,
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

function StarRating({
  rating,
  count,
  interactive,
  onRate,
}: {
  rating: number;
  count: number;
  interactive?: boolean;
  onRate?: (stars: number) => void;
}) {
  const [hover, setHover] = useState(0);
  return (
    <span className="flex items-center gap-1 text-xs text-gray-500">
      <span className="flex">
        {[1, 2, 3, 4, 5].map((s) => (
          <Star
            key={s}
            className={`h-3 w-3 ${interactive ? "cursor-pointer" : ""}`}
            fill={s <= (hover || Math.round(rating)) ? "#f59e0b" : "none"}
            stroke={s <= (hover || Math.round(rating)) ? "#f59e0b" : "#d1d5db"}
            onMouseEnter={() => interactive && setHover(s)}
            onMouseLeave={() => interactive && setHover(0)}
            onClick={(e) => {
              e.stopPropagation();
              if (interactive && onRate) onRate(s);
            }}
          />
        ))}
      </span>
      <span className="text-gray-400">({count})</span>
    </span>
  );
}

/** Skeleton for marketplace grid while loading */
function MarketplaceSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-8 flex gap-2 overflow-x-auto pb-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-9 w-20 animate-pulse rounded-full bg-gray-200" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="animate-pulse rounded-2xl border border-gray-200 bg-white">
            <div className="h-36 rounded-t-2xl bg-gray-200" />
            <div className="p-4 space-y-3">
              <div className="h-4 bg-gray-200 rounded w-3/4" />
              <div className="h-3 bg-gray-200 rounded w-full" />
              <div className="h-3 bg-gray-200 rounded w-1/2" />
              <div className="flex items-center justify-between pt-2">
                <div className="h-3 bg-gray-200 rounded w-20" />
                <div className="h-5 bg-gray-200 rounded w-12" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MarketplacePage() {
  const [category, setCategory] = useState<Category>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOption>("popular");
  const [showSort, setShowSort] = useState(false);
  const [previewItem, setPreviewItem] = useState<MarketplaceItem | null>(null);
  const [purchaseItem, setPurchaseItem] = useState<MarketplaceItem | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());
  const [initialLoading, setInitialLoading] = useState(true);
  const [authToast, setAuthToast] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [items, setItems] = useState<MarketplaceItem[]>(MOCK_ITEMS);
  const [usingMockData, setUsingMockData] = useState(true);
  const { addApp, apps } = useAppStore();
  const { isAuthenticated, user } = useAuthStore();
  const navigate = useNavigate();
  const isDev = user?.account_type === "developer";
  const cameFromDashboard = isAuthenticated && isDev;

  // Fetch real listings from API on mount, fallback to mock data
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await get<{
          templates: Array<{
            id: string;
            title: string;
            description: string;
            category: string;
            price: number;
            rating_avg: number;
            rating_count: number;
            purchases: number;
            preview_images: string[];
            author_id: string;
            created_at: string;
          }>;
          total: number;
        }>("/template-marketplace");
        if (!cancelled && data.templates && data.templates.length > 0) {
          const mapped: MarketplaceItem[] = data.templates.map((t) => ({
            id: t.id,
            title: t.title,
            description: t.description || "",
            creator: t.author_id.slice(0, 8),
            category: (t.category || "software") as Exclude<Category, "all">,
            price: t.price || 0,
            rating: t.rating_avg || 0,
            ratingCount: t.rating_count || 0,
            downloads: t.purchases || 0,
            tags: [t.category || "software"].filter(Boolean),
            featured: t.purchases > 100,
          }));
          setItems(mapped);
          setUsingMockData(false);
        }
        // If empty, keep mock data
      } catch {
        // API failed, keep mock data as fallback
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto-hide general toast
  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(t);
  }, [toastMessage]);

  const filtered = items.filter((item) => {
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

  const featuredItems = items.filter((item) => item.featured);

  const cloneAppToProject = async (item: MarketplaceItem) => {
    try {
      const res = await post<{ project_id: string; title: string }>(
        `/template-marketplace/${item.id}/purchase`,
        {}
      );
      if (res.project_id) {
        setJustAdded((prev) => new Set(prev).add(item.id));
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
          projectId: res.project_id,
        });
        setToastMessage(`"${item.title}" added to your projects!`);
        setTimeout(() => navigate("/app"), 1200);
        return true;
      }
    } catch {
      if (item.downloadable) {
        handleDownload(item);
        return true;
      }
      setToastMessage("Failed to get app. Please try again.");
    }
    return false;
  };

  const handleGetApp = async (item: MarketplaceItem) => {
    if (!isAuthenticated) {
      setAuthToast(true);
      setTimeout(() => navigate("/signup"), 1500);
      return;
    }
    if (item.price > 0) {
      // Show purchase modal for paid items
      setPurchaseItem(item);
      return;
    }
    // Free item: clone directly
    await cloneAppToProject(item);
  };

  const handleRate = async (item: MarketplaceItem, stars: number) => {
    if (!isAuthenticated) {
      setAuthToast(true);
      setTimeout(() => navigate("/signup"), 1500);
      return;
    }
    try {
      const res = await post<{
        rating_avg: number;
        rating_count: number;
      }>(`/template-marketplace/${item.id}/rate`, { rating: stars });
      // Update local state
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? { ...i, rating: res.rating_avg, ratingCount: res.rating_count }
            : i
        )
      );
      setToastMessage(`Rated "${item.title}" ${stars} star${stars > 1 ? "s" : ""}`);
    } catch {
      setToastMessage("Failed to submit rating. Please try again.");
    }
  };

  // Auto-hide auth toast
  useEffect(() => {
    if (!authToast) return;
    const t = setTimeout(() => setAuthToast(false), 3000);
    return () => clearTimeout(t);
  }, [authToast]);

  const handleDownload = async (item: MarketplaceItem) => {
    if (!isAuthenticated) {
      setAuthToast(true);
      setTimeout(() => navigate("/signup"), 1500);
      return;
    }
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

  if (initialLoading) {
    return (
      <div className="flex-1 overflow-y-auto bg-white">
        {/* Skeleton hero */}
        <div className="animate-pulse px-6 py-16 sm:py-20" style={{ background: "linear-gradient(135deg, #ec4899 0%, #db2777 50%, #9d174d 100%)" }}>
          <div className="mx-auto max-w-4xl text-center space-y-4">
            <div className="h-10 bg-white/20 rounded w-1/3 mx-auto" />
            <div className="h-5 bg-white/15 rounded w-1/2 mx-auto" />
            <div className="h-12 bg-white/90 rounded-2xl max-w-xl mx-auto mt-6" />
          </div>
        </div>
        <MarketplaceSkeleton />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-white">
      {/* Back to Dashboard link */}
      {cameFromDashboard && (
        <div className="border-b border-gray-100 bg-gray-50 px-6 py-2">
          <button
            onClick={() => navigate("/app")}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 transition hover:text-black"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Dashboard
          </button>
        </div>
      )}

      {/* Auth toast */}
      {authToast && (
        <div className="fixed bottom-6 left-1/2 z-[200] -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-xl border border-pink-200 bg-pink-50 px-4 py-2.5 shadow-lg">
            <p className="text-xs font-medium text-pink-800">Please sign up to get this app. Redirecting...</p>
          </div>
        </div>
      )}

      {/* General toast */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 z-[200] -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 shadow-lg">
            <p className="text-xs font-medium text-gray-800">{toastMessage}</p>
          </div>
        </div>
      )}

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

        {/* Mock data notice */}
        {usingMockData && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            These are example listings. Real marketplace listings will appear as developers publish their apps.
          </div>
        )}

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
                  <StarRating
                    rating={item.rating}
                    count={item.ratingCount}
                    interactive={isAuthenticated}
                    onRate={(stars) => handleRate(item, stars)}
                  />
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
                    onClick={() => handleGetApp(item)}
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
                    ) : (
                      <>
                        <Download className="h-3 w-3" />
                        {item.price > 0 ? `$${item.price}` : "Get App"}
                      </>
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
                <StarRating
                  rating={previewItem.rating}
                  count={previewItem.ratingCount}
                  interactive={isAuthenticated}
                  onRate={(stars) => handleRate(previewItem, stars)}
                />
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
                    handleGetApp(previewItem);
                    setPreviewItem(null);
                  }}
                  className="flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90"
                  style={{ backgroundColor: "#ec4899" }}
                >
                  <Download className="h-4 w-4" />
                  {previewItem.price === 0 ? "Get App" : `Buy — $${previewItem.price}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Purchase Modal for Paid Items */}
      {purchaseItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl overflow-hidden">
            {/* Header gradient */}
            <div
              className="relative h-32 flex items-center justify-center"
              style={{ background: hashGradient(purchaseItem.title) }}
            >
              <span className="relative z-10 text-5xl font-bold text-white/20 select-none">
                {purchaseItem.title.charAt(0)}
              </span>
              <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
              <button
                onClick={() => setPurchaseItem(null)}
                className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 shadow transition hover:bg-gray-100"
              >
                <X className="h-4 w-4 text-gray-600" />
              </button>
            </div>

            <div className="p-6">
              <h3 className="text-lg font-bold text-black">{purchaseItem.title}</h3>
              <p className="mt-1 text-sm text-gray-500">{purchaseItem.description}</p>

              <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Price</span>
                  <span className="text-xl font-bold text-black">${purchaseItem.price}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
                  <span>One-time purchase</span>
                  <span>Includes source &amp; updates</span>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Check className="h-3.5 w-3.5 text-green-500" />
                  Full source code access
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Check className="h-3.5 w-3.5 text-green-500" />
                  Customize in the visual builder
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Check className="h-3.5 w-3.5 text-green-500" />
                  Deploy to your own domain
                </div>
              </div>

              <button
                onClick={async () => {
                  setPurchasing(true);
                  // Simulate purchase delay, then show coming soon
                  await new Promise((r) => setTimeout(r, 800));
                  setPurchasing(false);
                  setToastMessage("Payment integration coming soon. Free apps are available now!");
                  setPurchaseItem(null);
                }}
                disabled={purchasing}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                style={{ backgroundColor: "#ec4899" }}
              >
                {purchasing ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Processing...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    Purchase for ${purchaseItem.price}
                  </>
                )}
              </button>
              <p className="mt-2 text-center text-[10px] text-gray-400">
                Secure checkout powered by Stripe
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
