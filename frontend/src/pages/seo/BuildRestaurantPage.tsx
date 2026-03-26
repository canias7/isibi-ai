import { Link } from "react-router-dom";

export function BuildRestaurantPage() {
  return (
    <div className="min-h-screen bg-white text-black">
      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-24 pb-16 text-center">
        <div className="text-5xl mb-6">
          <span role="img" aria-label="restaurant">&#x1F37D;&#xFE0F;</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold mb-4">
          Build Restaurant Management Software
        </h1>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto mb-8">
          Describe your restaurant operations and let isibi.ai generate a
          complete management system with reservations, menu management, orders,
          and staff scheduling.
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
          Run your restaurant smarter
        </h2>
        <div className="grid md:grid-cols-2 gap-6">
          {[
            {
              icon: "\u{1F4C5}",
              title: "Reservations & Table Management",
              desc: "Online booking system with table layout, capacity tracking, and waitlist management.",
            },
            {
              icon: "\u{1F4DC}",
              title: "Menu & Inventory",
              desc: "Digital menu management with pricing, allergen info, and real-time inventory tracking.",
            },
            {
              icon: "\u{1F9FE}",
              title: "Order Processing",
              desc: "Dine-in, takeout, and delivery orders in one system. Kitchen display and ticket management.",
            },
            {
              icon: "\u{1F465}",
              title: "Staff & Scheduling",
              desc: "Employee scheduling, shift management, and role-based access for managers and staff.",
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
                desc: "Tell us about your restaurant type, seating, menu style, and the features you need most.",
              },
              {
                step: "2",
                title: "Preview",
                desc: "Review your generated management system. Adjust workflows, add features, and customize the look.",
              },
              {
                step: "3",
                title: "Deploy",
                desc: "Launch your system and start managing operations from day one. Access from any device.",
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
          Modernize your restaurant operations
        </h2>
        <p className="text-gray-600 mb-8">
          From table management to kitchen orders, build the system your restaurant needs with AI.
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

export default BuildRestaurantPage;
