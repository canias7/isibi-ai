/**
 * VisualEditor — wraps SpecPreview with click-to-edit capabilities.
 * Lets users click elements in the preview to visually edit text, colors,
 * font sizes, spacing, and border radius, then save changes back to the spec.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import {
  Pencil,
  Undo2,
  Redo2,
  Save,
  X,
  Type,
  Palette,
  RectangleHorizontal,
  Maximize,
  Circle,
} from "lucide-react";
import { SpecPreview } from "@/components/SpecPreview";
import type { AppSpec, EntitySpec } from "@/types/spec";

/** Extended spec type for visual editor -- includes runtime-only fields */
type VisualSpec = AppSpec;

interface VisualEditorProps {
  spec: VisualSpec;
  device: "desktop" | "tablet" | "mobile";
  onSpecUpdate: (spec: VisualSpec) => void;
}

interface SelectedElement {
  type:
    | "app_name"
    | "module"
    | "primary_color"
    | "stat_card"
    | "entity_title"
    | "add_button"
    | "search"
    | "sidebar_item"
    | "topbar_title"
    | "activity_title"
    | "badge"
    | "table_header";
  path: string;
  label: string;
  rect: { top: number; left: number; width: number; height: number };
  currentValue?: string;
  currentColor?: string;
  currentFontSize?: string;
}

interface EditValues {
  text: string;
  bgColor: string;
  textColor: string;
  fontSize: string;
  padding: string;
  borderRadius: string;
}

const FONT_SIZES = ["10px", "11px", "12px", "14px", "16px", "18px", "24px", "32px"];
const PADDING_PRESETS = [
  { label: "None", value: "0" },
  { label: "Small", value: "4px" },
  { label: "Medium", value: "8px" },
  { label: "Large", value: "16px" },
];
const RADIUS_PRESETS = [
  { label: "None", value: "0" },
  { label: "Small", value: "4px" },
  { label: "Medium", value: "8px" },
  { label: "Large", value: "16px" },
  { label: "Full", value: "9999px" },
];

const PRESET_COLORS = [
  "#000000", "#374151", "#6B7280", "#EF4444", "#F97316", "#EAB308",
  "#22C55E", "#14B8A6", "#3B82F6", "#6366F1", "#8B5CF6", "#EC4899",
  "#FFFFFF", "#F3F4F6", "#E5E7EB", "#FEE2E2", "#FFEDD5", "#FEF9C3",
  "#DCFCE7", "#CCFBF1", "#DBEAFE", "#E0E7FF", "#EDE9FE", "#FCE7F3",
];

