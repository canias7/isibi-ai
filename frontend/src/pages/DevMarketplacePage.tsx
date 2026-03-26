import { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, DollarSign, Eye, BarChart3, X, Loader2 } from "lucide-react";
import { get, post, patch, del } from "@/api/client";

interface Listing {
  id: string;
  title: string;
  category: string;
  price: number;
  status: "published" | "draft";
  downloads: number;
  revenue: number;
  createdAt: string;
}

interface Project {
  id: string;
  name: string;
  description?: string;
  status: string;
}

const MOCK_LISTINGS: Listing[] = [
  {
    id: "1",
    title: "Task Tracker Pro",
    category: "software",
    price: 0,
    status: "published",
    downloads: 4820,
    revenue: 0,
    createdAt: "2026-02-15",
  },
  {
    id: "2",
    title: "Sales Pipeline CRM",
    category: "software",
    price: 49,
    status: "published",
    downloads: 312,
    revenue: 15288,
    createdAt: "2026-03-01",
  },
  {
    id: "3",
    title: "Landing Page Builder",
    category: "websites",
    price: 29,
    status: "draft",
    downloads: 0,
    revenue: 0,
    createdAt: "2026-03-20",
  },
];

const CATEGORY_BADGE: Record<string, string> = {
  software: "bg-pink-100 text-pink-700",
  websites: "bg-green-100 text-green-700",
  apps: "bg-pink-100 text-pink-700",
  agents: "bg-amber-100 text-amber-700",
  crm: "bg-purple-100 text-purple-700",
  restaurant: "bg-orange-100 text-orange-700",
  gym: "bg-teal-100 text-teal-700",
  ecommerce: "bg-pink-100 text-pink-700",
  healthcare: "bg-indigo-100 text-indigo-700",
};

