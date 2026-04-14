import { Link } from "react-router-dom";

const positions = [
  {
    title: "Full-Stack Engineer",
    type: "Full-time / Remote",
    desc: "Build and ship features across our React front-end and FastAPI back-end. You will work on the core app builder, real-time collaboration, and deployment pipeline.",
  },
  {
    title: "AI / ML Engineer",
    type: "Full-time / Remote",
    desc: "Improve our AI generation engine. Fine-tune prompts, build evaluation pipelines, and push the boundary of what natural language can create.",
  },
  {
    title: "Product Designer",
    type: "Full-time / Remote",
    desc: "Design intuitive interfaces for a complex product. From onboarding flows to visual editors, you will shape how non-technical users interact with AI.",
  },
  {
    title: "Developer Relations",
    type: "Full-time / Remote",
    desc: "Be the bridge between isibi.ai and the developer community. Create tutorials, speak at events, and build integrations that make developers love the platform.",
  },
];

export function CareersPage() {
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
      <section className="mx-auto max-w-4xl px-6 pb-12 pt-20 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">We're hiring</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-400">
          Help us make software creation accessible to everyone. We are a small, fast-moving team building something that matters.
        </p>
      </section>

      {/* Why join */}
      <section className="mx-auto max-w-3xl px-6 pb-12">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8">
          <h2 className="mb-4 text-xl font-bold">Why isibi.ai?</h2>
          <ul className="space-y-3 text-gray-400">
            <li className="flex items-start gap-3">
              <span className="mt-1 block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-pink-400" />
              Work on a product that is genuinely changing how people build software.
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1 block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-pink-400" />
              Fully remote team -- work from anywhere in the world.
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1 block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-pink-400" />
              Competitive salary, equity, and benefits.
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1 block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-pink-400" />
              Small team means high impact and fast decisions.
            </li>
          </ul>
        </div>
      </section>

      {/* Positions */}
      <section className="mx-auto max-w-3xl px-6 pb-24">
        <h2 className="mb-6 text-2xl font-bold">Open positions</h2>
        <div className="space-y-4">
          {positions.map((p) => (
            <div
              key={p.title}
              className="rounded-2xl border border-white/10 bg-white/5 p-6 transition hover:border-pink-500/30 hover:bg-white/[0.07]"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-lg font-semibold">{p.title}</h3>
                  <span className="text-sm text-gray-500">{p.type}</span>
                </div>
                <a
                  href="mailto:careers@isibi.ai"
                  className="inline-block rounded-lg bg-pink-500 px-5 py-2 text-center text-sm font-medium text-white transition hover:bg-pink-600"
                >
                  Apply
                </a>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-gray-400">{p.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-8 text-center text-sm text-gray-600">
        &copy; {new Date().getFullYear()} isibi.ai. All rights reserved.
      </footer>
    </div>
  );
}
