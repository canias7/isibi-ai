import { useState, useEffect } from "react";
import { Search, Download, Eye, X, Star, Check, ChevronDown, Loader2, Store } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "@/stores/appStore";
import { useAuthStore } from "@/stores/authStore";
import { get, post } from "@/api/client";

type Category =
  | "all"
  | "crm"
  | "restaurant"
  | "gym"
  | "healthcare"
  | "ecommerce"
  | "real-estate"
  | "education"
  | "other";

type SortOption = "popular" | "recent" | "price-low" | "price-high" | "highest-rated";

interface MarketplaceItem {
  id: string;
  title: string;
  description: string;
  category: Exclude<Category, "all">;
  price: number;
  rating: number;
  ratingCount: number;
  downloads: number;
  isMock?: boolean;
}

const MOCK_ITEMS: MarketplaceItem[] = [
  {
    id: "mock-1",
    title: "Real Estate CRM (Example)",
    description: "Complete CRM for real estate agents with lead tracking, deal pipeline, and automated follow-ups.",
    category: "crm",
    price: 49,
    rating: 4.6,
    ratingCount: 38,
    downloads: 312,
    isMock: true,
  },
  {
    id: "mock-2",
    title: "Restaurant Manager (Example)",
    description: "Inventory management system for restaurants. Track ingredients, suppliers, orders, and waste.",
    category: "restaurant",
    price: 29,
    rating: 4.2,
    ratingCount: 15,
    downloads: 187,
    isMock: true,
  },
  {
    id: "mock-3",
    title: "FitTrack (Example)",
    description: "Cross-platform fitness app with workout logging, progress charts, and meal planning.",
    category: "gym",
    price: 0,
    rating: 4.8,
    ratingCount: 92,
    downloads: 1420,
    isMock: true,
  },
  {
    id: "mock-4",
    title: "PatientCare (Example)",
    description: "Healthcare appointment scheduling, patient records management, and telemedicine integration.",
    category: "healthcare",
    price: 89,
    rating: 4.4,
    ratingCount: 21,
    downloads: 94,
    isMock: true,
  },
  {
    id: "mock-5",
    title: "ShopFront (Example)",
    description: "Full-featured online store with product catalog, shopping cart, and order management.",
    category: "ecommerce",
    price: 59,
    rating: 4.5,
    ratingCount: 67,
    downloads: 530,
    isMock: true,
  },
  {
    id: "mock-6",
    title: "Property Listings (Example)",
    description: "Real estate listing platform with map search, virtual tours, and agent dashboards.",
    category: "real-estate",
    price: 0,
    rating: 4.1,
    ratingCount: 12,
    downloads: 245,
    isMock: true,
  },
  {
    id: "mock-7",
    title: "EduLearn LMS (Example)",
    description: "Learning management system with courses, quizzes, certificates, and student analytics.",
    category: "education",
    price: 39,
    rating: 4.7,
    ratingCount: 45,
    downloads: 680,
    isMock: true,
  },
  {
    id: "mock-8",
    title: "GymPro Manager (Example)",
    description: "Gym membership management with class scheduling, trainer assignments, and payment processing.",
    category: "gym",
    price: 49,
    rating: 4.3,
    ratingCount: 28,
    downloads: 350,
    isMock: true,
  },
  {
    id: "mock-9",
    title: "Task Tracker Pro (Example)",
    description: "Complete task management with priority levels, filters, stats dashboard, and local storage persistence.",
    category: "other",
    price: 0,
    rating: 4.9,
    ratingCount: 156,
    downloads: 4820,
    isMock: true,
  },
];

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "all", label: "All" },
  { value: "crm", label: "CRM" },
  { value: "restaurant", label: "Restaurant" },
  { value: "gym", label: "Gym" },
  { value: "healthcare", label: "Healthcare" },
  { value: "ecommerce", label: "E-commerce" },
  { value: "real-estate", label: "Real Estate" },
  { value: "education", label: "Education" },
  { value: "other", label: "Other" },
];

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  crm: { bg: "#ede9fe", text: "#5b21b6" },
  restaurant: { bg: "#ffedd5", text: "#9a3412" },
  gym: { bg: "#ccfbf1", text: "#115e59" },
  healthcare: { bg: "#e0e7ff", text: "#3730a3" },
  ecommerce: { bg: "#fce7f3", text: "#9d174d" },
  "real-estate": { bg: "#fef3c7", text: "#92400e" },
  education: { bg: "#dbeafe", text: "#1e40af" },
  other: { bg: "#f3f4f6", text: "#374151" },
};

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "popular", label: "Popular" },
  { value: "recent", label: "Recent" },
  { value: "price-low", label: "Price: Low-High" },
  { value: "price-high", label: "Price: High-Low" },
  { value: "highest-rated", label: "Highest Rated" },
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
            className={`h-3.5 w-3.5 ${interactive ? "cursor-pointer" : ""}`}
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
      {count > 0 && (
        <span className="text-gray-400">
          {rating > 0 ? rating.toFixed(1) : ""} ({count})
        </span>
      )}
    </span>
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
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [usingMockData, setUsingMockData] = useState(false);
  const { addApp } = useAppStore();
  const { isAuthenticated } = useAuthStore();
  const navigate = useNavigate();

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
            category: (t.category || "other") as Exclude<Category, "all">,
            price: t.price || 0,
            rating: t.rating_avg || 0,
            ratingCount: t.rating_count || 0,
            downloads: t.purchases || 0,
          }));
          setItems(mapped);
          setUsingMockData(false);
        } else {
          setItems(MOCK_ITEMS);
          setUsingMockData(true);
        }
      } catch {
        setItems(MOCK_ITEMS);
        setUsingMockData(true);
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto-hide toast
  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 3500);
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
        return 0; // server-side order preserved
      case "price-low":
        return a.price - b.price;
      case "price-high":
        return b.price - a.price;
      case "highest-rated":
        return b.rating - a.rating;
      default:
        return 0;
    }
  });

  const cloneAppToProject = async (item: MarketplaceItem) => {
    if (item.isMock) {
      setToastMessage("This is an example listing. Publish your own app to see real ones here!");
      return false;
    }
    try {
      const res = await post<{ project_id: string; title: string }>(
        `/template-marketplace/${item.id}/purchase`,
        {}
      );
      if (res.project_id) {
        setJustAdded((prev) => new Set(prev).add(item.id));
        addApp({
          name: item.title,
          type: "software",
          status: "online",
          color: "#ec4899",
          source: "marketplace",
          projectId: res.project_id,
        });
        setToastMessage(`"${item.title}" added to your projects!`);
        setTimeout(() => navigate("/app"), 1500);
        return true;
      }
    } catch {
      setToastMessage("Failed to get app. Please try again.");
    }
    return false;
  };

  const handleGetApp = async (item: MarketplaceItem) => {
    if (!isAuthenticated) {
      setToastMessage("Please sign up to get this app. Redirecting...");
      setTimeout(() => navigate("/signup"), 1500);
      return;
    }
    if (item.price > 0) {
      setPurchaseItem(item);
      return;
    }
    await cloneAppToProject(item);
  };

  const handleRate = async (item: MarketplaceItem, stars: number) => {
    if (!isAuthenticated) {
      setToastMessage("Please sign in to rate apps.");
      return;
    }
    if (item.isMock) return;

    // Optimistic update
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id
          ? {
              ...i,
              rating: i.ratingCount > 0
                ? (i.rating * i.ratingCount + stars) / (i.ratingCount + 1)
                : stars,
              ratingCount: i.ratingCount + 1,
            }
          : i
      )
    );

    try {
      const res = await post<{
        rating_avg: number;
        rating_count: number;
      }>(`/template-marketplace/${item.id}/rate`, { rating: stars });
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? { ...i, rating: res.rating_avg, ratingCount: res.rating_count }
            : i
        )
      );
      setToastMessage(`Rated "${item.title}" ${stars} star${stars > 1 ? "s" : ""}`);
    } catch {
      // Revert optimistic update
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id ? { ...i, rating: item.rating, ratingCount: item.ratingCount } : i
        )
      );
      setToastMessage("Failed to submit rating.");
    }
  };

  if (initialLoading) {
    return (
      <div className="flex-1 overflow-y-auto bg-white">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="mb-10 text-center">
            <div className="mx-auto h-8 w-64 animate-pulse rounded-lg bg-gray-200" />
            <div className="mx-auto mt-3 h-5 w-96 animate-pulse rounded-lg bg-gray-100" />
            <div className="mx-auto mt-6 h-12 max-w-xl animate-pulse rounded-2xl bg-gray-100" />
          </div>
          <div className="mb-6 flex gap-2">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="h-9 w-24 animate-pulse rounded-full bg-gray-100" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="animate-pulse rounded-2xl border border-gray-100">
                <div className="h-40 rounded-t-2xl bg-gray-100" />
                <div className="space-y-3 p-4">
                  <div className="h-4 w-3/4 rounded bg-gray-100" />
                  <div className="h-3 w-full rounded bg-gray-50" />
                  <div className="flex justify-between pt-2">
                    <div className="h-4 w-20 rounded bg-gray-100" />
                    <div className="h-8 w-20 rounded-xl bg-gray-100" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-white">
      {/* Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 z-[200] -translate-x-1/2 animate-in slide-in-from-bottom-4">
          <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-3 shadow-lg">
            <p className="text-sm font-medium text-gray-800">{toastMessage}</p>
          </div>
        </div>
      )}

      {/* Hero Section */}
      <div className="border-b border-gray-100 bg-white px-6 pb-10 pt-12">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="text-3xl font-bold tracking-tight text-black sm:text-4xl">
            isibi marketplace
          </h1>
          <p className="mt-2 text-base text-gray-500">
            Discover software built by developers worldwide
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
                className="w-full rounded-2xl border border-gray-200 bg-gray-50 py-3.5 pl-12 pr-4 text-sm text-black placeholder-gray-400 transition focus:border-pink-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-pink-100"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* Mock data banner */}
        {usingMockData && (
          <div className="mb-6 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <Store className="h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-sm text-amber-800">
              These are example listings. <span className="font-medium">Publish your app</span> to see it here.
            </p>
          </div>
        )}

        {/* Category filter pills */}
        <div className="-mx-6 mb-6 overflow-x-auto px-6">
          <div className="flex gap-2 pb-2" style={{ minWidth: "max-content" }}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setCategory(cat.value)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-all whitespace-nowrap ${
                  category === cat.value
                    ? "bg-pink-500 text-white shadow-sm"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-black"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Sort bar */}
        <div className="mb-6 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            {filtered.length} app{filtered.length !== 1 ? "s" : ""}
          </p>
          <div className="relative">
            <button
              onClick={() => setShowSort(!showSort)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 transition hover:border-gray-300"
            >
              {SORT_OPTIONS.find((o) => o.value === sort)?.label}
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {showSort && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowSort(false)} />
                <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        setSort(opt.value);
                        setShowSort(false);
                      }}
                      className={`w-full px-4 py-2 text-left text-sm transition hover:bg-gray-50 ${
                        sort === opt.value ? "font-medium text-pink-500" : "text-gray-600"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* App Grid */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => (
            <div
              key={item.id}
              className="group rounded-2xl border border-gray-200 bg-white transition-all duration-200 hover:shadow-lg hover:border-gray-300 hover:-translate-y-0.5"
            >
              {/* Gradient thumbnail */}
              <div
                className="relative h-40 rounded-t-2xl flex items-center justify-center cursor-pointer overflow-hidden"
                style={{ background: hashGradient(item.title) }}
                onClick={() => setPreviewItem(item)}
              >
                <span className="text-5xl font-bold text-white/20 select-none">
                  {item.title.replace(/\s*\(Example\)/, "").charAt(0)}
                </span>
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-200 group-hover:bg-black/20 group-hover:opacity-100 rounded-t-2xl">
                  <Eye className="h-6 w-6 text-white drop-shadow" />
                </div>
              </div>

              {/* Card content */}
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-[15px] font-bold text-black leading-snug line-clamp-1">{item.title}</h3>
                  <span
                    className="shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                    style={{
                      backgroundColor: CATEGORY_COLORS[item.category]?.bg || "#f3f4f6",
                      color: CATEGORY_COLORS[item.category]?.text || "#374151",
                    }}
                  >
                    {CATEGORIES.find((c) => c.value === item.category)?.label || item.category}
                  </span>
                </div>

                <p className="mt-1.5 text-xs text-gray-500 line-clamp-1">{item.description}</p>

                <div className="mt-3 flex items-center justify-between">
                  <StarRating
                    rating={item.rating}
                    count={item.ratingCount}
                    interactive={isAuthenticated && !item.isMock}
                    onRate={(stars) => handleRate(item, stars)}
                  />
                  <span className="flex items-center gap-1 text-xs text-gray-400">
                    <Download className="h-3 w-3" />
                    {item.downloads.toLocaleString()}
                  </span>
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
                  {item.price === 0 ? (
                    <span className="inline-flex items-center rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-semibold text-green-700">
                      Free
                    </span>
                  ) : (
                    <span className="text-sm font-bold text-black">
                      ${item.price.toFixed(2)}
                    </span>
                  )}
                  <button
                    onClick={() => handleGetApp(item)}
                    className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold transition-all ${
                      justAdded.has(item.id)
                        ? "bg-green-500 text-white"
                        : item.price === 0
                        ? "bg-pink-500 text-white hover:bg-pink-600"
                        : "border border-pink-500 text-pink-500 hover:bg-pink-50"
                    }`}
                  >
                    {justAdded.has(item.id) ? (
                      <>
                        <Check className="h-3 w-3" />
                        Added
                      </>
                    ) : (
                      "Get App"
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

            <div
              className="relative h-56 rounded-t-2xl flex items-center justify-center"
              style={{ background: hashGradient(previewItem.title) }}
            >
              <span className="relative z-10 text-6xl font-bold text-white/20 select-none">
                {previewItem.title.replace(/\s*\(Example\)/, "").charAt(0)}
              </span>
              <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent rounded-t-2xl" />
            </div>

            <div className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-bold text-black">{previewItem.title}</h2>
                  {previewItem.isMock && (
                    <p className="mt-0.5 text-xs text-amber-600 font-medium">Example listing</p>
                  )}
                </div>
                <span
                  className="rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide"
                  style={{
                    backgroundColor: CATEGORY_COLORS[previewItem.category]?.bg || "#f3f4f6",
                    color: CATEGORY_COLORS[previewItem.category]?.text || "#374151",
                  }}
                >
                  {CATEGORIES.find((c) => c.value === previewItem.category)?.label || previewItem.category}
                </span>
              </div>

              <p className="mt-4 text-sm leading-relaxed text-gray-600">
                {previewItem.description}
              </p>

              <div className="mt-5 flex items-center gap-6 text-sm text-gray-500">
                <StarRating
                  rating={previewItem.rating}
                  count={previewItem.ratingCount}
                  interactive={isAuthenticated && !previewItem.isMock}
                  onRate={(stars) => handleRate(previewItem, stars)}
                />
                <span className="flex items-center gap-1">
                  <Download className="h-4 w-4" />
                  {previewItem.downloads.toLocaleString()} downloads
                </span>
              </div>

              <div className="mt-6 flex items-center justify-between border-t border-gray-100 pt-5">
                {previewItem.price === 0 ? (
                  <span className="inline-flex items-center rounded-full bg-green-50 px-3 py-1 text-sm font-bold text-green-700">
                    Free
                  </span>
                ) : (
                  <span className="text-2xl font-bold text-black">
                    ${previewItem.price.toFixed(2)}
                  </span>
                )}
                <button
                  onClick={() => {
                    handleGetApp(previewItem);
                    setPreviewItem(null);
                  }}
                  className="flex items-center gap-2 rounded-xl bg-pink-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-pink-600"
                >
                  {previewItem.price === 0 ? "Get App" : `Purchase - $${previewItem.price.toFixed(2)}`}
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
            <div
              className="relative h-32 flex items-center justify-center"
              style={{ background: hashGradient(purchaseItem.title) }}
            >
              <span className="relative z-10 text-5xl font-bold text-white/20 select-none">
                {purchaseItem.title.replace(/\s*\(Example\)/, "").charAt(0)}
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
                  <span className="text-xl font-bold text-black">${purchaseItem.price.toFixed(2)}</span>
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
                  if (purchaseItem.isMock) {
                    setToastMessage("This is an example listing. Payment coming soon!");
                    setPurchaseItem(null);
                    return;
                  }
                  setPurchasing(true);
                  await new Promise((r) => setTimeout(r, 800));
                  setPurchasing(false);
                  setToastMessage("Payment integration coming soon. Free apps are available now!");
                  setPurchaseItem(null);
                }}
                disabled={purchasing}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-pink-500 py-3 text-sm font-semibold text-white transition hover:bg-pink-600 disabled:opacity-60"
              >
                {purchasing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    Purchase for ${purchaseItem.price.toFixed(2)}
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
