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
    <div className="flex min-h-screen flex-col items-center justify-center bg-white px-4">
      <div className="w-full max-w-2xl">
        {/* Logo / Brand */}
        <div className="mb-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-black">
            <Sparkles className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-black">
            What do you want to build?
          </h1>
          <p className="mt-3 text-gray-500">
            Describe your app and we'll generate it for you — CRM, inventory system,
            project tracker, or anything else.
          </p>
        </div>

        {/* Prompt input */}
        <div className="rounded-2xl border border-gray-200 bg-white p-1.5 shadow-sm">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Build me a CRM for real estate with lead tracking, deal pipeline, and task management..."
            className="w-full resize-none rounded-xl bg-transparent px-4 py-4 text-black placeholder-gray-400 focus:outline-none"
            rows={4}
            disabled={loading}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.metaKey) handleSubmit();
            }}
          />
          <div className="flex items-center justify-between px-2 pb-1">
            <span className="text-xs text-gray-400">
              {loading ? "Generating your app..." : "Cmd+Enter to submit"}
            </span>
            <button
              onClick={handleSubmit}
              disabled={!prompt.trim() || loading}
              className="flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
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
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
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
              className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-left text-sm text-gray-500 transition hover:border-gray-300 hover:text-black"
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
