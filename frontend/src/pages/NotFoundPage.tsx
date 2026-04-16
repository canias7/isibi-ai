import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="animate-fade-in text-center">
        <h1 className="text-8xl font-bold text-pink-500">404</h1>
        <h2 className="mt-4 text-2xl font-semibold text-black">Page not found</h2>
        <p className="mt-2 max-w-md text-gray-500">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            to="/"
            className="rounded-lg bg-pink-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-pink-600"
          >
            Go Home
          </Link>
          <Link
            to="/app"
            className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-black transition hover:bg-gray-50"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
