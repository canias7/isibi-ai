import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";

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

          {/* Animated mockup */}
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
                    <div className="rounded-lg bg-white border border-gray-100 px-3 py-2 text-xs text-gray-600 shadow-sm">
                      Build me a project management app with kanban boards
                    </div>
                    <div className="rounded-lg px-3 py-2 text-xs text-white" style={{ backgroundColor: "#ec4899" }}>
                      <p className="font-medium">Building your app...</p>
                      <p className="mt-1 opacity-80">Creating database schema, API endpoints, and UI components</p>
                    </div>
                    <div className="space-y-2">
                      {["Database tables created", "API routes generated", "UI components built", "Deploying..."].map((item, i) => (
                        <div key={item} className="flex items-center gap-2 text-xs text-gray-500" style={{ animation: `fadeSlideIn 0.5s ease ${i * 0.3 + 1}s both` }}>
                          <span className="text-green-500">&#10003;</span> {item}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                {/* Preview side */}
                <div className="w-3/5 p-4 sm:p-6">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Live Preview</span>
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-medium text-green-700 bg-green-50 border border-green-200">Live</span>
                  </div>
                  {/* Fake kanban */}
                  <div className="grid grid-cols-3 gap-2">
                    {["To Do", "In Progress", "Done"].map((col) => (
                      <div key={col} className="rounded-lg bg-gray-50 p-2">
                        <p className="text-[10px] font-semibold text-gray-500 mb-2">{col}</p>
                        {[1, 2].map((card) => (
                          <div key={card} className="mb-1.5 rounded bg-white p-2 shadow-sm border border-gray-100">
                            <div className="h-1.5 rounded-full bg-gray-200 w-full mb-1" />
                            <div className="h-1.5 rounded-full bg-gray-100 w-3/4" />
                          </div>
                        ))}
                      </div>
                    ))}
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
