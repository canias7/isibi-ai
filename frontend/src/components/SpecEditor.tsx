/**
 * SpecEditor — side-by-side JSON editor + mini preview.
 * Left panel: syntax-highlighted JSON textarea with line numbers.
 * Right panel: mini spec preview showing sidebar + current page.
 * Includes Apply, Format, Reset, and tree-view toggle.
 */
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  Check,
  AlertTriangle,
  RotateCcw,
  AlignLeft,
  ChevronRight,
  ChevronDown,
  FileText,
  Box,
  Layers,
} from "lucide-react";

interface SpecEditorProps {
  spec: any;
  onSpecUpdate: (spec: any) => void;
}

type EditorMode = "raw" | "tree";

/* ── Syntax highlighting ── */
function highlightJSON(json: string): string {
  // Escape HTML first
  const escaped = json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped
    // Strings (keys are handled separately)
    .replace(
      /("(?:\\.|[^"\\])*")\s*:/g,
      '<span style="color:#ec4899">$1</span>:'
    )
    .replace(
      /:\s*("(?:\\.|[^"\\])*")/g,
      ': <span style="color:#10b981">$1</span>'
    )
    // Numbers
    .replace(
      /:\s*(-?\d+\.?\d*(?:[eE][+-]?\d+)?)/g,
      ': <span style="color:#3b82f6">$1</span>'
    )
    // Booleans and null
    .replace(
      /:\s*(true|false|null)\b/g,
      ': <span style="color:#f59e0b">$1</span>'
    )
    // Standalone strings in arrays
    .replace(
      /(?<=[\[,]\s*)("(?:\\.|[^"\\])*")(?=\s*[,\]])/g,
      '<span style="color:#10b981">$1</span>'
    );
}

/* ── Error line parser ── */
function getErrorLine(error: string, json: string): number | null {
  // Try to extract position from SyntaxError
  const posMatch = error.match(/position\s+(\d+)/i);
  if (posMatch) {
    const pos = parseInt(posMatch[1], 10);
    const upToPos = json.substring(0, pos);
    return (upToPos.match(/\n/g) || []).length + 1;
  }
  const lineMatch = error.match(/line\s+(\d+)/i);
  if (lineMatch) return parseInt(lineMatch[1], 10);
  return null;
}

