import { Link } from "react-router-dom";

export function ComingSoonPage({ title }: { title: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-pink-50">
          <span className="text-2xl">🚧</span>
        </div>
        <h1 className="text-2xl font-bold text-black">{title}</h1>
        <p className="mt-2 text-gray-500">This page is coming soon.</p>
        <Link
          to="/"
          className="mt-6 inline-block rounded-lg bg-pink-500 px-6 py-2 text-sm font-medium text-white hover:bg-pink-600"
        >
          Go Home
        </Link>
      </div>
    </div>
  );
}
