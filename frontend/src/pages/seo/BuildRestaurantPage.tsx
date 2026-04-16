import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

export function BuildRestaurantPage() {
  const [faqOpen, setFaqOpen] = useState<number | null>(null);

  useEffect(() => {
    document.title = "Build Restaurant Management Software in Minutes | isibi.ai";
    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
      meta.setAttribute("content", "Build custom restaurant management software with AI. Reservations, menu management, order processing, and staff scheduling — no coding required. Deploy in minutes with isibi.ai.");
    } else {
      const newMeta = document.createElement("meta");
      newMeta.name = "description";
      newMeta.content = "Build custom restaurant management software with AI. Reservations, menu management, order processing, and staff scheduling — no coding required. Deploy in minutes with isibi.ai.";
      document.head.appendChild(newMeta);
    }
    return () => { document.title = "isibi.ai"; };
  }, []);

  return (
    <div className="min-h-screen bg-white text-black" style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* ── NAV ── */}
      <nav className="fixed top-0 z-50 w-full bg-white/90 backdrop-blur border-b border-gray-100">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-xl font-bold tracking-tight">
            isibi<span className="text-gray-400">.ai</span>
          </Link>
          <Link to="/signup" className="rounded-lg bg-pink-500 px-5 py-2 text-sm font-medium text-white hover:bg-pink-600 transition">
            Get started
          </Link>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative pt-32 pb-20 px-6 text-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-pink-50/60 to-white" />
        <div className="relative z-10 mx-auto max-w-4xl">
          <p className="text-sm font-semibold uppercase tracking-widest text-pink-500 mb-4">AI-Powered Restaurant Software</p>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold leading-tight tracking-tight">
            Build Your <span style={{ color: "#ec4899" }}>Restaurant Software</span> in Minutes
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-500 leading-relaxed">
            Describe your restaurant operations and our AI builds a complete management system — reservations, menu management, kitchen orders, and staff scheduling. No coding required.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to="/signup" className="rounded-xl px-8 py-4 text-sm font-semibold text-white shadow-lg hover:shadow-xl hover:brightness-110 transition" style={{ backgroundColor: "#ec4899" }}>
              Start Building — Free
            </Link>
            <Link to="/#how-it-works" className="rounded-xl border-2 border-black px-8 py-4 text-sm font-semibold text-black hover:bg-black hover:text-white transition">
              See How It Works
            </Link>
          </div>
        </div>
      </section>

      {/* ── 6 FEATURE BULLETS ── */}
      <section className="py-20 bg-gray-50/50">
        <div className="mx-auto max-w-7xl px-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 text-center">Features</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-center sm:text-4xl">Run your restaurant smarter</h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: "\u{1F4C5}", title: "Reservation System", desc: "Online booking with table layout, capacity tracking, waitlist management, and automated confirmation emails." },
              { icon: "\u{1F4DC}", title: "Menu Management", desc: "Digital menu editor with categories, pricing, allergen info, seasonal items, and photo uploads for each dish." },
              { icon: "\u{1F9FE}", title: "Order Processing", desc: "Dine-in, takeout, and delivery orders in one system. Kitchen display with ticket management and prep timing." },
              { icon: "\u{1F465}", title: "Staff Scheduling", desc: "Employee scheduling with shift management, availability tracking, role-based access, and labor cost monitoring." },
              { icon: "\u{1F4E6}", title: "Inventory Tracking", desc: "Track ingredients, set low-stock alerts, calculate food costs per dish, and reduce waste with usage reports." },
              { icon: "\u{1F4CA}", title: "Revenue Analytics", desc: "Daily sales reports, popular dish analysis, peak hour tracking, and table turnover metrics on a real-time dashboard." },
            ].map((f) => (
              <div key={f.title} className="group rounded-2xl border border-gray-200 bg-white p-6 transition hover:border-pink-200 hover:shadow-lg hover:shadow-pink-500/5">
                <div className="text-3xl mb-4">{f.icon}</div>
                <h3 className="text-base font-bold">{f.title}</h3>
                <p className="mt-1 text-sm text-gray-500">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHAT YOU GET ── */}
      <section className="py-20">
        <div className="mx-auto max-w-7xl px-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 text-center">What You Get</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-center sm:text-4xl">A complete restaurant system</h2>
          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: "\u{1F4BB}", label: "Dashboard", desc: "Today's reservations, active orders, and sales at a glance" },
              { icon: "\u{1F5C2}", label: "Full CRUD", desc: "Manage menus, reservations, orders, staff, and inventory" },
              { icon: "\u{1F4F1}", label: "Mobile Access", desc: "Managers check sales from their phone; staff view schedules on any device" },
              { icon: "\u{1F4C8}", label: "Analytics", desc: "Revenue trends, food cost reports, and customer visit patterns" },
            ].map((item) => (
              <div key={item.label} className="text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-pink-50 text-3xl">{item.icon}</div>
                <h3 className="font-bold text-lg">{item.label}</h3>
                <p className="mt-2 text-sm text-gray-500">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SEE IT IN ACTION ── */}
      <section className="py-20 bg-gray-50/50">
        <div className="mx-auto max-w-5xl px-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 text-center">See It In Action</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-center sm:text-4xl">Your restaurant app, built by AI</h2>
          <div className="mt-12 mx-auto max-w-4xl">
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl shadow-black/10">
              <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-4 py-3">
                <span className="h-3 w-3 rounded-full bg-red-400" />
                <span className="h-3 w-3 rounded-full bg-yellow-400" />
                <span className="h-3 w-3 rounded-full bg-green-400" />
                <div className="ml-3 flex-1 rounded-md bg-white px-3 py-1 text-xs text-gray-400 border border-gray-100">my-restaurant.isibi.ai</div>
              </div>
              <div className="flex min-h-[320px]">
                <div className="w-48 border-r border-gray-100 bg-gray-50 p-4 hidden sm:block">
                  {["Dashboard", "Reservations", "Menu", "Orders", "Staff", "Reports"].map((item, i) => (
                    <div key={item} className={`rounded-lg px-3 py-2 text-xs mb-1 ${i === 0 ? "bg-pink-500 text-white font-medium" : "text-gray-500 hover:bg-gray-100"}`}>{item}</div>
                  ))}
                </div>
                <div className="flex-1 p-4 sm:p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div><div className="h-2 w-28 rounded bg-gray-300 mb-1" /><div className="h-1.5 w-20 rounded bg-gray-200" /></div>
                    <div className="h-7 w-28 rounded-lg bg-pink-500" />
                  </div>
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    {["24", "$3.8K", "8"].map((val, i) => (
                      <div key={i} className="rounded-lg border border-gray-100 bg-white p-3 text-center">
                        <p className="text-sm font-bold" style={{ color: "#ec4899" }}>{val}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">{["Reservations", "Today Sales", "Active Orders"][i]}</p>
                      </div>
                    ))}
                  </div>
                  {/* Table layout mockup */}
                  <div className="grid grid-cols-4 gap-2">
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((t) => (
                      <div key={t} className={`rounded-lg border p-2 text-center text-[10px] ${t <= 3 ? "border-pink-200 bg-pink-50 text-pink-600" : t <= 5 ? "border-yellow-200 bg-yellow-50 text-yellow-600" : "border-gray-100 bg-gray-50 text-gray-400"}`}>
                        T{t}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="py-20">
        <div className="mx-auto max-w-3xl px-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 text-center">FAQ</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-center sm:text-4xl">Restaurant software questions</h2>
          <div className="mt-12 space-y-3">
            {[
              { q: "Can I use this for multiple restaurant locations?", a: "Yes. You can generate separate apps per location or build one unified system with multi-location support. Each location gets its own menu, staff schedule, and reporting while sharing a central dashboard." },
              { q: "Does it handle online ordering and delivery?", a: "Absolutely. The AI generates a complete online ordering flow including menu browsing, cart, checkout, and delivery tracking. Customers can order from your branded website — no third-party fees." },
              { q: "How does this compare to Toast or Square?", a: "isibi.ai builds software tailored to your exact workflow — not a one-size-fits-all POS. You get only the features you need, fully customizable, at a fraction of the cost. No per-transaction fees or hardware lock-in." },
            ].map((item, i) => (
              <div key={i} className="rounded-xl border border-gray-200 bg-white overflow-hidden transition hover:border-gray-300">
                <button onClick={() => setFaqOpen(faqOpen === i ? null : i)} className="flex w-full items-center justify-between px-6 py-4 text-left">
                  <span className="text-sm font-semibold text-black pr-4">{item.q}</span>
                  <svg className={`h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 ${faqOpen === i ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <div className={`overflow-hidden transition-all duration-300 ${faqOpen === i ? "max-h-60 pb-4" : "max-h-0"}`}>
                  <p className="px-6 text-sm leading-relaxed text-gray-500">{item.a}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── BOTTOM CTA ── */}
      <section className="py-24 bg-gray-50/50">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-5xl">Modernize your restaurant operations</h2>
          <p className="mx-auto mt-4 max-w-md text-gray-500">No credit card required. Describe your restaurant and have your system running in minutes.</p>
          <div className="mt-10">
            <Link to="/signup" className="inline-block rounded-xl px-12 py-4 text-base font-semibold text-white shadow-lg hover:shadow-xl hover:brightness-110 transition" style={{ backgroundColor: "#ec4899" }}>
              Start Building — Free
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-gray-200 bg-white py-8">
        <div className="mx-auto max-w-7xl px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-sm font-bold">isibi<span className="text-gray-400">.ai</span></span>
          <p className="text-xs text-gray-400">&copy; 2026 isibi.ai. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

export default BuildRestaurantPage;
