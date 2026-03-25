import { useState } from "react";
import { Search, Download, Eye, X, Star } from "lucide-react";

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
}

const MOCK_ITEMS: MarketplaceItem[] = [
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
  software: "bg-blue-100 text-blue-700",
  websites: "bg-green-100 text-green-700",
  apps: "bg-purple-100 text-purple-700",
  agents: "bg-amber-100 text-amber-700",
};

export function MarketplacePage() {
  const [category, setCategory] = useState<Category>("all");
  const [search, setSearch] = useState("");
  const [previewItem, setPreviewItem] = useState<MarketplaceItem | null>(null);

  const filtered = MOCK_ITEMS.filter((item) => {
    if (category !== "all" && item.category !== category) return false;
    if (search && !item.title.toLowerCase().includes(search.toLowerCase()) && !item.description.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

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
                  <button className="flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white transition hover:bg-gray-800">
                    <Download className="h-3 w-3" />
                    {item.price === 0 ? "Download" : "Buy"}
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
                <button className="flex items-center gap-2 rounded-xl bg-black px-6 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800">
                  <Download className="h-4 w-4" />
                  {previewItem.price === 0 ? "Download to Desktop" : "Buy & Download"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