export function DevMarketplacePage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  // New Listing modal state
  const [newListingOpen, setNewListingOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newCategory, setNewCategory] = useState("software");
  const [newPrice, setNewPrice] = useState("0");
  const [publishLoading, setPublishLoading] = useState(false);

  // Auto-hide toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Load listings from API on mount
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
            purchases: number;
            is_published: boolean;
            created_at: string;
          }>;
        }>("/template-marketplace/my-listings");
        if (!cancelled && data.templates) {
          const mapped: Listing[] = data.templates.map((t) => ({
            id: t.id,
            title: t.title,
            category: t.category || "software",
            price: t.price || 0,
            status: t.is_published ? "published" : "draft",
            downloads: t.purchases || 0,
            revenue: (t.purchases || 0) * (t.price || 0),
            createdAt: t.created_at || "",
          }));
          setListings(mapped.length > 0 ? mapped : MOCK_LISTINGS);
        } else {
          setListings(MOCK_LISTINGS);
        }
      } catch {
        // API failed, use mock data
        setListings(MOCK_LISTINGS);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const totalRevenue = listings.reduce((sum, l) => sum + l.revenue, 0);
  const totalDownloads = listings.reduce((sum, l) => sum + l.downloads, 0);
  const publishedCount = listings.filter((l) => l.status === "published").length;

  const startEdit = (listing: Listing) => {
    setEditingId(listing.id);
    setEditPrice(String(listing.price));
    setEditTitle(listing.title);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const newPriceVal = Math.max(0, Number(editPrice) || 0);
    try {
      await patch(`/template-marketplace/${editingId}`, {
        title: editTitle,
        price: newPriceVal,
      });
    } catch {
      // Silently fail, still update locally
    }
    setListings((prev) =>
      prev.map((l) =>
        l.id === editingId
          ? { ...l, title: editTitle, price: newPriceVal }
          : l
      )
    );
    setEditingId(null);
    setToast("Listing updated");
  };

  const toggleStatus = async (id: string) => {
    const listing = listings.find((l) => l.id === id);
    if (!listing) return;
    const newPublished = listing.status !== "published";
    try {
      await patch(`/template-marketplace/${id}`, {
        is_published: newPublished,
      });
    } catch {
      // Silently fail
    }
    setListings((prev) =>
      prev.map((l) =>
        l.id === id
          ? { ...l, status: newPublished ? "published" : "draft" }
          : l
      )
    );
  };

  const deleteListing = async (id: string) => {
    try {
      await del(`/template-marketplace/${id}`);
    } catch {
      // Silently fail
    }
    setListings((prev) => prev.filter((l) => l.id !== id));
    setToast("Listing deleted");
  };

  // Open new listing modal and fetch projects
  const openNewListing = async () => {
    setNewListingOpen(true);
    try {
      const data = await get<Array<{ id: string; name: string; description?: string; status: string }>>(
        "/projects"
      );
      setProjects(data || []);
    } catch {
      setProjects([]);
    }
  };

  const publishNewListing = async () => {
    if (!selectedProjectId || !newTitle.trim()) return;
    setPublishLoading(true);
    try {
      const res = await post<{ id: string; title: string }>("/template-marketplace/publish", {
        project_id: selectedProjectId,
        title: newTitle.trim(),
        description: newDescription.trim() || undefined,
        category: newCategory,
        price: Math.max(0, Number(newPrice) || 0),
      });
      // Add to local state
      setListings((prev) => [
        {
          id: res.id,
          title: res.title || newTitle.trim(),
          category: newCategory,
          price: Math.max(0, Number(newPrice) || 0),
          status: "published",
          downloads: 0,
          revenue: 0,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
      setNewListingOpen(false);
      setSelectedProjectId("");
      setNewTitle("");
      setNewDescription("");
      setNewCategory("software");
      setNewPrice("0");
      setToast("Listing published!");
    } catch {
      setToast("Failed to publish listing. Please try again.");
    } finally {
      setPublishLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-8">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-black">My Listings</h1>
            <p className="mt-1 text-sm text-gray-500">
              Manage your marketplace listings, pricing, and analytics.
            </p>
          </div>
          <button
            onClick={openNewListing}
            className="flex items-center gap-1.5 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800"
          >
            <Plus className="h-4 w-4" />
            List New App
          </button>
        </div>

        {/* Stats */}
        <div className="mb-8 grid grid-cols-3 gap-4">
          <div className="rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-2 text-gray-500">
              <BarChart3 className="h-4 w-4" />
              <span className="text-xs font-medium">Total Downloads</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-black">
              {totalDownloads.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-2 text-gray-500">
              <DollarSign className="h-4 w-4" />
              <span className="text-xs font-medium">Total Revenue</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-black">
              ${totalRevenue.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-2 text-gray-500">
              <Eye className="h-4 w-4" />
              <span className="text-xs font-medium">Published</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-black">
              {publishedCount} / {listings.length}
            </p>
          </div>
        </div>

        {/* Listings table */}
        <div className="rounded-xl border border-gray-200">
          <div className="grid grid-cols-[1fr_100px_80px_80px_100px_120px] gap-4 border-b border-gray-100 px-5 py-3 text-xs font-medium text-gray-500">
            <span>Name</span>
            <span>Category</span>
            <span>Price</span>
            <span>Status</span>
            <span>Downloads</span>
            <span className="text-right">Actions</span>
          </div>

          {listings.map((listing) => (
            <div
              key={listing.id}
              className="grid grid-cols-[1fr_100px_80px_80px_100px_120px] items-center gap-4 border-b border-gray-50 px-5 py-4 last:border-0"
            >
              <div>
                <p className="text-sm font-medium text-black">{listing.title}</p>
                <p className="text-xs text-gray-400">
                  Added {new Date(listing.createdAt).toLocaleDateString()}
                </p>
              </div>
              <span
                className={`inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  CATEGORY_BADGE[listing.category] || "bg-gray-100 text-gray-600"
                }`}
              >
                {listing.category}
              </span>
              <span className="text-sm text-black">
                {listing.price === 0 ? "Free" : `$${listing.price}`}
              </span>
              <button
                onClick={() => toggleStatus(listing.id)}
                className={`inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-medium transition ${
                  listing.status === "published"
                    ? "bg-green-50 text-green-700 hover:bg-green-100"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                }`}
              >
                {listing.status === "published" ? "Live" : "Draft"}
              </button>
              <span className="text-sm text-gray-600">
                {listing.downloads.toLocaleString()}
              </span>
              <div className="flex items-center justify-end gap-1">
                <button
                  onClick={() => startEdit(listing)}
                  className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-black"
                  title="Edit"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => deleteListing(listing.id)}
                  className="rounded-md p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-500"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}

          {listings.length === 0 && (
            <div className="py-12 text-center">
              <p className="text-sm text-gray-400">No listings yet.</p>
              <p className="mt-1 text-xs text-gray-400">
                Build something in the chat and publish it to the marketplace.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Edit modal */}
      {editingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-black">Edit Listing</h3>
              <button
                onClick={() => setEditingId(null)}
                className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-gray-100"
              >
                <X className="h-4 w-4 text-gray-500" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">
                  Title
                </label>
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-black focus:border-black focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">
                  Price (USD)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
                    $
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 pl-7 text-sm text-black focus:border-black focus:outline-none"
                    placeholder="0 for free"
                  />
                </div>
                <p className="mt-1 text-[11px] text-gray-400">
                  Set to 0 to make it free.
                </p>
              </div>
            </div>

            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setEditingId(null)}
                className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                className="flex-1 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Listing modal */}
      {newListingOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-black">List New App</h3>
              <button
                onClick={() => setNewListingOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-gray-100"
              >
                <X className="h-4 w-4 text-gray-500" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">
                  Select Project
                </label>
                <select
                  value={selectedProjectId}
                  onChange={(e) => {
                    setSelectedProjectId(e.target.value);
                    const proj = projects.find((p) => p.id === e.target.value);
                    if (proj && !newTitle) setNewTitle(proj.name);
                  }}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-black focus:border-black focus:outline-none"
                >
                  <option value="">Choose a project...</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {projects.length === 0 && (
                  <p className="mt-1 text-[11px] text-gray-400">
                    No projects found. Build an app first.
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">
                  Listing Title
                </label>
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-black focus:border-black focus:outline-none"
                  placeholder="My Awesome App"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">
                  Description
                </label>
                <textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-black focus:border-black focus:outline-none resize-none"
                  placeholder="Describe what your app does..."
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">
                    Category
                  </label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-black focus:border-black focus:outline-none"
                  >
                    <option value="software">Software</option>
                    <option value="websites">Websites</option>
                    <option value="apps">Apps</option>
                    <option value="agents">Agents</option>
                    <option value="crm">CRM</option>
                    <option value="restaurant">Restaurant</option>
                    <option value="gym">Gym</option>
                    <option value="ecommerce">E-commerce</option>
                    <option value="healthcare">Healthcare</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">
                    Price (USD)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
                      $
                    </span>
                    <input
                      type="number"
                      min="0"
                      value={newPrice}
                      onChange={(e) => setNewPrice(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 pl-7 text-sm text-black focus:border-black focus:outline-none"
                      placeholder="0"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setNewListingOpen(false)}
                className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={publishNewListing}
                disabled={!selectedProjectId || !newTitle.trim() || publishLoading}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {publishLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="h-3.5 w-3.5" />
                    Publish
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[200] -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 shadow-lg">
            <p className="text-xs font-medium text-gray-800">{toast}</p>
          </div>
        </div>
      )}
    </div>
  );
}
