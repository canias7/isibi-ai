import { Link } from "react-router-dom";

export function BuildCrmPage() {
  return (
    <div className="min-h-screen bg-white text-black">
      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-24 pb-16 text-center">
        <div className="text-5xl mb-6">
          <span role="img" aria-label="handshake">&#x1F91D;</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold mb-4">
          Build a CRM with AI
        </h1>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto mb-8">
          Describe your ideal customer relationship management system and let
          isibi.ai generate it in minutes. No coding required. Full control over
          every feature.
        </p>
        <Link
          to="/signup"
          className="inline-block bg-black text-white px-8 py-3 rounded-lg font-medium hover:bg-gray-800 transition-colors"
        >
          Start Building Free
        </Link>
      </section>

      {/* Features */}
      <section className="max-w-4xl mx-auto px-6 py-16">
        <h2 className="text-2xl font-bold mb-8 text-center">
          Everything you need in a CRM
        </h2>
        <div className="grid md:grid-cols-2 gap-6">
          {[
            {
              icon: "\u{1F4CB}",
              title: "Contact & Lead Management",
              desc: "Track contacts, companies, and leads with custom fields. Import existing data via CSV in one click.",
            },
            {
              icon: "\u{1F4C8}",
              title: "Sales Pipeline",
              desc: "Visual deal pipelines with drag-and-drop stages. Forecast revenue and track win rates automatically.",
            },
            {
              icon: "\u{1F4E7}",
              title: "Communication Tracking",
              desc: "Log emails, calls, and meetings. Keep a complete timeline of every customer interaction.",
            },
            {
              icon: "\u{1F4CA}",
              title: "Reports & Dashboards",
              desc: "Real-time analytics on sales performance, team activity, and customer engagement metrics.",
            },
          ].map((f) => (
            <div key={f.title} className="border border-gray-200 rounded-lg p-6">
              <div className="text-2xl mb-3">{f.icon}</div>
              <h3 className="font-semibold text-lg mb-2">{f.title}</h3>
              <p className="text-gray-600 text-sm">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="bg-gray-50 py-16">
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-2xl font-bold mb-10 text-center">How It Works</h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: "1",
                title: "Describe",
                desc: "Tell isibi.ai what your CRM should do. Mention your industry, workflow, and key features.",
              },
              {
                step: "2",
                title: "Preview",
                desc: "Review the generated application in real time. Refine and adjust with follow-up prompts.",
              },
              {
                step: "3",
                title: "Deploy",
                desc: "Launch your CRM to the web with one click. Get a custom domain and start using it immediately.",
              },
            ].map((s) => (
              <div key={s.step} className="text-center">
                <div className="w-10 h-10 rounded-full bg-black text-white flex items-center justify-center mx-auto mb-4 font-bold">
                  {s.step}
                </div>
                <h3 className="font-semibold text-lg mb-2">{s.title}</h3>
                <p className="text-gray-600 text-sm">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Footer */}
      <section className="max-w-4xl mx-auto px-6 py-20 text-center">
        <h2 className="text-3xl font-bold mb-4">
          Ready to build your custom CRM?
        </h2>
        <p className="text-gray-600 mb-8">
          Join thousands of businesses using isibi.ai to build software without writing code.
        </p>
        <Link
          to="/signup"
          className="inline-block bg-black text-white px-8 py-3 rounded-lg font-medium hover:bg-gray-800 transition-colors"
        >
          Get Started for Free
        </Link>
      </section>
    </div>
  );
}

export default BuildCrmPage;
