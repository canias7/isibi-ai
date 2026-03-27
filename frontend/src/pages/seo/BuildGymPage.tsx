import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

export function BuildGymPage() {
  const [faqOpen, setFaqOpen] = useState<number | null>(null);

  useEffect(() => {
    document.title = "Build Gym Management Software in Minutes | isibi.ai";
    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
      meta.setAttribute("content", "Build custom gym and fitness studio management software with AI. Memberships, class scheduling, check-ins, and billing — no coding required. Deploy in minutes with isibi.ai.");
    } else {
      const newMeta = document.createElement("meta");
      newMeta.name = "description";
      newMeta.content = "Build custom gym and fitness studio management software with AI. Memberships, class scheduling, check-ins, and billing — no coding required. Deploy in minutes with isibi.ai.";
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
          <p className="text-sm font-semibold uppercase tracking-widest text-pink-500 mb-4">AI-Powered Gym Software</p>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold leading-tight tracking-tight">
            Build Your <span style={{ color: "#ec4899" }}>Gym Software</span> in Minutes
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-500 leading-relaxed">
            Describe your gym or fitness studio and our AI builds a complete management platform — memberships, class scheduling, check-ins, billing, and member analytics. No coding required.
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
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-center sm:text-4xl">Everything your gym needs to thrive</h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: "\u{1F4B3}", title: "Membership Management", desc: "Manage plans, pricing tiers, and recurring billing. Handle trials, freezes, cancellations, and family memberships." },
              { icon: "\u{1F4C5}", title: "Class Scheduling", desc: "Create class schedules, manage instructor assignments, set capacity limits, and let members book spots online." },
              { icon: "\u{2705}", title: "Check-in Tracking", desc: "Digital check-in system with visit history, attendance trends, and automatic alerts for at-risk members." },
              { icon: "\u{1F4B0}", title: "Billing & Payments", desc: "Automated recurring billing, payment reminders, failed payment retries, and revenue tracking per membership tier." },
              { icon: "\u{1F3CB}", title: "Trainer Management", desc: "Personal training session booking, trainer availability calendars, client progress tracking, and session packages." },
              { icon: "\u{1F4CA}", title: "Growth Analytics", desc: "Member retention rates, class popularity reports, revenue forecasts, churn analysis, and growth trend dashboards." },
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
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-center sm:text-4xl">A complete gym management platform</h2>
          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: "\u{1F4BB}", label: "Dashboard", desc: "Active members, today's classes, check-ins, and revenue at a glance" },
              { icon: "\u{1F5C2}", label: "Full CRUD", desc: "Manage members, classes, trainers, plans, and payments" },
              { icon: "\u{1F4F1}", label: "Mobile App", desc: "Members book classes, check schedules, and manage their account from any device" },
              { icon: "\u{1F4C8}", label: "Analytics", desc: "Retention curves, revenue per member, and class utilization reports" },
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
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-center sm:text-4xl">Your gym app, built by AI</h2>
          <div className="mt-12 mx-auto max-w-4xl">
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl shadow-black/10">
              <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-4 py-3">
                <span className="h-3 w-3 rounded-full bg-red-400" />
                <span className="h-3 w-3 rounded-full bg-yellow-400" />
                <span className="h-3 w-3 rounded-full bg-green-400" />
                <div className="ml-3 flex-1 rounded-md bg-white px-3 py-1 text-xs text-gray-400 border border-gray-100">my-gym.isibi.ai</div>
              </div>
              <div className="flex min-h-[320px]">
                <div className="w-48 border-r border-gray-100 bg-gray-50 p-4 hidden sm:block">
                  {["Dashboard", "Members", "Classes", "Trainers", "Billing", "Reports"].map((item, i) => (
                    <div key={item} className={`rounded-lg px-3 py-2 text-xs mb-1 ${i === 0 ? "bg-pink-500 text-white font-medium" : "text-gray-500 hover:bg-gray-100"}`}>{item}</div>
                  ))}
                </div>
                <div className="flex-1 p-4 sm:p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div><div className="h-2 w-24 rounded bg-gray-300 mb-1" /><div className="h-1.5 w-16 rounded bg-gray-200" /></div>
                    <div className="h-7 w-24 rounded-lg bg-pink-500" />
                  </div>
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    {["342", "28", "$12.4K"].map((val, i) => (
                      <div key={i} className="rounded-lg border border-gray-100 bg-white p-3 text-center">
                        <p className="text-sm font-bold" style={{ color: "#ec4899" }}>{val}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">{["Members", "Classes/wk", "MRR"][i]}</p>
                      </div>
                    ))}
                  </div>
                  {/* Schedule mockup */}
                  <div className="space-y-1.5">
                    {[
                      { time: "6:00 AM", name: "HIIT Blast", spots: "3/20" },
                      { time: "8:00 AM", name: "Yoga Flow", spots: "8/15" },
                      { time: "12:00 PM", name: "Strength", spots: "12/20" },
                      { time: "5:30 PM", name: "Spin Class", spots: "1/25" },
                    ].map((cls) => (
                      <div key={cls.time} className="flex items-center gap-3 rounded-lg border border-gray-100 bg-white p-2.5">
                        <span className="text-[10px] font-medium text-gray-400 w-14">{cls.time}</span>
                        <span className="text-xs font-medium flex-1">{cls.name}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${cls.spots.startsWith("1/") ? "bg-red-50 text-red-500 border border-red-200" : "bg-green-50 text-green-600 border border-green-200"}`}>{cls.spots}</span>
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
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-center sm:text-4xl">Gym software questions</h2>
          <div className="mt-12 space-y-3">
            {[
              { q: "Can members book classes and manage their account online?", a: "Yes. The generated app includes a member-facing portal where members can view the class schedule, book spots, manage their membership plan, update payment methods, and track their visit history." },
              { q: "Does it handle recurring billing and payment failures?", a: "Absolutely. The AI builds automated recurring billing with Stripe integration. It handles failed payment retries, sends payment reminder emails, and can auto-freeze memberships after missed payments." },
              { q: "How does this compare to Mindbody or Glofox?", a: "isibi.ai builds gym software tailored to your exact needs — no bloated features or per-member pricing. You pay a flat rate, own the code, and customize everything. No long-term contracts or hidden transaction fees." },
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
          <h2 className="text-3xl font-bold tracking-tight sm:text-5xl">Power your gym with custom software</h2>
          <p className="mx-auto mt-4 max-w-md text-gray-500">No credit card required. Describe your gym and have your platform running in minutes.</p>
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

export default BuildGymPage;
