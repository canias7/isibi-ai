import { Link } from "react-router-dom";

const posts = [
  {
    title: "How AI Is Changing App Development",
    date: "March 15, 2026",
    excerpt:
      "The days of writing every line of code by hand are numbered. AI-powered tools are making it possible for anyone to build production-ready software by simply describing what they need. Here is how the landscape is shifting.",
    slug: "#",
  },
  {
    title: "Building Your First App in 60 Seconds",
    date: "February 28, 2026",
    excerpt:
      "We timed it. From typing a description to having a working app with a database, API, and UI -- it takes less than a minute on isibi.ai. Follow along as we build a task manager from scratch.",
    slug: "#",
  },
  {
    title: "Voice-Control Your Business Software",
    date: "February 10, 2026",
    excerpt:
      "What if you could talk to your CRM? With isibi.ai's voice command feature, you can add records, run reports, and navigate your app entirely hands-free. Here is how it works under the hood.",
    slug: "#",
  },
  {
    title: "From Spreadsheet to Full App",
    date: "January 22, 2026",
    excerpt:
      "Spreadsheets are great until they are not. Learn how to take your messy Google Sheet and turn it into a real application with user roles, validation, and a proper database -- in minutes.",
    slug: "#",
  },
];

export function BlogPage() {
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
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Blog</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-400">
          Ideas, tutorials, and updates from the isibi.ai team.
        </p>
      </section>

      {/* Posts */}
      <section className="mx-auto max-w-3xl px-6 pb-24">
        <div className="space-y-8">
          {posts.map((post) => (
            <article
              key={post.title}
              className="rounded-2xl border border-white/10 bg-white/5 p-6 transition hover:border-pink-500/30 hover:bg-white/[0.07] sm:p-8"
            >
              <time className="text-sm text-gray-500">{post.date}</time>
              <h2 className="mt-2 text-xl font-bold sm:text-2xl">{post.title}</h2>
              <p className="mt-3 text-gray-400 leading-relaxed">{post.excerpt}</p>
              <span className="mt-4 inline-block text-sm font-medium text-pink-400">
                Read more &rarr;
              </span>
            </article>
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
