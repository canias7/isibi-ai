import { useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { Turnstile } from "react-turnstile";
import { post } from "@/api/client";
import { useAuthStore } from "@/stores/authStore";

const TURNSTILE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || "1x00000000000000000000AA"; // test key fallback

interface Props {
  onLogin: () => void;
  onNeedVerify: (email: string) => void;
}

export function LoginPage({ onLogin, onNeedVerify }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileKey, setTurnstileKey] = useState(0);
  const { setAuth } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setError(null);
    setLoading(true);

    try {
      const res = await post<{ access_token: string; user: any }>("/auth/login", {
        email,
        password,
        turnstile_token: turnstileToken || "dev",
      });
      setAuth(res.access_token, res.user);
      onLogin();
    } catch (err: any) {
      const detail = err?.detail || "Login failed.";
      if (detail.includes("not verified")) {
        onNeedVerify(email);
        return;
      }
      setError(detail);
      setTurnstileKey((k) => k + 1);
      setTurnstileToken("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-black">isibi.ai</h1>
          <p className="mt-1 text-sm text-gray-500">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-black placeholder-gray-400 focus:border-black focus:outline-none"
              placeholder="you@example.com"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Password</label>
            <div className="relative">
              <input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 pr-10 text-sm text-black placeholder-gray-400 focus:border-black focus:outline-none"
                placeholder="••••••••"
                required
                minLength={8}
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="flex justify-end">
            <Link to="/forgot-password" className="text-xs text-gray-500 hover:text-black">
              Forgot password?
            </Link>
          </div>

          <div className="flex justify-center">
            <Turnstile
              key={turnstileKey}
              sitekey={TURNSTILE_KEY}
              onSuccess={setTurnstileToken}
              onError={() => setTurnstileToken("")}
              onExpire={() => setTurnstileToken("")}
              theme="light"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-black px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Sign in
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          Don't have an account?{" "}
          <Link to="/signup" className="font-medium text-black hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
