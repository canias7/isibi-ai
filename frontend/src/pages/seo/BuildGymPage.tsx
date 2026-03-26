import { Link } from "react-router-dom";

export function BuildGymPage() {
  return (
    <div className="min-h-screen bg-white text-black">
      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-24 pb-16 text-center">
        <div className="text-5xl mb-6">
          <span role="img" aria-label="gym">&#x1F3CB;&#xFE0F;</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold mb-4">
          Build Gym Management Software
        </h1>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto mb-8">
          Describe your gym or fitness studio and let isibi.ai generate a
          complete management platform with memberships, class scheduling,
          check-ins, and billing.
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
          Everything your gym needs to thrive
        </h2>
        <div className="grid md:grid-cols-2 gap-6">
          {[
            {
              icon: "\u{1F4B3}",
              title: "Membership Management",
              desc: "Manage plans, pricing tiers, and recurring billing. Handle trials, freezes, and cancellations.",
            },
            {
              icon: "\u{1F4C5}",
              title: "Class & Schedule Management",
              desc: "Create class schedules, manage instructor assignments, and let members book spots online.",
            },
            {
              icon: "\u{2705}",
              title: "Check-in & Attendance",
              desc: "Track member check-ins, monitor attendance trends, and identify at-risk members automatically.",
            },
            {
              icon: "\u{1F4CA}",
              title: "Reports & Growth Metrics",
              desc: "Revenue tracking, member retention analytics, class popularity reports, and growth forecasts.",
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
                desc: "Tell us about your gym: size, class types, membership tiers, and the tools you need.",
              },
              {
                step: "2",
                title: "Preview",
                desc: "See your management platform generated instantly. Customize every feature to fit your workflow.",
              },
              {
                step: "3",
                title: "Deploy",
                desc: "Go live and start managing your gym digitally. Members can sign up and book classes online.",
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
          Power your gym with custom software
        </h2>
        <p className="text-gray-600 mb-8">
          Stop paying for overpriced gym software. Build exactly what you need with AI.
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

export default BuildGymPage;
