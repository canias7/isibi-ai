import { useState, useRef, useEffect } from "react";
import { ArrowUp, Loader2, ChevronDown, Check, User, Settings, CreditCard, HelpCircle, LogOut } from "lucide-react";
import { post } from "@/api/client";

interface Props {
  onSpecCreated: () => void;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

const MODELS = [
  { id: "anias-1.0", label: "Anias 1.0", description: "Software builder" },
  { id: "ambar-1.0", label: "Ambar 1.0", description: "Website builder" },
  { id: "mario-1.0", label: "Mario 1.0", description: "App builder" },
  { id: "claw-1.0", label: "Claw 1.0", description: "Agent builder" },
];

export function OnboardingPage({ onSpecCreated }: Props) {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState(MODELS[0]);
  const [modelOpen, setModelOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setModelOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
    }
  }, [prompt]);

  const handleSubmit = async () => {
    if (!prompt.trim() || loading) return;
    const userMsg = prompt.trim();
    setPrompt("");
    setError(null);
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);

    try {
      await post("/projects", { prompt: userMsg });
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Your app is ready. Loading it now..." },
      ]);
      setTimeout(() => onSpecCreated(), 1000);
    } catch (err: any) {
      const detail = err?.detail || "Something went wrong. Please try again.";
      setMessages((prev) => [...prev, { role: "assistant", content: detail }]);
      setError(detail);
      setLoading(false);
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="flex min-h-screen flex-col bg-white">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setModelOpen(!modelOpen)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-black transition hover:bg-gray-100"
          >
            {selectedModel.label}
            <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
          </button>
          {modelOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 min-w-[220px] rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
              {MODELS.map((model) => (
                <button
                  key={model.id}
                  onClick={() => {
                    setSelectedModel(model);
                    setModelOpen(false);
                  }}
                  className="flex w-full items-center justify-between px-3 py-2.5 text-left transition hover:bg-gray-50"
                >
                  <div>
                    <p className="text-sm font-medium text-black">{model.label}</p>
                    <p className="text-xs text-gray-400">{model.description}</p>
                  </div>
                  {selectedModel.id === model.id && (
                    <Check className="h-4 w-4 shrink-0 text-black" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Profile menu */}
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => setProfileOpen(!profileOpen)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 transition hover:bg-gray-200"
          >
            <User className="h-4 w-4 text-gray-600" />
          </button>
          {profileOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-[220px] rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
              <div className="border-b border-gray-100 px-3 py-2">
                <p className="text-sm font-medium text-black">My Account</p>
                <p className="text-xs text-gray-400">user@isibi.ai</p>
              </div>
              <button className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-50">
                <Settings className="h-4 w-4" />
                Settings
              </button>
              <button className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-50">
                <CreditCard className="h-4 w-4" />
                Billing
              </button>
              <button className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-50">
                <HelpCircle className="h-4 w-4" />
                Help & FAQ
              </button>
              <div className="border-t border-gray-100 mt-1 pt-1">
                <button className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-red-500 transition hover:bg-gray-50">
                  <LogOut className="h-4 w-4" />
                  Log out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div className="flex flex-1 flex-col items-center overflow-y-auto">
        <div className="w-full max-w-3xl flex-1 px-4">
          {isEmpty ? (
            <div className="flex h-full flex-col items-center justify-center pb-32">
              <h1 className="text-2xl font-semibold text-black">
                What do you want to build?
              </h1>
            </div>
          ) : (
            <div className="space-y-6 py-6">
              {messages.map((msg, i) => (
                <div key={i} className="flex gap-4">
                  {/* Avatar */}
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                      msg.role === "user"
                        ? "bg-gray-200 text-black"
                        : "bg-black text-white"
                    }`}
                  >
                    {msg.role === "user" ? "Y" : "A"}
                  </div>
                  {/* Content */}
                  <div className="min-w-0 pt-1">
                    <p className="text-sm font-medium text-black">
                      {msg.role === "user" ? "You" : "Anias"}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-gray-700 whitespace-pre-wrap">
                      {msg.content}
                    </p>
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex gap-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black text-xs font-medium text-white">
                    A
                  </div>
                  <div className="pt-1">
                    <p className="text-sm font-medium text-black">Anias</p>
                    <div className="mt-2 flex items-center gap-1">
                      <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Input area — pinned to bottom */}
      <div className="sticky bottom-0 bg-white px-4 pb-6 pt-2">
        <div className="mx-auto w-full max-w-3xl">
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe what you want to build..."
              className="w-full resize-none bg-transparent px-4 pt-4 pb-2 text-sm text-black placeholder-gray-400 focus:outline-none"
              rows={1}
              disabled={loading}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
            <div className="flex items-center justify-end px-3 pb-2">
              <button
                onClick={handleSubmit}
                disabled={!prompt.trim() || loading}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-black text-white transition hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
          <p className="mt-2 text-center text-xs text-gray-400">
            Anias can make mistakes. Review generated apps before use.
          </p>
        </div>
      </div>
    </div>
  );
}
