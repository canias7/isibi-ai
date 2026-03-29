import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { DownloadBanner } from "@/components/DownloadBanner";

export function LandingPage() {
  const { isAuthenticated } = useAuthStore();
  const [scrollY, setScrollY] = useState(0);
  const [visibleSections, setVisibleSections] = useState<Set<string>>(new Set());

  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisibleSections((prev) => new Set([...prev, entry.target.id]));
          }
        });
      },
      { threshold: 0.1 }
    );
    document.querySelectorAll("[data-animate]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const [faqOpen, setFaqOpen] = useState<number | null>(null);

  // Animated counter state
  const statsRef = useRef<HTMLDivElement>(null);
  const [statsVisible, setStatsVisible] = useState(false);
  const [counters, setCounters] = useState({ apps: 0, templates: 0, uptime: 0, rating: 0 });

  useEffect(() => {
    if (!statsRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStatsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(statsRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!statsVisible) return;
    const duration = 1500;
    const steps = 40;
    const targets = { apps: 10000, templates: 1000, uptime: 999, rating: 49 };
    let step = 0;
    const interval = setInterval(() => {
      step++;
      const progress = Math.min(step / steps, 1);
      const ease = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setCounters({
        apps: Math.round(targets.apps * ease),
        templates: Math.round(targets.templates * ease),
        uptime: Math.round(targets.uptime * ease),
        rating: Math.round(targets.rating * ease),
      });
      if (step >= steps) clearInterval(interval);
    }, duration / steps);
    return () => clearInterval(interval);
  }, [statsVisible]);

  // Inject JSON-LD structured data
  useEffect(() => {
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "isibi.ai",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      offers: {
        "@type": "AggregateOffer",
        lowPrice: "0",
        highPrice: "79",
        priceCurrency: "USD",
      },
      description: "AI-powered software builder. Describe what you need, our AI builds it.",
    });
    document.head.appendChild(script);
    return () => {
      document.head.removeChild(script);
    };
  }, []);

  const isVisible = (id: string) => visibleSections.has(id);

  const fadeIn = (id: string) =>
    `transition-all duration-700 ${isVisible(id) ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0"}`;

  return (
    <div className="min-h-screen bg-white text-black" style={{ fontFamily: "'Inter', sans-serif", scrollBehavior: "smooth" }}>

      {/* ──────────────── NAV ──────────────── */}
      <nav className="fixed top-0 z-50 w-full">
        <div
          className="transition-all duration-300"
          style={{
            backgroundColor: scrollY > 50 ? "rgba(255,255,255,0.92)" : "transparent",
            backdropFilter: scrollY > 50 ? "blur(20px)" : "none",
            borderBottom: scrollY > 50 ? "1px solid #e5e7eb" : "1px solid transparent",
          }}
        >
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
            <Link to="/" className="text-xl font-bold tracking-tight">
              isibi<span className="text-gray-400">.ai</span>
            </Link>
            <div className="hidden items-center gap-8 md:flex">
              <a href="#how-it-works" className="text-sm text-gray-500 transition hover:text-black">How it works</a>
              <a href="#features" className="text-sm text-gray-500 transition hover:text-black">Features</a>
              <a href="#pricing" className="text-sm text-gray-500 transition hover:text-black">Pricing</a>
            </div>
            <div className="flex items-center gap-3">
              {isAuthenticated ? (
                <Link
                  to="/app"
                  className="rounded-lg bg-pink-500 px-5 py-2 text-sm font-medium text-white transition hover:bg-pink-600"
                >
                  Go to Dashboard
                </Link>
              ) : (
                <>
                  <Link
                    to="/login"
                    className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 transition hover:text-black"
                  >
                    Sign in
                  </Link>
                  <Link
                    to="/signup"
                    className="rounded-lg bg-pink-500 px-5 py-2 text-sm font-medium text-white transition hover:bg-pink-600"
                  >
                    Get started
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* ──────────────── HERO ──────────────── */}
      <section className="relative flex min-h-screen flex-col items-center justify-center px-6 pt-20 overflow-hidden">
        <div className="relative z-10 mx-auto max-w-5xl text-center">
          <h1
            className="text-5xl font-extrabold leading-[1.08] tracking-tight sm:text-6xl md:text-7xl lg:text-8xl"
            style={{ opacity: Math.max(1 - scrollY * 0.002, 0) }}
          >
            Build Software in
            <br />
            <span style={{ color: "#ec4899" }}>Minutes, Not Months</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-gray-500 sm:text-xl">
            Describe what you need. Our AI builds it. Deploy instantly.
          </p>

          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              to="/signup"
              className="group rounded-xl px-8 py-4 text-sm font-semibold text-white shadow-lg transition hover:shadow-xl hover:brightness-110"
              style={{ backgroundColor: "#ec4899" }}
            >
              Start Building — Free
            </Link>
            <button
              onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
              className="rounded-xl border-2 border-black px-8 py-4 text-sm font-semibold text-black transition hover:bg-black hover:text-white"
            >
              Watch Demo
            </button>
          </div>

          {/* Animated mockup — typing → building → finished app, 8s loop */}
          <div className="mx-auto mt-16 max-w-4xl">
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl shadow-black/10">
              {/* Browser chrome */}
              <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-4 py-3">
                <span className="h-3 w-3 rounded-full bg-red-400" />
                <span className="h-3 w-3 rounded-full bg-yellow-400" />
                <span className="h-3 w-3 rounded-full bg-green-400" />
                <div className="ml-3 flex-1 rounded-md bg-white px-3 py-1 text-xs text-gray-400 border border-gray-100">
                  app.isibi.ai
                </div>
              </div>
              {/* Split layout: chat + preview */}
              <div className="flex min-h-[320px] sm:min-h-[360px]">
                {/* Chat side */}
                <div className="w-2/5 border-r border-gray-100 p-4 sm:p-6 bg-gray-50/50">
                  <div className="space-y-4">
                    {/* Typing chat bubble */}
                    <div className="rounded-lg bg-white border border-gray-100 px-3 py-2 text-xs text-gray-600 shadow-sm overflow-hidden">
                      <span className="demo-typing">Build me a CRM for real estate</span>
                    </div>
                    {/* AI response — appears after typing */}
                    <div className="rounded-lg px-3 py-2 text-xs text-white demo-ai-response" style={{ backgroundColor: "#ec4899" }}>
                      <p className="font-medium">Building your app...</p>
                      <p className="mt-1 opacity-80">Creating database schema, API endpoints, and UI components</p>
                    </div>
                    {/* Build steps */}
                    <div className="space-y-2">
                      {["Database tables created", "API routes generated", "UI components built", "Deployed!"].map((item, i) => (
                        <div key={item} className={`flex items-center gap-2 text-xs text-gray-500 demo-step demo-step-${i}`}>
                          <span className="text-green-500">&#10003;</span> {item}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                {/* Preview side — code lines → finished app */}
                <div className="w-3/5 p-4 sm:p-6 relative overflow-hidden">
                  {/* Phase 2: Code lines building */}
                  <div className="demo-code-phase absolute inset-0 p-4 sm:p-6">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Generating...</span>
                      <span className="demo-pulse rounded-full px-2 py-0.5 text-[10px] font-medium text-yellow-700 bg-yellow-50 border border-yellow-200">Building</span>
                    </div>
                    <div className="space-y-1.5 font-mono text-[10px] text-gray-400">
                      {[
                        "CREATE TABLE contacts (",
                        "  id UUID PRIMARY KEY,",
                        "  name TEXT NOT NULL,",
                        "  email VARCHAR(255),",
                        "  company TEXT,",
                        "  deal_value NUMERIC,",
                        "  status TEXT DEFAULT 'lead',",
                        ");",
                        "",
                        "GET  /api/contacts",
                        "POST /api/contacts",
                        "GET  /api/deals",
                        "POST /api/deals",
                      ].map((line, i) => (
                        <div key={i} className={`demo-code-line demo-code-line-${i}`}>
                          <span className="text-pink-400 mr-2">{i < 8 ? "SQL" : "API"}</span>
                          {line}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Phase 3: Finished app */}
                  <div className="demo-app-phase">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Live Preview</span>
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-medium text-green-700 bg-green-50 border border-green-200">Live</span>
                    </div>
                    <div className="flex gap-2 min-h-[240px]">
                      {/* Mini sidebar */}
                      <div className="w-20 rounded-lg bg-gray-50 p-2 hidden sm:block">
                        {["Dashboard", "Contacts", "Deals", "Pipeline"].map((item, i) => (
                          <div key={item} className={`rounded px-2 py-1.5 text-[9px] mb-1 ${i === 0 ? "text-white font-medium" : "text-gray-400"}`} style={i === 0 ? { backgroundColor: "#ec4899" } : {}}>
                            {item}
                          </div>
                        ))}
                      </div>
                      {/* Main area */}
                      <div className="flex-1">
                        <div className="grid grid-cols-3 gap-1.5 mb-3">
                          {["$340K", "89", "24"].map((val, i) => (
                            <div key={i} className="rounded-lg border border-gray-100 bg-white p-2 text-center">
                              <p className="text-xs font-bold" style={{ color: "#ec4899" }}>{val}</p>
                              <p className="text-[8px] text-gray-400">{["Revenue", "Contacts", "Deals"][i]}</p>
                            </div>
                          ))}
                        </div>
                        <div className="space-y-1.5">
                          {[1, 2, 3].map((row) => (
                            <div key={row} className="flex items-center gap-2 rounded border border-gray-100 bg-white p-2">
                              <div className="h-5 w-5 rounded-full bg-pink-100 shrink-0" />
                              <div className="flex-1"><div className="h-1.5 w-16 rounded bg-gray-200 mb-0.5" /><div className="h-1 w-10 rounded bg-gray-100" /></div>
                              <div className="h-4 w-12 rounded-full bg-green-50 border border-green-200" />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Trust line */}
          <p className="mt-10 text-sm text-gray-400">
            1,000+ templates &bull; No coding required &bull; Deploy in one click
          </p>
        </div>

        <style>{`
          /* ── 8-second demo animation loop ── */

          /* Phase 1 (0–2s): Typing animation in chat bubble */
          .demo-typing {
            display: inline-block;
            overflow: hidden;
            white-space: nowrap;
            border-right: 2px solid #ec4899;
            width: 0;
            animation: demoType 1.8s steps(32, end) 0s forwards,
                       demoBlink 0.5s step-end infinite,
                       demoReset 8s linear infinite;
          }
          @keyframes demoType {
            from { width: 0; }
            to { width: 100%; }
          }
          @keyframes demoBlink {
            50% { border-color: transparent; }
          }
          @keyframes demoReset {
            0%, 95% { opacity: 1; }
            97% { opacity: 0; }
            100% { opacity: 1; }
          }

          /* Phase 1→2 (2s): AI response appears */
          .demo-ai-response {
            opacity: 0;
            animation: demoFadeIn 0.4s ease 2s forwards, demoLoop 8s linear infinite;
          }
          @keyframes demoFadeIn {
            from { opacity: 0; transform: translateY(4px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes demoLoop {
            0%, 20% { opacity: 0; }
            28% { opacity: 1; }
            92% { opacity: 1; }
            97% { opacity: 0; }
            100% { opacity: 0; }
          }

          /* Build steps appear one by one (2.5s–4s) */
          .demo-step {
            opacity: 0;
            animation: demoStepLoop 8s linear infinite;
          }
          .demo-step-0 { animation-delay: 0s; }
          .demo-step-1 { animation-delay: 0.3s; }
          .demo-step-2 { animation-delay: 0.6s; }
          .demo-step-3 { animation-delay: 0.9s; }
          @keyframes demoStepLoop {
            0%, 30% { opacity: 0; transform: translateX(-8px); }
            35% { opacity: 1; transform: translateX(0); }
            92% { opacity: 1; }
            97% { opacity: 0; }
            100% { opacity: 0; }
          }

          /* Phase 2 (2–5s): Code lines appear */
          .demo-code-phase {
            opacity: 0;
            animation: demoCodePhase 8s linear infinite;
          }
          @keyframes demoCodePhase {
            0%, 22% { opacity: 0; }
            28% { opacity: 1; }
            58% { opacity: 1; }
            63% { opacity: 0; }
            100% { opacity: 0; }
          }
          .demo-code-line {
            opacity: 0;
            animation: demoCodeLine 8s linear infinite;
          }
          .demo-code-line-0 { animation-delay: 0s; }
          .demo-code-line-1 { animation-delay: 0.12s; }
          .demo-code-line-2 { animation-delay: 0.24s; }
          .demo-code-line-3 { animation-delay: 0.36s; }
          .demo-code-line-4 { animation-delay: 0.48s; }
          .demo-code-line-5 { animation-delay: 0.6s; }
          .demo-code-line-6 { animation-delay: 0.72s; }
          .demo-code-line-7 { animation-delay: 0.84s; }
          .demo-code-line-8 { animation-delay: 0.96s; }
          .demo-code-line-9 { animation-delay: 1.08s; }
          .demo-code-line-10 { animation-delay: 1.2s; }
          .demo-code-line-11 { animation-delay: 1.32s; }
          .demo-code-line-12 { animation-delay: 1.44s; }
          @keyframes demoCodeLine {
            0%, 25% { opacity: 0; transform: translateY(4px); }
            30% { opacity: 1; transform: translateY(0); }
            58% { opacity: 1; }
            63% { opacity: 0; }
            100% { opacity: 0; }
          }

          /* Phase 3 (5–8s): Finished app */
          .demo-app-phase {
            opacity: 0;
            animation: demoAppPhase 8s linear infinite;
          }
          @keyframes demoAppPhase {
            0%, 60% { opacity: 0; transform: scale(0.98); }
            65% { opacity: 1; transform: scale(1); }
            92% { opacity: 1; transform: scale(1); }
            97% { opacity: 0; transform: scale(0.98); }
            100% { opacity: 0; }
          }

          .demo-pulse {
            animation: demoPulse 1s ease-in-out infinite;
          }
          @keyframes demoPulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }

          @keyframes fadeSlideIn {
            from { opacity: 0; transform: translateX(-8px); }
            to { opacity: 1; transform: translateX(0); }
          }
        `}</style>
      </section>

      {/* ──────────────── LOGOS / TRUST BAR ──────────────── */}
      <section id="trust" data-animate className={`py-16 border-y border-gray-100 ${fadeIn("trust")}`}>
        <div className="mx-auto max-w-7xl px-6">
          <p className="text-center text-xs font-medium uppercase tracking-widest text-gray-400 mb-8">
            Trusted by teams at
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-4 overflow-x-auto">
            {["Acme Corp", "TechStart", "BuildFast", "LaunchPad", "ScaleUp", "InnovateCo"].map((name) => (
              <span key={name} className="whitespace-nowrap text-lg font-semibold text-gray-300 transition hover:text-gray-400">
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ──────────────── STATS BAR ──────────────── */}
      <section ref={statsRef} className="py-12 bg-white">
        <div className="mx-auto max-w-5xl px-6">
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            {[
              { value: `${counters.apps.toLocaleString()}+`, label: "Apps built" },
              { value: `${counters.templates.toLocaleString()}+`, label: "Templates" },
              { value: `${(counters.uptime / 10).toFixed(1)}%`, label: "Uptime" },
              { value: `${(counters.rating / 10).toFixed(1)}/5`, label: "Rating" },
            ].map(({ value, label }) => (
              <div key={label} className="text-center">
                <p className="text-3xl font-extrabold tracking-tight sm:text-4xl" style={{ color: "#ec4899" }}>
                  {value}
                </p>
                <p className="mt-1 text-sm text-gray-500">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ──────────────── DOWNLOAD DESKTOP APP ──────────────── */}
      <section className="py-12">
        <div className="mx-auto max-w-5xl px-6">
          <DownloadBanner />
        </div>
      </section>

      {/* ──────────────── HOW IT WORKS ──────────────── */}
      <section id="how-it-works" data-animate className={`py-24 ${fadeIn("how-it-works")}`}>
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center mb-16">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">How it works</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
              Three steps to launch
            </h2>
          </div>

          <div className="relative grid gap-8 md:grid-cols-3">
            {/* Connecting line */}
            <div className="hidden md:block absolute top-16 left-[20%] right-[20%] h-0.5 bg-gray-200" />

            {[
              { num: "1", emoji: "\uD83D\uDCAC", title: "Describe", desc: "Tell our AI what you want to build in plain English" },
              { num: "2", emoji: "\u26A1", title: "Generate", desc: "AI creates your full application with database, API, and UI" },
              { num: "3", emoji: "\uD83D\uDE80", title: "Deploy", desc: "One click to go live. Download as an app or list on marketplace" },
            ].map(({ num, emoji, title, desc }) => (
              <div key={num} className="group relative rounded-2xl border border-gray-100 bg-white p-8 text-center transition hover:border-pink-200 hover:shadow-lg hover:shadow-pink-500/5">
                <div
                  className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold text-white relative z-10"
                  style={{ backgroundColor: "#ec4899" }}
                >
                  {num}
                </div>
                <div className="text-3xl mb-3">{emoji}</div>
                <h3 className="text-lg font-bold">{title}</h3>
                <p className="mt-2 text-sm text-gray-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ──────────────── FEATURES GRID ──────────────── */}
      <section id="features" data-animate className={`py-24 bg-gray-50/50 ${fadeIn("features")}`}>
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center mb-16">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Features</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
              Everything you need to ship
            </h2>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { emoji: "\uD83E\uDD16", title: "AI-Powered", desc: "Describe in words, get working software" },
              { emoji: "\uD83D\uDCCA", title: "Real Database", desc: "Every app gets its own PostgreSQL database" },
              { emoji: "\uD83C\uDFA8", title: "Visual Editor", desc: "Customize your app visually after generation" },
              { emoji: "\uD83D\uDCF1", title: "Mobile Ready", desc: "Every app works on desktop, tablet, and phone" },
              { emoji: "\uD83C\uDFEA", title: "Marketplace", desc: "List your apps for others to buy and download" },
              { emoji: "\u2601\uFE0F", title: "Cloud IDE", desc: "See your code being generated in real-time" },
            ].map(({ emoji, title, desc }) => (
              <div
                key={title}
                className="group rounded-2xl border border-gray-200 bg-white p-6 transition hover:border-pink-200 hover:shadow-lg hover:shadow-pink-500/5"
              >
                <div className="text-3xl mb-4">{emoji}</div>
                <h3 className="text-base font-bold">{title}</h3>
                <p className="mt-1 text-sm text-gray-500">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ──────────────── PRICING ──────────────── */}
      <section id="pricing" data-animate className={`py-24 ${fadeIn("pricing")}`}>
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center mb-16">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Pricing</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
              Simple, transparent pricing
            </h2>
            <p className="mt-4 text-gray-500">Start free. Upgrade when you're ready.</p>
          </div>

          <div className="grid gap-8 md:grid-cols-3 max-w-5xl mx-auto">
            {[
              {
                name: "Free",
                price: "$0",
                period: "/mo",
                features: ["3 builds per month", "1 project", "Community support", "Shared hosting"],
                cta: "Get Started",
                popular: false,
              },
              {
                name: "Pro",
                price: "$29",
                period: "/mo",
                features: ["Unlimited builds", "Unlimited projects", "Priority support", "Custom domains", "Analytics dashboard"],
                cta: "Start Pro Trial",
                popular: true,
              },
              {
                name: "Teams",
                price: "$79",
                period: "/mo",
                features: ["Everything in Pro", "Team collaboration", "White label", "API access", "Dedicated support"],
                cta: "Contact Sales",
                popular: false,
              },
            ].map(({ name, price, period, features, cta, popular }) => (
              <div
                key={name}
                className={`relative rounded-2xl p-8 transition hover:shadow-lg ${
                  popular
                    ? "border-2 shadow-lg shadow-pink-500/10"
                    : "border border-gray-200"
                }`}
                style={popular ? { borderColor: "#ec4899" } : {}}
              >
                {popular && (
                  <span
                    className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-4 py-1 text-xs font-bold text-white"
                    style={{ backgroundColor: "#ec4899" }}
                  >
                    POPULAR
                  </span>
                )}
                <h3 className="text-lg font-bold">{name}</h3>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold">{price}</span>
                  <span className="text-gray-400">{period}</span>
                </div>
                <ul className="mt-6 space-y-3">
                  {features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                      <span style={{ color: "#ec4899" }}>&#10003;</span> {f}
                    </li>
                  ))}
                </ul>
                <Link
                  to="/signup"
                  className={`mt-8 block w-full rounded-xl py-3 text-center text-sm font-semibold transition ${
                    popular
                      ? "text-white hover:brightness-110"
                      : "border-2 border-black text-black hover:bg-black hover:text-white"
                  }`}
                  style={popular ? { backgroundColor: "#ec4899" } : {}}
                >
                  {cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ──────────────── HOW IT COMPARES ──────────────── */}
      <section id="compare" data-animate className={`py-24 bg-gray-50/50 ${fadeIn("compare")}`}>
        <div className="mx-auto max-w-5xl px-6">
          <div className="text-center mb-16">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Comparison</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
              How isibi.ai compares
            </h2>
            <p className="mt-4 text-gray-500">See why builders choose us over the alternatives.</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  <th className="text-left py-4 px-4 font-semibold text-gray-500 border-b border-gray-200 w-1/5" />
                  <th className="py-4 px-4 font-bold border-b-2 text-center w-1/5" style={{ borderColor: "#ec4899", color: "#ec4899", backgroundColor: "rgba(236,72,153,0.04)" }}>
                    isibi.ai
                  </th>
                  <th className="py-4 px-4 font-semibold text-gray-500 border-b border-gray-200 text-center w-1/5">Lovable</th>
                  <th className="py-4 px-4 font-semibold text-gray-500 border-b border-gray-200 text-center w-1/5">Bubble</th>
                  <th className="py-4 px-4 font-semibold text-gray-500 border-b border-gray-200 text-center w-1/5">Retool</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { feature: "AI-Powered", isibi: true, lovable: true, bubble: false, retool: false },
                  { feature: "No Code Required", isibi: true, lovable: true, bubble: true, retool: false },
                  { feature: "Custom Database", isibi: true, lovable: false, bubble: true, retool: true },
                  { feature: "Deploy Instantly", isibi: true, lovable: true, bubble: false, retool: false },
                  { feature: "App Marketplace", isibi: true, lovable: false, bubble: true, retool: false },
                  { feature: "Starts Free", isibi: true, lovable: false, bubble: false, retool: false },
                ].map(({ feature, isibi, lovable, bubble, retool }, i) => (
                  <tr key={feature} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}>
                    <td className="py-3 px-4 font-medium text-gray-700 border-b border-gray-100">{feature}</td>
                    <td className="py-3 px-4 text-center border-b border-gray-100" style={{ backgroundColor: "rgba(236,72,153,0.04)" }}>
                      {isibi ? <span className="text-lg" style={{ color: "#ec4899" }}>&#10003;</span> : <span className="text-gray-300">&mdash;</span>}
                    </td>
                    <td className="py-3 px-4 text-center border-b border-gray-100">
                      {lovable ? <span className="text-green-500">&#10003;</span> : <span className="text-gray-300">&mdash;</span>}
                    </td>
                    <td className="py-3 px-4 text-center border-b border-gray-100">
                      {bubble ? <span className="text-green-500">&#10003;</span> : <span className="text-gray-300">&mdash;</span>}
                    </td>
                    <td className="py-3 px-4 text-center border-b border-gray-100">
                      {retool ? <span className="text-green-500">&#10003;</span> : <span className="text-gray-300">&mdash;</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ──────────────── TESTIMONIALS ──────────────── */}
      <section id="testimonials" data-animate className={`py-24 bg-gray-50/50 ${fadeIn("testimonials")}`}>
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center mb-16">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Testimonials</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
              Loved by builders
            </h2>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            {[
              {
                quote: "I described my SaaS idea in two paragraphs and had a working product with a database, auth, and payments in under 10 minutes. This is genuinely the future.",
                name: "Sarah Chen",
                role: "Founder",
                company: "DataFlow",
              },
              {
                quote: "We used to spend 3 months on MVPs. Now our team prototypes in an afternoon. The AI understands complex business logic and gets it right the first time.",
                name: "Marcus Rodriguez",
                role: "CTO",
                company: "ScaleUp",
              },
              {
                quote: "As a non-technical founder, I was stuck paying agencies $50k for basic apps. isibi.ai let me build exactly what I envisioned, and I can iterate on it myself.",
                name: "Priya Patel",
                role: "CEO",
                company: "LaunchPad",
              },
            ].map(({ quote, name, role, company }) => (
              <div
                key={name}
                className="rounded-2xl border border-gray-200 bg-white p-8 transition hover:shadow-lg hover:border-pink-200"
              >
                {/* Stars */}
                <div className="flex gap-0.5 mb-4">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <span key={star} className="text-yellow-400 text-lg">&#9733;</span>
                  ))}
                </div>
                <p className="text-sm text-gray-600 leading-relaxed italic">"{quote}"</p>
                <div className="mt-6 flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white"
                    style={{ backgroundColor: "#ec4899" }}
                  >
                    {name[0]}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{name}</p>
                    <p className="text-xs text-gray-400">{role}, {company}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ──────────────── CTA SECTION ──────────────── */}
      <section id="cta" data-animate className={`py-24 ${fadeIn("cta")}`}>
        <div className="mx-auto max-w-4xl px-6 text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-5xl">
            Ready to build?
          </h2>
          <p className="mx-auto mt-4 max-w-md text-gray-500">
            No credit card required. Start building in 30 seconds.
          </p>
          <div className="mt-10">
            <Link
              to="/signup"
              className="inline-block rounded-xl px-12 py-4 text-base font-semibold text-white shadow-lg transition hover:shadow-xl hover:brightness-110"
              style={{ backgroundColor: "#ec4899" }}
            >
              Start Building — Free
            </Link>
          </div>
        </div>
      </section>

      {/* ──────────────── FAQ ──────────────── */}
      <section id="faq" data-animate className={`py-24 bg-gray-50/50 ${fadeIn("faq")}`}>
        <div className="mx-auto max-w-3xl px-6">
          <div className="text-center mb-12">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">FAQ</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              Frequently asked questions
            </h2>
          </div>

          <div className="space-y-3">
            {[
              {
                q: "What can I build with isibi.ai?",
                a: "Anything from CRMs and project management tools to restaurant management systems, inventory trackers, HR platforms, and more. If you can describe it, our AI can build it — complete with database, API, and user interface.",
              },
              {
                q: "Do I need to know how to code?",
                a: "No! Just describe what you want in plain English. Our AI handles all the technical details — database design, API endpoints, UI components, and deployment. You can always dive into the code later if you want to customize.",
              },
              {
                q: "How much does it cost?",
                a: "Free for up to 3 builds per month with shared hosting. Our Pro plan at $29/mo gives you unlimited builds, custom domains, and priority support. Teams plan at $79/mo adds collaboration, white-label, and API access.",
              },
              {
                q: "Can I download my app?",
                a: "Yes! You can download your entire generated codebase as a ZIP file or export it as a standalone project. Each app is a fully functional application you can host anywhere.",
              },
              {
                q: "Is my data secure?",
                a: "Yes, each app gets its own isolated PostgreSQL database. We use industry-standard encryption for data in transit and at rest. Your source code and data are private and never shared with other users.",
              },
              {
                q: "Can I collaborate with my team?",
                a: "Absolutely! With our Teams plan, you can invite collaborators to edit projects in real-time, share project links, and manage permissions. Each team member gets their own workspace.",
              },
            ].map((item, i) => (
              <div
                key={i}
                className="rounded-xl border border-gray-200 bg-white overflow-hidden transition hover:border-gray-300"
              >
                <button
                  onClick={() => setFaqOpen(faqOpen === i ? null : i)}
                  className="flex w-full items-center justify-between px-6 py-4 text-left"
                >
                  <span className="text-sm font-semibold text-black pr-4">{item.q}</span>
                  <svg
                    className={`h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 ${
                      faqOpen === i ? "rotate-180" : ""
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <div
                  className={`overflow-hidden transition-all duration-300 ${
                    faqOpen === i ? "max-h-60 pb-4" : "max-h-0"
                  }`}
                >
                  <p className="px-6 text-sm leading-relaxed text-gray-500">{item.a}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ──────────────── FOOTER ──────────────── */}
      <footer className="border-t border-gray-200 bg-white py-16">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid gap-8 sm:grid-cols-2 md:grid-cols-4">
            <div>
              <h4 className="text-sm font-bold mb-4">Product</h4>
              <ul className="space-y-2">
                {[
                  { label: "Features", href: "#features" },
                  { label: "Pricing", href: "#pricing" },
                  { label: "Marketplace", href: "/marketplace" },
                  { label: "Templates", href: "/templates" },
                ].map((item) => (
                  <li key={item.label}>
                    {item.href.startsWith("#") ? (
                      <button
                        onClick={() => document.getElementById(item.href.slice(1))?.scrollIntoView({ behavior: "smooth" })}
                        className="text-sm text-gray-500 transition hover:text-black"
                      >
                        {item.label}
                      </button>
                    ) : (
                      <Link to={item.href} className="text-sm text-gray-500 transition hover:text-black">{item.label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-bold mb-4">Company</h4>
              <ul className="space-y-2">
                {[
                  { label: "About", href: "/about" },
                  { label: "Blog", href: "/blog" },
                  { label: "Careers", href: "/careers" },
                  { label: "Contact", href: "/contact" },
                ].map((item) => (
                  <li key={item.label}>
                    <Link to={item.href} className="text-sm text-gray-500 transition hover:text-black">{item.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-bold mb-4">Legal</h4>
              <ul className="space-y-2">
                {[
                  { label: "Terms", href: "/terms" },
                  { label: "Privacy", href: "/privacy" },
                  { label: "Security", href: "/security" },
                ].map((item) => (
                  <li key={item.label}>
                    <Link to={item.href} className="text-sm text-gray-500 transition hover:text-black">{item.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-bold mb-4">Connect</h4>
              <ul className="space-y-2">
                {[
                  { label: "GitHub", href: "https://github.com/canias7/isibi-ai" },
                  { label: "Email", href: "mailto:support@isibi.ai" },
                ].map((item) => (
                  <li key={item.label}>
                    <a href={item.href} target={item.href.startsWith("http") ? "_blank" : undefined} rel={item.href.startsWith("http") ? "noopener noreferrer" : undefined} className="text-sm text-gray-500 transition hover:text-black">{item.label}</a>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-gray-100 pt-8 sm:flex-row">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold">isibi<span className="text-gray-400">.ai</span></span>
              <span className="text-xs text-gray-400">&mdash; Build anything.</span>
            </div>
            <p className="text-xs text-gray-400">&copy; 2026 isibi.ai. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
