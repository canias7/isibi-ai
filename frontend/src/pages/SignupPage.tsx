import { useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Turnstile } from "react-turnstile";
import { post } from "@/api/client";
import { useAuthStore, type AuthUser } from "@/stores/authStore";

interface ApiError {
  status: number;
  detail: string;
}

interface SignupForm {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
}

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
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileKey, setTurnstileKey] = useState(0);
  const { setAuth } = useAuthStore();

  const set = (key: keyof SignupForm, val: string) => setForm((f) => ({ ...f, [key]: val }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Frontend password validation
    const pw = form.password;
    if (pw.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (!/[A-Z]/.test(pw)) { setError("Password must contain at least one uppercase letter."); return; }
    if (!/[0-9]/.test(pw)) { setError("Password must contain at least one digit."); return; }
    if (!/[!@#$%^&*()_+\-=\[\]{}|;:'",.<>?/~`]/.test(pw)) { setError("Password must contain at least one special character."); return; }

    setLoading(true);

    try {
      const res = await post<{ access_token: string; user: AuthUser }>("/auth/signup", {
        email: form.email,
        password: form.password,
        first_name: form.first_name,
        last_name: form.last_name,
        account_type: "developer",
        turnstile_token: turnstileToken || "dev",
      });
      setAuth(res.access_token, res.user);
      onSignup(form.email);
    } catch (err: unknown) {
      setError((err as ApiError)?.detail || "Signup failed.");
      setTurnstileKey((k) => k + 1);
      setTurnstileToken("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-white">
      {/* Back to home */}
      <Link
        to="/"
        className="absolute left-6 top-6 z-10 flex items-center gap-1.5 text-sm text-gray-500 hover:text-black transition"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to home
      </Link>

      {/* Left branding panel */}
      <div
        className="hidden lg:flex lg:w-1/2 flex-col justify-center items-center px-12 py-16 relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, #ec4899 0%, #db2777 50%, #be185d 100%)" }}
      >
        <div className="relative z-10 max-w-md text-white">
          <h1 className="text-4xl font-bold tracking-tight">isibi.ai</h1>
          <p className="mt-3 text-xl font-medium text-white/90">Join 10,000+ builders</p>
          <p className="mt-6 text-sm text-white/70 leading-relaxed">
            Create an account and start building production-ready software in minutes.
          </p>

          <div className="mt-10 space-y-5">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/20">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium">Ship Faster Than Ever</p>
                <p className="mt-0.5 text-xs text-white/60">Go from idea to deployed app in under 10 minutes</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/20">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium">Earn on the Marketplace</p>
                <p className="mt-0.5 text-xs text-white/60">Publish your apps and earn revenue from every download</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/20">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium">No Code Required</p>
                <p className="mt-0.5 text-xs text-white/60">Our AI handles the technical details so you can focus on your vision</p>
              </div>
            </div>
          </div>
        </div>

        {/* Decorative circles */}
        <div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-white/5" />
        <div className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-white/5" />
        <div className="absolute bottom-20 right-10 h-24 w-24 rounded-full bg-white/10" />
      </div>

      {/* Right form panel */}
      <div className="flex w-full flex-col items-center justify-center px-6 py-12 lg:w-1/2">
        {/* Mobile branding header */}
        <div className="mb-8 text-center lg:hidden">
          <div
            className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium"
            style={{ background: "linear-gradient(135deg, #ec4899, #db2777)", color: "#fff" }}
          >
            isibi.ai
          </div>
          <p className="mt-2 text-sm text-gray-500">Join 10,000+ builders</p>
        </div>

        <div className="w-full max-w-md">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-black">Create your account</h2>
            <p className="mt-1 text-sm text-gray-500">Get started for free. No credit card required.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="signup-first-name" className="mb-1.5 block text-sm font-medium text-gray-700">First name</label>
                <input
                  id="signup-first-name"
                  value={form.first_name}
                  onChange={(e) => set("first_name", e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-black placeholder-gray-500 transition focus:border-pink-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-pink-500/20"
                  placeholder="John"
                  required
                  aria-required="true"
                />
              </div>
              <div>
                <label htmlFor="signup-last-name" className="mb-1.5 block text-sm font-medium text-gray-700">Last name</label>
                <input
                  id="signup-last-name"
                  value={form.last_name}
                  onChange={(e) => set("last_name", e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-black placeholder-gray-500 transition focus:border-pink-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-pink-500/20"
                  placeholder="Doe"
                  required
                  aria-required="true"
                />
              </div>
            </div>

            <div>
              <label htmlFor="signup-email" className="mb-1.5 block text-sm font-medium text-gray-700">Email address</label>
              <input
                id="signup-email"
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-black placeholder-gray-500 transition focus:border-pink-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-pink-500/20"
                placeholder="you@example.com"
                required
                aria-required="true"
              />
            </div>

            <div>
              <label htmlFor="signup-password" className="mb-1.5 block text-sm font-medium text-gray-700">Password</label>
              <input
                id="signup-password"
                type="password"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-black placeholder-gray-500 transition focus:border-pink-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-pink-500/20"
                placeholder="8+ chars, uppercase, number, special"
                minLength={8}
                required
                aria-required="true"
              />
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
              <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: "#ec4899" }}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create Account
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-3 text-gray-400">or continue with</span>
            </div>
          </div>

          {/* Social buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => alert("Coming soon")}
              className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 hover:border-gray-300"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Google
            </button>
            <button
              type="button"
              onClick={() => alert("Coming soon")}
              className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 hover:border-gray-300"
            >
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              GitHub
            </button>
          </div>

          <p className="mt-8 text-center text-sm text-gray-500">
            Already have an account?{" "}
            <Link to="/login" className="font-semibold hover:underline" style={{ color: "#ec4899" }}>
              Log in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
