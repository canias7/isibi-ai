import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Zap, Shield, Globe, Code, Layers, Cpu, ChevronDown } from "lucide-react";

// Animated counter hook
function useCounter(end: number, duration = 2000, start = 0) {
  const [count, setCount] = useState(start);
  const [started, setStarted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setStarted(true); },
      { threshold: 0.5 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!started) return;
    let startTime: number;
    const animate = (time: number) => {
      if (!startTime) startTime = time;
      const progress = Math.min((time - startTime) / duration, 1);
      setCount(Math.floor(start + (end - start) * progress));
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [started, end, duration, start]);

  return { count, ref };
}

// Floating orb component
function Orb({ className }: { className: string }) {
  return <div className={`absolute rounded-full blur-3xl opacity-20 animate-pulse ${className}`} />;
}

export function LandingPage() {
  const [scrollY, setScrollY] = useState(0);
  const [visibleSections, setVisibleSections] = useState<Set<string>>(new Set());

  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Intersection observer for fade-in animations
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisibleSections((prev) => new Set([...prev, entry.target.id]));
          }
        });
      },
      { threshold: 0.15 }
    );
    document.querySelectorAll("[data-animate]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const stat1 = useCounter(10, 1500);
  const stat2 = useCounter(99, 2000);
  const stat3 = useCounter(50, 1800);

  const isVisible = (id: string) => visibleSections.has(id);

  return (
    <div className="min-h-screen bg-white text-black overflow-x-hidden">
      {/* ─── Floating background orbs ─── */}
      <Orb className="h-[600px] w-[600px] bg-violet-400 -top-40 -left-40" />
      <Orb className="h-[500px] w-[500px] bg-blue-400 top-[30%] -right-40" />
      <Orb className="h-[400px] w-[400px] bg-amber-300 top-[60%] left-[10%]" />

      {/* ─── Nav ─── */}
      <nav className="fixed top-0 z-50 w-full">
        <div
          className="transition-all duration-300"
          style={{
            backgroundColor: scrollY > 50 ? "rgba(255,255,255,0.85)" : "transparent",
            backdropFilter: scrollY > 50 ? "blur(20px)" : "none",
            borderBottom: scrollY > 50 ? "1px solid rgba(0,0,0,0.06)" : "1px solid transparent",
          }}
        >
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Link to="/" className="text-xl font-bold tracking-tight">
              isibi<span className="text-gray-400">.ai</span>
            </Link>
            <div className="hidden items-center gap-8 md:flex">
              <a href="#features" className="text-sm text-gray-500 transition hover:text-black">Features</a>
              <a href="#how" className="text-sm text-gray-500 transition hover:text-black">How it works</a>
              <a href="#models" className="text-sm text-gray-500 transition hover:text-black">Models</a>
            </div>
            <div className="flex items-center gap-3">
              <Link
                to="/login"
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 transition hover:text-black"
              >
                Sign in
              </Link>
              <Link
                to="/signup"
                className="rounded-lg bg-black px-5 py-2 text-sm font-medium text-white transition hover:bg-gray-800"
              >
                Get started
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* ─── Hero ─── */}
      <section className="relative flex min-h-screen flex-col items-center justify-center px-6 pt-20">
        {/* Subtle grid background */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(rgba(0,0,0,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.3) 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
          }}
        />

        <div className="relative z-10 mx-auto max-w-4xl text-center">
          {/* Pill badge */}
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white/60 px-4 py-1.5 text-xs font-medium text-gray-600 backdrop-blur-sm">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
            </span>
            Now in public beta
          </div>

          <h1
            className="text-5xl font-extrabold leading-[1.1] tracking-tight sm:text-7xl md:text-8xl"
            style={{ transform: `translateY(${scrollY * 0.1}px)`, opacity: 1 - scrollY * 0.002 }}
          >
            Build anything.
            <br />
            <span className="bg-gradient-to-r from-gray-900 via-gray-600 to-gray-400 bg-clip-text text-transparent">
              Ship instantly.
            </span>
          </h1>

          <p
            className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-gray-500 sm:text-xl"
            style={{ transform: `translateY(${scrollY * 0.05}px)`, opacity: 1 - scrollY * 0.0015 }}
          >
            Describe your software in plain English. Our AI builds, deploys, and hosts it —
            full-stack, production-ready, in seconds.
          </p>

          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              to="/signup"
              className="group flex items-center gap-2 rounded-xl bg-black px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-black/10 transition hover:bg-gray-800 hover:shadow-xl hover:shadow-black/15"
            >
              Start building for free
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a
              href="#how"
              className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white/50 px-8 py-3.5 text-sm font-semibold text-gray-700 backdrop-blur-sm transition hover:border-gray-300 hover:bg-white"
            >
              See how it works
            </a>
          </div>

          {/* Trust bar */}
          <div className="mt-16 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-xs text-gray-400">
            <span className="flex items-center gap-1.5"><Shield className="h-3.5 w-3.5" /> SOC 2 Compliant</span>
            <span className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" /> Global CDN</span>
            <span className="flex items-center gap-1.5"><Zap className="h-3.5 w-3.5" /> 99.9% Uptime</span>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 animate-bounce">
          <ChevronDown className="h-5 w-5 text-gray-300" />
        </div>
      </section>

      {/* ─── Demo preview ─── */}
      <section
        id="demo"
        data-animate
        className={`relative mx-auto -mt-12 max-w-5xl px-6 transition-all duration-1000 ${
          isVisible("demo") ? "translate-y-0 opacity-100" : "translate-y-12 opacity-0"
        }`}
      >
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 shadow-2xl shadow-black/5">
          {/* Fake browser chrome */}
          <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-100 px-4 py-3">
            <span className="h-3 w-3 rounded-full bg-red-400" />
            <span className="h-3 w-3 rounded-full bg-yellow-400" />
            <span className="h-3 w-3 rounded-full bg-green-400" />
            <div className="ml-4 flex-1 rounded-md bg-white px-3 py-1 text-xs text-gray-400">
              isibi.ai
            </div>
          </div>
          {/* Chat mockup */}
          <div className="p-8">
            <div className="space-y-6">
              {/* User message */}
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-bold">
                  Y
                </div>
                <div className="rounded-2xl rounded-tl-md bg-gray-100 px-4 py-3">
                  <p className="text-sm text-gray-700">Build me a CRM for my real estate business with lead tracking, deal pipeline, and automated follow-ups</p>
                </div>
              </div>
              {/* AI response */}
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black text-xs font-bold text-white">
                  A
                </div>
                <div className="rounded-2xl rounded-tl-md border border-gray-100 bg-white px-4 py-3 shadow-sm">
                  <p className="text-sm text-gray-700">
                    Your CRM is ready. I built it with 4 modules: Lead Management, Deal Pipeline, Task Automation, and Analytics Dashboard.
                    The backend is deployed, database is live, and your custom domain is configured.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <span className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">Backend live</span>
                    <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">Database ready</span>
                    <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700">UI deployed</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Stats ─── */}
      <section className="py-24">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-12 px-6 sm:gap-20">
          <div ref={stat1.ref} className="text-center">
            <p className="text-4xl font-extrabold tracking-tight sm:text-5xl">{stat1.count}x</p>
            <p className="mt-1 text-sm text-gray-500">Faster than coding</p>
          </div>
          <div ref={stat2.ref} className="text-center">
            <p className="text-4xl font-extrabold tracking-tight sm:text-5xl">{stat2.count}%</p>
            <p className="mt-1 text-sm text-gray-500">Uptime SLA</p>
          </div>
          <div ref={stat3.ref} className="text-center">
            <p className="text-4xl font-extrabold tracking-tight sm:text-5xl">{stat3.count}K+</p>
            <p className="mt-1 text-sm text-gray-500">Apps deployed</p>
          </div>
        </div>
      </section>

      {/* ─── Features ─── */}
      <section id="features" data-animate className={`py-24 transition-all duration-1000 ${isVisible("features") ? "translate-y-0 opacity-100" : "translate-y-12 opacity-0"}`}>
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Why isibi</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              Everything you need. Nothing you don't.
            </h2>
          </div>

          <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: Zap, title: "Instant deployment", desc: "Your app goes live the moment it's built. No CI/CD pipelines, no DevOps." },
              { icon: Code, title: "Full-stack generation", desc: "Backend, database, API, and frontend — all generated from a single prompt." },
              { icon: Shield, title: "Enterprise security", desc: "SOC 2 compliant. Multi-tenant isolation. Row-level security on every table." },
              { icon: Layers, title: "Marketplace ecosystem", desc: "Sell what you build. Buy what others built. A thriving ecosystem of apps." },
              { icon: Globe, title: "Custom domains", desc: "Every app gets a custom domain with automatic SSL. Your brand, everywhere." },
              { icon: Cpu, title: "4 specialized models", desc: "Anias for software, Ambar for websites, Mario for apps, Claw for agents." },
            ].map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="group rounded-2xl border border-gray-100 bg-white p-6 transition hover:border-gray-200 hover:shadow-lg hover:shadow-black/5"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-50 transition group-hover:bg-black group-hover:text-white">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-base font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-500">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── How it works ─── */}
      <section id="how" data-animate className={`bg-gray-50 py-24 transition-all duration-1000 ${isVisible("how") ? "translate-y-0 opacity-100" : "translate-y-12 opacity-0"}`}>
        <div className="mx-auto max-w-4xl px-6">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">How it works</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Three steps. Zero friction.</h2>
          </div>

          <div className="mt-16 space-y-0">
            {[
              { num: "01", title: "Describe", desc: "Tell us what you want in plain English. Be as detailed or as vague as you like — our AI fills in the gaps." },
              { num: "02", title: "Generate", desc: "Our specialized models build your full-stack application: database schema, API, business logic, and UI." },
              { num: "03", title: "Ship", desc: "Your app is deployed instantly. Share it, sell it on the marketplace, or download it to your computer." },
            ].map(({ num, title, desc }, i) => (
              <div key={num} className="flex gap-6 py-8">
                <div className="flex flex-col items-center">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-black text-sm font-bold text-white">
                    {num}
                  </div>
                  {i < 2 && <div className="mt-2 h-full w-px bg-gray-200" />}
                </div>
                <div className="pb-2">
                  <h3 className="text-lg font-semibold">{title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-gray-500">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Models ─── */}
      <section id="models" data-animate className={`py-24 transition-all duration-1000 ${isVisible("models") ? "translate-y-0 opacity-100" : "translate-y-12 opacity-0"}`}>
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Our models</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              Four minds. One platform.
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-sm text-gray-500">
              Each model is purpose-built for its domain, trained on millions of production codebases.
            </p>
          </div>

          <div className="mt-16 grid gap-6 sm:grid-cols-2">
            {[
              {
                name: "Anias 1.0",
                role: "Software builder",
                desc: "Full-stack SaaS applications. CRMs, dashboards, internal tools, data platforms.",
                gradient: "from-violet-500 to-purple-600",
              },
              {
                name: "Ambar 1.0",
                role: "Website builder",
                desc: "Marketing sites, landing pages, portfolios, e-commerce storefronts.",
                gradient: "from-blue-500 to-cyan-500",
              },
              {
                name: "Mario 1.0",
                role: "App builder",
                desc: "Mobile-first applications. Progressive web apps, cross-platform experiences.",
                gradient: "from-amber-500 to-orange-500",
              },
              {
                name: "Claw 1.0",
                role: "Agent builder",
                desc: "AI agents, chatbots, workflow automations, intelligent pipelines.",
                gradient: "from-emerald-500 to-teal-500",
              },
            ].map(({ name, role, desc, gradient }) => (
              <div
                key={name}
                className="group relative overflow-hidden rounded-2xl border border-gray-100 bg-white p-8 transition hover:border-gray-200 hover:shadow-xl hover:shadow-black/5"
              >
                <div className={`absolute -right-8 -top-8 h-32 w-32 rounded-full bg-gradient-to-br ${gradient} opacity-10 transition group-hover:opacity-20`} />
                <div className="relative">
                  <div className={`inline-flex h-3 w-3 rounded-full bg-gradient-to-r ${gradient}`} />
                  <h3 className="mt-4 text-xl font-bold">{name}</h3>
                  <p className="mt-1 text-xs font-medium uppercase tracking-wider text-gray-400">{role}</p>
                  <p className="mt-3 text-sm leading-relaxed text-gray-500">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className="py-24">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-5xl">
            Stop building software.
            <br />
            <span className="text-gray-400">Start shipping it.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-md text-sm text-gray-500">
            Join thousands of developers and entrepreneurs who build production software in minutes, not months.
          </p>
          <div className="mt-10">
            <Link
              to="/signup"
              className="group inline-flex items-center gap-2 rounded-xl bg-black px-10 py-4 text-sm font-semibold text-white shadow-lg shadow-black/10 transition hover:bg-gray-800 hover:shadow-xl"
            >
              Get started — it's free
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="border-t border-gray-100 py-12">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-6 sm:flex-row">
          <div className="flex items-center gap-6">
            <span className="text-sm font-semibold">isibi<span className="text-gray-400">.ai</span></span>
            <span className="text-xs text-gray-400">The future of software development.</span>
          </div>
          <div className="flex gap-6 text-xs text-gray-400">
            <a href="#" className="transition hover:text-black">Privacy</a>
            <a href="#" className="transition hover:text-black">Terms</a>
            <a href="#" className="transition hover:text-black">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
