import { useState } from "react";
import { Sparkles, ArrowRight, Loader2 } from "lucide-react";
import { post } from "@/api/client";

interface Props {
  onSpecCreated: () => void;
}

export function OnboardingPage({ onSpecCreated }: Props) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await post("/projects", { prompt: prompt.trim() });
      onSpecCreated();
    } catch (err: any) {
      setError(err?.detail || "Failed to generate. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-2xl">
        {/* Logo / Brand */}
        <div className="mb-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600">
            <Sparkles className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">
            What do you want to build?
          </h1>
          <p className="mt-3 text-slate-400">
            Describe your app and we'll generate it for you — CRM, inventory system,
            project tracker, or anything else.
          </p>
        </div>

        {/* Prompt input */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-1.5">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Build me a CRM for real estate with lead tracking, deal pipeline, and task management..."
            className="w-full resize-none rounded-xl bg-transparent px-4 py-4 text-white placeholder-slate-500 focus:outline-none"
            rows={4}
            disabled={loading}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.metaKey) handleSubmit();
            }}
          />
          <div className="flex items-center justify-between px-2 pb-1">
            <span className="text-xs text-slate-500">
              {loading ? "Generating your app..." : "Cmd+Enter to submit"}
            </span>
            <button
              onClick={handleSubmit}
              disabled={!prompt.trim() || loading}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  Generate
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Examples */}
        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            "Build me a CRM for real estate",
            "Inventory management for a restaurant",
            "Project tracker with team assignments",
          ].map((example) => (
            <button
              key={example}
              onClick={() => setPrompt(example)}
              disabled={loading}
              className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3 text-left text-sm text-slate-400 transition hover:border-slate-700 hover:text-slate-300"
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