/* ── Tree view component ── */
function TreeNode({
  label,
  value,
  depth,
  path,
}: {
  label: string;
  value: any;
  depth: number;
  path: string;
}) {
  const [expanded, setExpanded] = useState(depth < 2);

  const isObject = value !== null && typeof value === "object";
  const isArray = Array.isArray(value);

  if (!isObject) {
    return (
      <div
        className="flex items-center gap-1.5 py-0.5"
        style={{ paddingLeft: depth * 16 }}
      >
        <span className="text-xs text-pink-600 font-medium">{label}:</span>
        <span
          className={`text-xs ${
            typeof value === "string"
              ? "text-green-600"
              : typeof value === "number"
              ? "text-blue-600"
              : typeof value === "boolean"
              ? "text-amber-600"
              : "text-gray-400"
          }`}
        >
          {typeof value === "string" ? `"${value}"` : String(value)}
        </span>
      </div>
    );
  }

  const entries = isArray
    ? value.map((v: any, i: number) => [String(i), v] as [string, any])
    : Object.entries(value);

  const preview = isArray
    ? `[${value.length} items]`
    : `{${Object.keys(value).length} keys}`;

  return (
    <div>
      <div
        className="flex cursor-pointer items-center gap-1 rounded py-0.5 hover:bg-gray-50 transition"
        style={{ paddingLeft: depth * 16 }}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-gray-400 flex-shrink-0" />
        )}
        <span className="text-xs font-medium text-pink-600">{label}</span>
        {!expanded && (
          <span className="text-[10px] text-gray-400 ml-1">{preview}</span>
        )}
      </div>
      {expanded && (
        <div>
          {entries.map(([key, val]: [string, any]) => (
            <TreeNode
              key={`${path}.${key}`}
              label={isArray ? (val?.name || val?.label || `[${key}]`) : key}
              value={val}
              depth={depth + 1}
              path={`${path}.${key}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Mini preview sidebar ── */
function MiniPreview({ spec }: { spec: any }) {
  const [activePage, setActivePage] = useState(0);
  const modules = spec?.modules || [];

  const pages = useMemo(() => {
    const list: { name: string; entityCount: number; icon: string }[] = [];
    list.push({ name: "Dashboard", entityCount: 0, icon: "dashboard" });
    for (const mod of modules) {
      for (const entity of mod.entities || []) {
        list.push({
          name: entity.name + "s",
          entityCount: entity.fields?.length || 0,
          icon: "entity",
        });
      }
    }
    return list;
  }, [modules]);

  const primaryColor = spec?.theme?.primary_color || "#ec4899";

  return (
    <div className="flex h-full bg-white rounded-lg border border-gray-200 overflow-hidden">
      {/* Mini sidebar */}
      <div className="w-40 border-r border-gray-100 bg-gray-50/50 flex flex-col">
        <div className="border-b border-gray-100 px-3 py-2.5">
          <p className="text-[11px] font-semibold text-black truncate">
            {spec?.app_name || "App"}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
          {pages.map((page, i) => (
            <button
              key={i}
              onClick={() => setActivePage(i)}
              className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[10px] transition ${
                activePage === i
                  ? "font-medium text-white"
                  : "text-gray-500 hover:bg-gray-100 hover:text-black"
              }`}
              style={
                activePage === i
                  ? { backgroundColor: primaryColor }
                  : undefined
              }
            >
              {page.icon === "dashboard" ? (
                <Layers className="h-3 w-3 flex-shrink-0" />
              ) : (
                <Box className="h-3 w-3 flex-shrink-0" />
              )}
              {page.name}
            </button>
          ))}
        </div>
      </div>

      {/* Mini content area */}
      <div className="flex-1 p-3 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-black">
            {pages[activePage]?.name || "Page"}
          </h3>
          <div
            className="rounded px-2 py-0.5 text-[9px] font-medium text-white"
            style={{ backgroundColor: primaryColor }}
          >
            + Add
          </div>
        </div>
        {activePage === 0 ? (
          // Dashboard preview
          <div className="grid grid-cols-2 gap-2">
            {pages.slice(1, 5).map((p, i) => (
              <div
                key={i}
                className="rounded-lg border border-gray-100 bg-gray-50 p-2"
              >
                <p className="text-[9px] text-gray-400">{p.name}</p>
                <p className="mt-0.5 text-sm font-bold text-black">
                  {Math.floor(Math.random() * 100) + 10}
                </p>
              </div>
            ))}
          </div>
        ) : (
          // Table preview
          <div className="rounded-lg border border-gray-100">
            <div className="border-b border-gray-100 bg-gray-50/80 px-2 py-1.5">
              <div className="flex gap-4">
                {(
                  modules
                    .flatMap((m: any) => m.entities || [])
                    .find(
                      (e: any) =>
                        e.name + "s" === pages[activePage]?.name
                    )
                    ?.fields?.filter(
                      (f: any) =>
                        f.show_in_table !== false &&
                        !["id", "org_id", "deleted_at", "version", "created_at", "updated_at"].includes(f.name)
                    )
                    ?.slice(0, 4) || []
                ).map((f: any, i: number) => (
                  <span
                    key={i}
                    className="text-[8px] font-medium text-gray-400 uppercase"
                  >
                    {f.label || f.name}
                  </span>
                ))}
              </div>
            </div>
            {[1, 2, 3].map((row) => (
              <div
                key={row}
                className="border-b border-gray-50 px-2 py-1.5 last:border-0"
              >
                <div className="flex gap-4">
                  {[1, 2, 3, 4].map((col) => (
                    <div
                      key={col}
                      className="h-2 rounded bg-gray-100"
                      style={{ width: 30 + Math.random() * 40 }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════ */

export function SpecEditor({ spec, onSpecUpdate }: SpecEditorProps) {
  const [jsonText, setJsonText] = useState(() =>
    JSON.stringify(spec, null, 2)
  );
  const [originalJson] = useState(() => JSON.stringify(spec, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [errorLine, setErrorLine] = useState<number | null>(null);
  const [applied, setApplied] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("raw");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumberRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);

  // Sync scroll between textarea, line numbers, and highlight overlay
  const handleScroll = useCallback(() => {
    if (textareaRef.current && lineNumberRef.current && highlightRef.current) {
      lineNumberRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  const lineCount = useMemo(
    () => jsonText.split("\n").length,
    [jsonText]
  );

  const highlighted = useMemo(() => highlightJSON(jsonText), [jsonText]);

  // Parse the current tree spec for tree view
  const treeSpec = useMemo(() => {
    try {
      return JSON.parse(jsonText);
    } catch {
      return spec;
    }
  }, [jsonText, spec]);

  const handleApply = useCallback(() => {
    try {
      const parsed = JSON.parse(jsonText);
      // Basic validation
      if (!parsed.app_name && !parsed.modules) {
        setError("Spec must have at least app_name or modules");
        return;
      }
      setError(null);
      setErrorLine(null);
      onSpecUpdate(parsed);
      setApplied(true);
      setTimeout(() => setApplied(false), 2000);
    } catch (e: any) {
      const msg = e.message || "Invalid JSON";
      setError(msg);
      setErrorLine(getErrorLine(msg, jsonText));
    }
  }, [jsonText, onSpecUpdate]);

  const handleFormat = useCallback(() => {
    try {
      const parsed = JSON.parse(jsonText);
      setJsonText(JSON.stringify(parsed, null, 2));
      setError(null);
      setErrorLine(null);
    } catch (e: any) {
      setError(e.message || "Cannot format: invalid JSON");
      setErrorLine(getErrorLine(e.message, jsonText));
    }
  }, [jsonText]);

  const handleReset = useCallback(() => {
    setJsonText(originalJson);
    setError(null);
    setErrorLine(null);
  }, [originalJson]);

  return (
    <div className="flex h-full w-full flex-col bg-white">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setEditorMode("raw")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              editorMode === "raw"
                ? "bg-gray-100 text-black"
                : "text-gray-500 hover:text-black"
            }`}
          >
            <span className="flex items-center gap-1">
              <FileText className="h-3 w-3" />
              Raw JSON
            </span>
          </button>
          <button
            onClick={() => setEditorMode("tree")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              editorMode === "tree"
                ? "bg-gray-100 text-black"
                : "text-gray-500 hover:text-black"
            }`}
          >
            <span className="flex items-center gap-1">
              <Layers className="h-3 w-3" />
              Tree View
            </span>
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleFormat}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-gray-500 transition hover:bg-gray-100 hover:text-black"
          >
            <AlignLeft className="h-3 w-3" />
            Format
          </button>
          <button
            onClick={handleReset}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-gray-500 transition hover:bg-gray-100 hover:text-black"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
          <button
            onClick={handleApply}
            className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white transition ${
              applied
                ? "bg-green-500"
                : "bg-pink-500 hover:bg-pink-600"
            }`}
          >
            <Check className="h-3 w-3" />
            {applied ? "Applied!" : "Apply Changes"}
          </button>
        </div>
      </div>

      {/* Error bar */}
      {error && (
        <div className="flex items-center gap-2 border-b border-red-100 bg-red-50 px-4 py-2">
          <AlertTriangle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
          <p className="text-xs text-red-600 truncate">
            {error}
            {errorLine && (
              <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium">
                Line {errorLine}
              </span>
            )}
          </p>
        </div>
      )}

      {/* Editor content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel - editor */}
        <div className="flex flex-1 flex-col border-r border-gray-200">
          {editorMode === "raw" ? (
            <div className="relative flex flex-1 overflow-hidden bg-gray-950">
              {/* Line numbers */}
              <div
                ref={lineNumberRef}
                className="flex-shrink-0 select-none overflow-hidden border-r border-gray-800 bg-gray-950 px-3 py-3 text-right"
                style={{ width: 48 }}
              >
                {Array.from({ length: lineCount }, (_, i) => (
                  <div
                    key={i}
                    className={`text-[11px] leading-[20px] font-mono ${
                      errorLine === i + 1
                        ? "text-red-400 font-bold"
                        : "text-gray-600"
                    }`}
                  >
                    {i + 1}
                  </div>
                ))}
              </div>
              {/* Highlight overlay + textarea */}
              <div className="relative flex-1 overflow-hidden">
                <pre
                  ref={highlightRef}
                  className="pointer-events-none absolute inset-0 overflow-auto whitespace-pre p-3 font-mono text-[12px] leading-[20px] text-transparent"
                  aria-hidden="true"
                  dangerouslySetInnerHTML={{ __html: highlighted }}
                />
                <textarea
                  ref={textareaRef}
                  value={jsonText}
                  onChange={(e) => {
                    setJsonText(e.target.value);
                    setError(null);
                    setErrorLine(null);
                  }}
                  onScroll={handleScroll}
                  className="absolute inset-0 h-full w-full resize-none bg-transparent p-3 font-mono text-[12px] leading-[20px] text-gray-300 caret-pink-400 outline-none"
                  style={{ color: "rgba(255,255,255,0.85)" }}
                  spellCheck={false}
                />
              </div>
            </div>
          ) : (
            // Tree view
            <div className="flex-1 overflow-auto p-3 bg-white">
              {Object.entries(treeSpec).map(([key, value]) => (
                <TreeNode
                  key={key}
                  label={key}
                  value={value}
                  depth={0}
                  path={key}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right panel - mini preview */}
        <div className="w-80 flex-shrink-0 overflow-hidden bg-gray-50 p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Mini Preview
          </p>
          <div className="h-[calc(100%-24px)]">
            <MiniPreview spec={treeSpec} />
          </div>
        </div>
      </div>
    </div>
  );
}
