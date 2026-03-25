import { useState, useRef, useEffect } from "react";
import { Loader2, Mail } from "lucide-react";
import { post } from "@/api/client";
import { useAuthStore } from "@/stores/authStore";

interface Props {
  email: string;
  onVerified: () => void;
}

export function VerifyEmailPage({ email, onVerified }: Props) {
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const { setAuth } = useAuthStore();

  // Countdown timer for resend
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const handleChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...digits];
    next[index] = value.slice(-1);
    setDigits(next);

    // Auto-advance
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 filled
    if (next.every((d) => d !== "")) {
      submitCode(next.join(""));
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (text.length === 6) {
      const next = text.split("");
      setDigits(next);
      inputRefs.current[5]?.focus();
      submitCode(text);
    }
  };

  const submitCode = async (code: string) => {
    setError(null);
    setLoading(true);
    try {
      const res = await post<{ access_token?: string; user?: any }>("/auth/verify-email", { email, code });
      if (res.access_token && res.user) {
        setAuth(res.access_token, res.user);
      }
      onVerified();
    } catch (err: any) {
      setError(err?.detail || "Verification failed.");
      setDigits(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    try {
      await post("/auth/resend-code", { email });
      setResendCooldown(60);
      setError(null);
    } catch {
      setError("Failed to resend code.");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
          <Mail className="h-6 w-6 text-gray-600" />
        </div>

        <h1 className="text-xl font-bold text-black">Check your email</h1>
        <p className="mt-2 text-sm text-gray-500">
          We sent a 6-digit code to{" "}
          <span className="font-medium text-black">{email}</span>
        </p>

        {/* OTP inputs */}
        <div className="mt-8 flex justify-center gap-2">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => { inputRefs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={d}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              onPaste={i === 0 ? handlePaste : undefined}
              disabled={loading}
              className="h-14 w-12 rounded-xl border border-gray-200 bg-white text-center text-2xl font-bold text-black transition focus:border-black focus:outline-none disabled:opacity-50"
            />
          ))}
        </div>

        {loading && (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Verifying...
          </div>
        )}

        {error && (
          <div className="mx-auto mt-4 max-w-xs rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
            {error}
          </div>
        )}

        <div className="mt-8">
          <p className="text-sm text-gray-500">
            Didn't receive a code?{" "}
            <button
              onClick={handleResend}
              disabled={resendCooldown > 0}
              className="font-medium text-black hover:underline disabled:text-gray-400 disabled:no-underline"
            >
              {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
