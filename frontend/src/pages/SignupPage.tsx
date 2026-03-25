import { useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { Turnstile } from "react-turnstile";
import { post } from "@/api/client";
import { useAuthStore } from "@/stores/authStore";

const TURNSTILE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || "1x00000000000000000000AA";

interface Props {
  onSignup: (email: string) => void;
}

export function SignupPage({ onSignup }: Props) {
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    password: "",
    confirm: "",
    account_type: "user" as "user" | "developer",
  });
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileKey, setTurnstileKey] = useState(0);
  const { setAuth } = useAuthStore();

  const set = (key: string, val: string) => setForm((f) => ({ ...f, [key]: val }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (form.password !== form.confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    try {
      const res = await post<{ access_token: string; user: any }>("/auth/signup", {
        email: form.email,
        password: form.password,
        first_name: form.first_name,
        last_name: form.last_name,
        account_type: form.account_type,
        turnstile_token: turnstileToken || "dev",
      });
      setAuth(res.access_token, res.user);
      onSignup(form.email);
    } catch (err: any) {
      setError(err?.detail || "Signup failed.");
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
          <p className="mt-1 text-sm text-gray-500">Create your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">First name</label>
              <input
                value={form.first_name}
                onChange={(e) => set("first_name", e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-black placeholder-gray-400 focus:border-black focus:outline-none"
                placeholder="John"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Last name</label>
              <input
                value={form.last_name}
                onChange={(e) => set("last_name", e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-black placeholder-gray-400 focus:border-black focus:outline-none"
                placeholder="Doe"
                required
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
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
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 pr-10 text-sm text-black placeholder-gray-400 focus:border-black focus:outline-none"
                placeholder="Min. 8 characters"
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

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Confirm password</label>
            <input
              type="password"
              value={form.confirm}
              onChange={(e) => set("confirm", e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-black placeholder-gray-400 focus:border-black focus:outline-none"
              placeholder="••••••••"
              required
              minLength={8}
            />
          </div>

          {/* Account type */}
          <div>
            <label className="mb-2 block text-xs font-medium text-gray-700">Account type</label>
            <div className="grid grid-cols-2 gap-2">
              {(["user", "developer"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => set("account_type", t)}
                  className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition ${
                    form.account_type === t
                      ? "border-black bg-black text-white"
                      : "border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}
                >
                  {t === "user" ? "User" : "Developer"}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-gray-400">
              {form.account_type === "developer"
                ? "Build & publish to the marketplace."
                : "Use apps and download from marketplace."}
            </p>
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
            Create account
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-black hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
