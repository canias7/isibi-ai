import { Link } from "react-router-dom";

const stack = [
  { name: "Claude AI", desc: "Anthropic's Claude powers intelligent app generation and natural-language understanding." },
  { name: "React", desc: "Every generated front-end uses React with Tailwind CSS for fast, responsive interfaces." },
  { name: "FastAPI", desc: "Our backend runs on Python's FastAPI for high-performance async API handling." },
  { name: "PostgreSQL", desc: "Production-grade relational database with isolated schemas for every app." },
];

const values = [
  {
    title: "Accessible",
    desc: "Software creation should not require a CS degree. If you can describe it, you can build it.",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
      </svg>
    ),
  },
  {
    title: "Fast",
    desc: "Go from idea to working app in under 60 seconds. No boilerplate, no config, no waiting.",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
      </svg>
    ),
  },
  {
    title: "Secure",
    desc: "Enterprise-grade security baked in from day one: encrypted data, isolated schemas, and more.",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.572-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
      </svg>
    ),
  },
  {
    title: "Open",
    desc: "Your apps, your data. Export anything, integrate everything, leave anytime.",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
      </svg>
    ),
  },
];

export function AboutPage() {
  return (
    <div className="min-h-screen bg-black text-white" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Nav */}
      <nav className="border-b border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-xl font-bold tracking-tight">
            isibi<span className="text-gray-500">.ai</span>
          </Link>
          <Link
            to="/signup"
            className="rounded-lg bg-pink-500 px-5 py-2 text-sm font-medium text-white transition hover:bg-pink-600"
          >
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-4xl px-6 pb-16 pt-20 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Building the future of<br />software creation
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-gray-400">
          isibi.ai is an AI-powered no-code platform that turns plain-language descriptions into fully functional applications. Our mission is to <span className="text-white font-medium">democratize software creation</span> so that anyone -- regardless of technical background -- can bring their ideas to life.
        </p>
      </section>

      {/* Mission */}
      <section className="mx-auto max-w-5xl px-6 pb-20">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 sm:p-12">
          <h2 className="mb-4 text-2xl font-bold">Our mission</h2>
          <p className="text-gray-400 leading-relaxed">
            Every day, millions of people have ideas for software that could transform their businesses, communities, or lives. Most of those ideas never get built because coding is hard and hiring developers is expensive. We believe that describing what you need should be enough to get a working app. isibi.ai bridges the gap between imagination and implementation using artificial intelligence.
          </p>
        </div>
      </section>

      {/* Values */}
      <section className="mx-auto max-w-5xl px-6 pb-20">
        <h2 className="mb-8 text-center text-2xl font-bold">What we stand for</h2>
        <div className="grid gap-6 sm:grid-cols-2">
          {values.map((v) => (
            <div key={v.title} className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-pink-500/10 text-pink-400">
                {v.icon}
              </div>
              <h3 className="mb-1 text-lg font-semibold">{v.title}</h3>
              <p className="text-sm leading-relaxed text-gray-400">{v.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Tech stack */}
      <section className="mx-auto max-w-5xl px-6 pb-24">
        <h2 className="mb-8 text-center text-2xl font-bold">Built with</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stack.map((s) => (
            <div key={s.name} className="rounded-2xl border border-white/10 bg-white/5 p-5 text-center">
              <h3 className="mb-2 font-semibold text-pink-400">{s.name}</h3>
              <p className="text-sm text-gray-400">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-white/10 py-16 text-center">
        <h2 className="text-2xl font-bold">Try it yourself</h2>
        <p className="mt-2 text-gray-400">Describe what you need and watch it come to life.</p>
        <Link
          to="/signup"
          className="mt-6 inline-block rounded-lg bg-pink-500 px-8 py-3 text-sm font-medium text-white transition hover:bg-pink-600"
        >
          Get Started Free
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-8 text-center text-sm text-gray-600">
        &copy; {new Date().getFullYear()} isibi.ai. All rights reserved.
      </footer>
    </div>
  );
}
