import { Link } from "react-router-dom";

export function BuildEcommercePage() {
  return (
    <div className="min-h-screen bg-white text-black">
      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-24 pb-16 text-center">
        <div className="text-5xl mb-6">
          <span role="img" aria-label="shopping cart">&#x1F6D2;</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold mb-4">
          Build an E-commerce App with AI
        </h1>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto mb-8">
          Describe your online store and let isibi.ai generate a complete
          e-commerce application with product catalog, cart, checkout, and
          order management.
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
          Full-featured e-commerce in minutes
        </h2>
        <div className="grid md:grid-cols-2 gap-6">
          {[
            {
              icon: "\u{1F4E6}",
              title: "Product Catalog",
              desc: "Manage products with images, variants, pricing, and inventory tracking. Bulk import via CSV.",
            },
            {
              icon: "\u{1F6D2}",
              title: "Shopping Cart & Checkout",
              desc: "Seamless cart experience with Stripe-powered checkout. Support for discounts and promo codes.",
            },
            {
              icon: "\u{1F4CB}",
              title: "Order Management",
              desc: "Track orders from placement to fulfillment. Automated email notifications at every stage.",
            },
            {
              icon: "\u{1F4B3}",
              title: "Payments & Analytics",
              desc: "Integrated payment processing with real-time revenue dashboards and sales analytics.",
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
                desc: "Tell us what you sell, your brand style, and what features matter most to your store.",
              },
              {
                step: "2",
                title: "Preview",
                desc: "See your store come to life instantly. Tweak the design, layout, and features in real time.",
              },
              {
                step: "3",
                title: "Deploy",
                desc: "Go live with one click. Connect your domain and start accepting orders immediately.",
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
          Launch your online store today
        </h2>
        <p className="text-gray-600 mb-8">
          No developers needed. Build, customize, and deploy your e-commerce app with AI.
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

export default BuildEcommercePage;