export function VisualEditor({ spec, device, onSpecUpdate }: VisualEditorProps) {
  const [editMode, setEditMode] = useState(true);
  const [selected, setSelected] = useState<SelectedElement | null>(null);
  const [editValues, setEditValues] = useState<EditValues>({
    text: "",
    bgColor: "",
    textColor: "",
    fontSize: "",
    padding: "",
    borderRadius: "",
  });
  const [history, setHistory] = useState<VisualSpec[]>([spec]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<"text" | "style" | "layout">("text");

  // Push a new spec snapshot into history
  const pushHistory = useCallback(
    (newSpec: VisualSpec) => {
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(newSpec);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    },
    [history, historyIndex]
  );

  const handleUndo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      onSpecUpdate(history[newIndex]);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      onSpecUpdate(history[newIndex]);
    }
  };

  // Identify what spec element was clicked
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!editMode) return;
      e.stopPropagation();

      const overlay = overlayRef.current;
      if (!overlay) return;

      // Temporarily hide overlay to get the real element underneath
      overlay.style.pointerEvents = "none";
      const realTarget = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement;
      overlay.style.pointerEvents = "auto";

      if (!realTarget) return;

      const overlayRect = overlay.getBoundingClientRect();
      const targetRect = realTarget.getBoundingClientRect();
      const rect = {
        top: targetRect.top - overlayRect.top,
        left: targetRect.left - overlayRect.left,
        width: targetRect.width,
        height: targetRect.height,
      };

      // Walk up to find identifiable element
      let el: HTMLElement | null = realTarget;
      const text = realTarget.textContent?.trim() || "";

      // Try to identify what was clicked
      const identification = identifyElement(el, text, spec);
      if (identification) {
        const selectedEl: SelectedElement = {
          ...identification,
          rect,
        };
        setSelected(selectedEl);
        setEditValues({
          text: identification.currentValue || text,
          bgColor: identification.currentColor || spec?.design_system?.colors?.primary || "#000000",
          textColor: "",
          fontSize: identification.currentFontSize || "12px",
          padding: "8px",
          borderRadius: "8px",
        });
        setActiveTab("text");
      }
    },
    [editMode, spec]
  );

  // Close panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        overlayRef.current &&
        !overlayRef.current.contains(e.target as Node)
      ) {
        setSelected(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Apply edits to the spec
  const applyChanges = () => {
    if (!selected) return;
    const newSpec = JSON.parse(JSON.stringify(spec));

    switch (selected.type) {
      case "app_name":
        if (newSpec.app_name !== undefined) newSpec.app_name = editValues.text;
        else if (newSpec.name !== undefined) newSpec.name = editValues.text;
        break;

      case "primary_color":
        if (!newSpec.design_system) newSpec.design_system = {};
        if (!newSpec.design_system.colors) newSpec.design_system.colors = {};
        newSpec.design_system.colors.primary = editValues.bgColor;
        break;

      case "module": {
        const moduleIndex = parseInt(selected.path, 10);
        if (newSpec.modules && newSpec.modules[moduleIndex]) {
          newSpec.modules[moduleIndex].name = editValues.text;
        }
        break;
      }

      case "sidebar_item": {
        const sidebarIndex = parseInt(selected.path, 10);
        if (newSpec.modules && newSpec.modules[sidebarIndex]) {
          newSpec.modules[sidebarIndex].name = editValues.text;
        }
        break;
      }

      case "entity_title": {
        const entityName = selected.path;
        const entity = newSpec.entities?.find((e: EntitySpec) => e.name === entityName);
        if (entity) {
          entity.name = editValues.text.replace(/s$/, "");
        }
        break;
      }

      case "stat_card": {
        const cardIndex = parseInt(selected.path, 10);
        const stats = newSpec.dashboard?.stat_cards;
        if (stats && stats[cardIndex]) {
          stats[cardIndex].label = editValues.text;
        }
        break;
      }

      case "topbar_title": {
        const moduleIdx = parseInt(selected.path, 10);
        if (newSpec.modules && newSpec.modules[moduleIdx]) {
          newSpec.modules[moduleIdx].name = editValues.text;
        }
        break;
      }

      case "activity_title":
        // Activity section label -- stored in design_system for customization
        if (!newSpec.design_system) newSpec.design_system = {};
        newSpec.design_system.activity_label = editValues.text;
        break;

      case "add_button": {
        // Update the primary color used for the button
        if (!newSpec.design_system) newSpec.design_system = {};
        if (!newSpec.design_system.colors) newSpec.design_system.colors = {};
        newSpec.design_system.colors.primary = editValues.bgColor;
        break;
      }

      default:
        break;
    }

    // Apply design system-wide changes
    if (editValues.bgColor && editValues.bgColor !== spec?.design_system?.colors?.primary) {
      if (!newSpec.design_system) newSpec.design_system = {};
      if (!newSpec.design_system.colors) newSpec.design_system.colors = {};
      newSpec.design_system.colors.primary = editValues.bgColor;
    }

    pushHistory(newSpec);
    onSpecUpdate(newSpec);
    setSelected(null);
  };

  const panelPosition = selected
    ? calculatePanelPosition(selected.rect, overlayRef.current)
    : { top: 0, left: 0 };

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-3 py-1.5">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setEditMode(!editMode);
              if (!editMode) setSelected(null);
            }}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              editMode
                ? "bg-pink-50 text-pink-700 ring-1 ring-pink-200"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            <Pencil className="h-3.5 w-3.5" />
            {editMode ? "Editing" : "Edit Mode"}
          </button>
          <div className="h-4 w-px bg-gray-200" />
          <button
            onClick={handleUndo}
            disabled={historyIndex <= 0}
            className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-black disabled:opacity-30 disabled:cursor-not-allowed"
            title="Undo"
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            onClick={handleRedo}
            disabled={historyIndex >= history.length - 1}
            className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-black disabled:opacity-30 disabled:cursor-not-allowed"
            title="Redo"
          >
            <Redo2 className="h-4 w-4" />
          </button>
        </div>
        <button
          onClick={() => onSpecUpdate(spec)}
          className="flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white transition hover:bg-gray-800"
        >
          <Save className="h-3.5 w-3.5" />
          Save Changes
        </button>
      </div>

      {/* Preview with overlay */}
      <div className="relative flex-1 overflow-hidden">
        <div className="h-full overflow-auto">
          <SpecPreview spec={spec} device={device} />
        </div>

        {/* Click-capture overlay */}
        {editMode && (
          <div
            ref={overlayRef}
            className="absolute inset-0 z-10"
            style={{ cursor: "crosshair" }}
            onClick={handleOverlayClick}
          />
        )}

        {/* Selection highlight */}
        {selected && editMode && (
          <div
            className="pointer-events-none absolute z-20 rounded border-2 border-pink-500 bg-pink-500/5"
            style={{
              top: selected.rect.top,
              left: selected.rect.left,
              width: selected.rect.width,
              height: selected.rect.height,
            }}
          >
            {/* Label badge */}
            <div className="absolute -top-6 left-0 rounded bg-pink-500 px-1.5 py-0.5 text-[10px] font-medium text-white whitespace-nowrap">
              {selected.label}
            </div>
          </div>
        )}

        {/* Floating edit panel */}
        {selected && editMode && (
          <div
            ref={panelRef}
            className="absolute z-30 w-72 rounded-xl border border-gray-200 bg-white shadow-xl"
            style={{
              top: panelPosition.top,
              left: panelPosition.left,
            }}
          >
            {/* Panel header */}
            <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
              <p className="text-xs font-semibold text-black">{selected.label}</p>
              <button
                onClick={() => setSelected(null)}
                className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-black"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Tab navigation */}
            <div className="flex border-b border-gray-100">
              <button
                onClick={() => setActiveTab("text")}
                className={`flex flex-1 items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-medium transition ${
                  activeTab === "text"
                    ? "border-b-2 border-pink-500 text-pink-600"
                    : "text-gray-400 hover:text-black"
                }`}
              >
                <Type className="h-3 w-3" />
                Text
              </button>
              <button
                onClick={() => setActiveTab("style")}
                className={`flex flex-1 items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-medium transition ${
                  activeTab === "style"
                    ? "border-b-2 border-pink-500 text-pink-600"
                    : "text-gray-400 hover:text-black"
                }`}
              >
                <Palette className="h-3 w-3" />
                Style
              </button>
              <button
                onClick={() => setActiveTab("layout")}
                className={`flex flex-1 items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-medium transition ${
                  activeTab === "layout"
                    ? "border-b-2 border-pink-500 text-pink-600"
                    : "text-gray-400 hover:text-black"
                }`}
              >
                <RectangleHorizontal className="h-3 w-3" />
                Layout
              </button>
            </div>

            {/* Tab content */}
            <div className="p-3">
              {activeTab === "text" && (
                <div className="space-y-3">
                  {/* Text content */}
                  <div>
                    <label className="mb-1 block text-[10px] font-medium text-gray-500 uppercase tracking-wide">
                      Content
                    </label>
                    <input
                      type="text"
                      value={editValues.text}
                      onChange={(e) =>
                        setEditValues({ ...editValues, text: e.target.value })
                      }
                      className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-black focus:border-pink-400 focus:outline-none focus:ring-1 focus:ring-pink-400"
                    />
                  </div>

                  {/* Font size */}
                  <div>
                    <label className="mb-1 block text-[10px] font-medium text-gray-500 uppercase tracking-wide">
                      Font Size
                    </label>
                    <div className="flex flex-wrap gap-1">
                      {FONT_SIZES.map((size) => (
                        <button
                          key={size}
                          onClick={() =>
                            setEditValues({ ...editValues, fontSize: size })
                          }
                          className={`rounded-md px-2 py-1 text-[10px] font-medium transition ${
                            editValues.fontSize === size
                              ? "bg-pink-50 text-pink-700 ring-1 ring-pink-200"
                              : "bg-gray-50 text-gray-600 hover:bg-gray-100"
                          }`}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "style" && (
                <div className="space-y-3">
                  {/* Background color */}
                  <div>
                    <label className="mb-1 block text-[10px] font-medium text-gray-500 uppercase tracking-wide">
                      Primary / Background Color
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={editValues.bgColor}
                        onChange={(e) =>
                          setEditValues({ ...editValues, bgColor: e.target.value })
                        }
                        className="h-8 w-8 cursor-pointer rounded border border-gray-200"
                      />
                      <input
                        type="text"
                        value={editValues.bgColor}
                        onChange={(e) =>
                          setEditValues({ ...editValues, bgColor: e.target.value })
                        }
                        className="flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-black font-mono focus:border-pink-400 focus:outline-none focus:ring-1 focus:ring-pink-400"
                      />
                    </div>
                    <div className="mt-2 grid grid-cols-6 gap-1">
                      {PRESET_COLORS.map((color) => (
                        <button
                          key={color}
                          onClick={() =>
                            setEditValues({ ...editValues, bgColor: color })
                          }
                          className={`h-6 w-full rounded border transition hover:scale-110 ${
                            editValues.bgColor === color
                              ? "border-pink-500 ring-1 ring-pink-300"
                              : "border-gray-200"
                          }`}
                          style={{ backgroundColor: color }}
                          title={color}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Text color */}
                  <div>
                    <label className="mb-1 block text-[10px] font-medium text-gray-500 uppercase tracking-wide">
                      Text Color
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={editValues.textColor || "#000000"}
                        onChange={(e) =>
                          setEditValues({ ...editValues, textColor: e.target.value })
                        }
                        className="h-8 w-8 cursor-pointer rounded border border-gray-200"
                      />
                      <input
                        type="text"
                        value={editValues.textColor || "#000000"}
                        onChange={(e) =>
                          setEditValues({ ...editValues, textColor: e.target.value })
                        }
                        className="flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-black font-mono focus:border-pink-400 focus:outline-none focus:ring-1 focus:ring-pink-400"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "layout" && (
                <div className="space-y-3">
                  {/* Padding */}
                  <div>
                    <label className="mb-1 flex items-center gap-1 text-[10px] font-medium text-gray-500 uppercase tracking-wide">
                      <Maximize className="h-3 w-3" />
                      Padding
                    </label>
                    <div className="flex gap-1">
                      {PADDING_PRESETS.map((p) => (
                        <button
                          key={p.value}
                          onClick={() =>
                            setEditValues({ ...editValues, padding: p.value })
                          }
                          className={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-medium transition ${
                            editValues.padding === p.value
                              ? "bg-pink-50 text-pink-700 ring-1 ring-pink-200"
                              : "bg-gray-50 text-gray-600 hover:bg-gray-100"
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Border radius */}
                  <div>
                    <label className="mb-1 flex items-center gap-1 text-[10px] font-medium text-gray-500 uppercase tracking-wide">
                      <Circle className="h-3 w-3" />
                      Border Radius
                    </label>
                    <div className="flex flex-wrap gap-1">
                      {RADIUS_PRESETS.map((r) => (
                        <button
                          key={r.value}
                          onClick={() =>
                            setEditValues({ ...editValues, borderRadius: r.value })
                          }
                          className={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-medium transition ${
                            editValues.borderRadius === r.value
                              ? "bg-pink-50 text-pink-700 ring-1 ring-pink-200"
                              : "bg-gray-50 text-gray-600 hover:bg-gray-100"
                          }`}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Apply button */}
            <div className="border-t border-gray-100 px-3 py-2">
              <button
                onClick={applyChanges}
                className="w-full rounded-lg bg-pink-500 px-3 py-2 text-xs font-medium text-white transition hover:bg-pink-600"
              >
                Apply Changes
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──

function identifyElement(
  el: HTMLElement | null,
  text: string,
  spec: VisualSpec
): Omit<SelectedElement, "rect"> | null {
  if (!el || !spec) return null;

  // Walk up and gather class information
  let current: HTMLElement | null = el;
  const classChain: string[] = [];
  for (let i = 0; i < 8 && current; i++) {
    classChain.push(current.className || "");
    current = current.parentElement;
  }
  const allClasses = classChain.join(" ");

  const modules = spec.modules || [];
  const entities = spec.entities || [];
  const appName = spec.app_name || spec.name || "";

  // Check if it's the app name
  if (text === appName) {
    return {
      type: "app_name",
      path: "app_name",
      label: "App Name",
      currentValue: appName,
      currentColor: spec.design_system?.colors?.primary,
    };
  }

  // Check if it's a sidebar module item
  for (let i = 0; i < modules.length; i++) {
    if (text === modules[i].name) {
      // Could be sidebar or topbar title
      if (allClasses.includes("shrink-0") || allClasses.includes("w-48")) {
        return {
          type: "sidebar_item",
          path: String(i),
          label: `Sidebar: ${modules[i].name}`,
          currentValue: modules[i].name,
        };
      }
      return {
        type: "topbar_title",
        path: String(i),
        label: `Module: ${modules[i].name}`,
        currentValue: modules[i].name,
      };
    }
  }

  // Check if it's an entity title (e.g., "Customers")
  for (const entity of entities) {
    const plural = entity.name + "s";
    if (text.includes(plural) || text === entity.name) {
      return {
        type: "entity_title",
        path: entity.name,
        label: `Entity: ${entity.name}`,
        currentValue: plural,
      };
    }
  }

  // Check stat cards
  const stats = spec.dashboard?.stat_cards || [];
  for (let i = 0; i < stats.length; i++) {
    const label = stats[i].label || stats[i].title || stats[i].name || "";
    if (text === label || text.includes(label)) {
      return {
        type: "stat_card",
        path: String(i),
        label: `Stat Card: ${label}`,
        currentValue: label,
      };
    }
  }

  // Check entity stat cards (when no dashboard stats, entities are used)
  if (stats.length === 0) {
    for (let i = 0; i < entities.length && i < 4; i++) {
      const name = entities[i].name;
      if (text.includes(name) || text === `Total ${name}`) {
        return {
          type: "stat_card",
          path: String(i),
          label: `Stat Card: ${name}`,
          currentValue: text,
        };
      }
    }
  }

  // Check for "Add" button text
  if (text.startsWith("Add ")) {
    return {
      type: "add_button",
      path: "add_button",
      label: "Add Button",
      currentValue: text,
      currentColor: spec.design_system?.colors?.primary,
    };
  }

  // Check "Recent Activity"
  if (text === "Recent Activity") {
    return {
      type: "activity_title",
      path: "activity",
      label: "Section Title",
      currentValue: text,
    };
  }

  // Check for "Search..."
  if (text.includes("Search")) {
    return {
      type: "search",
      path: "search",
      label: "Search Bar",
      currentValue: "Search...",
    };
  }

  // Fallback: try to match any text element
  if (text.length > 0 && text.length < 100) {
    return {
      type: "app_name",
      path: "generic",
      label: "Element",
      currentValue: text,
    };
  }

  return null;
}

function calculatePanelPosition(
  rect: { top: number; left: number; width: number; height: number },
  container: HTMLElement | null
): { top: number; left: number } {
  if (!container) return { top: rect.top, left: rect.left + rect.width + 8 };

  const containerRect = container.getBoundingClientRect();
  const panelWidth = 288; // w-72 = 18rem = 288px
  const panelHeight = 400; // approximate

  let left = rect.left + rect.width + 8;
  let top = rect.top;

  // If panel would overflow right, place it to the left
  if (left + panelWidth > containerRect.width) {
    left = rect.left - panelWidth - 8;
  }

  // If still overflows left, center it
  if (left < 0) {
    left = Math.max(8, (containerRect.width - panelWidth) / 2);
  }

  // If panel would overflow bottom, move it up
  if (top + panelHeight > containerRect.height) {
    top = Math.max(8, containerRect.height - panelHeight - 8);
  }

  return { top, left };
}
