/**
 * FieldEditor — drag-and-drop field editor for a single entity.
 * Supports reorder, add, delete, edit, and enum value management.
 * Uses HTML5 drag and drop (no external library).
 */
import { useState, useCallback, useRef } from "react";
import {
  GripVertical,
  Trash2,
  Plus,
  ChevronDown,
  ChevronRight,
  X,
  Check,
  Eye,
  EyeOff,
  Table2,
  FormInput,
} from "lucide-react";

interface EnumValue {
  value: string;
  label?: string;
  color: string;
}

interface EditorField {
  name: string;
  label?: string;
  type?: string;
  sql_type?: string;
  required?: boolean;
  placeholder?: string;
  default_value?: string;
  show_in_table?: boolean;
  show_in_form?: boolean;
  enum_values?: EnumValue[];
  [key: string]: unknown;
}

interface EditorEntity {
  name: string;
  table_name?: string;
  fields: EditorField[];
  [key: string]: unknown;
}

interface FieldEditorProps {
  entity: EditorEntity;
  onEntityUpdate: (entity: EditorEntity) => void;
}

const FIELD_TYPES = [
  { value: "text", label: "Text", sqlType: "VARCHAR" },
  { value: "number", label: "Number", sqlType: "INTEGER" },
  { value: "date", label: "Date", sqlType: "DATE" },
  { value: "boolean", label: "Boolean", sqlType: "BOOLEAN" },
  { value: "email", label: "Email", sqlType: "VARCHAR" },
  { value: "phone", label: "Phone", sqlType: "VARCHAR" },
  { value: "select", label: "Select", sqlType: "ENUM" },
  { value: "textarea", label: "Textarea", sqlType: "TEXT" },
];

const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  VARCHAR: { bg: "#dcfce7", text: "#16a34a" },
  INTEGER: { bg: "#dbeafe", text: "#2563eb" },
  DECIMAL: { bg: "#dbeafe", text: "#2563eb" },
  FLOAT: { bg: "#dbeafe", text: "#2563eb" },
  BOOLEAN: { bg: "#fef3c7", text: "#d97706" },
  DATE: { bg: "#ede9fe", text: "#7c3aed" },
  DATETIME: { bg: "#ede9fe", text: "#7c3aed" },
  TIMESTAMP: { bg: "#ede9fe", text: "#7c3aed" },
  TEXT: { bg: "#f0fdf4", text: "#15803d" },
  ENUM: { bg: "#fce7f3", text: "#db2777" },
  JSON: { bg: "#f1f5f9", text: "#475569" },
};

function getTypeDisplay(field: EditorField): string {
  if (field.sql_type) return field.sql_type.toUpperCase().split("(")[0];
  const t = (field.type || "text").toLowerCase();
  const match = FIELD_TYPES.find((ft) => ft.value === t);
  return match?.sqlType || t.toUpperCase();
}

function getTypeColors(typeStr: string) {
  return TYPE_COLORS[typeStr] || { bg: "#f3f4f6", text: "#6b7280" };
}

const DEFAULT_BADGE_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#84cc16", "#6366f1",
];

/* ═══════════════════════════════════════════════════════════════════ */

export function FieldEditor({ entity, onEntityUpdate }: FieldEditorProps) {
  const [expandedField, setExpandedField] = useState<number | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // New field form state
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState("text");
  const [newFieldRequired, setNewFieldRequired] = useState(false);

  const fields: EditorField[] = entity?.fields || [];

  const updateFields = useCallback(
    (newFields: EditorField[]) => {
      onEntityUpdate({ ...entity, fields: newFields });
    },
    [entity, onEntityUpdate]
  );

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
    // Make the drag ghost slightly transparent
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "0.5";
    }
  };

  const handleDragEnd = (e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "1";
    }
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    const fromIndex = dragIndex;
    if (fromIndex === null || fromIndex === toIndex) return;

    const newFields = [...fields];
    const [moved] = newFields.splice(fromIndex, 1);
    newFields.splice(toIndex, 0, moved);
    updateFields(newFields);
    setDragIndex(null);
    setDragOverIndex(null);
  };

  // Field operations
  const toggleFieldProp = (index: number, prop: string) => {
    const newFields = [...fields];
    newFields[index] = { ...newFields[index], [prop]: !newFields[index][prop] };
    updateFields(newFields);
  };

  const updateField = (index: number, updates: Partial<EditorField>) => {
    const newFields = [...fields];
    newFields[index] = { ...newFields[index], ...updates };
    updateFields(newFields);
  };

  const deleteField = (index: number) => {
    const newFields = fields.filter((_, i) => i !== index);
    updateFields(newFields);
    setDeleteConfirm(null);
    if (expandedField === index) setExpandedField(null);
  };

  const addField = () => {
    if (!newFieldName.trim()) return;
    const sqlTypeMatch = FIELD_TYPES.find((t) => t.value === newFieldType);
    const newField: EditorField = {
      name: newFieldName.trim().toLowerCase().replace(/\s+/g, "_"),
      label: newFieldName.trim(),
      type: newFieldType,
      sql_type: sqlTypeMatch?.sqlType || "VARCHAR",
      required: newFieldRequired,
      show_in_table: true,
      show_in_form: true,
    };
    if (newFieldType === "select") {
      newField.enum_values = [];
    }
    updateFields([...fields, newField]);
    setNewFieldName("");
    setNewFieldType("text");
    setNewFieldRequired(false);
    setShowAddForm(false);
  };

  // Enum value management
  const addEnumValue = (fieldIndex: number, value: string) => {
    if (!value.trim()) return;
    const field = fields[fieldIndex];
    const existing = field.enum_values || [];
    const colorIdx = existing.length % DEFAULT_BADGE_COLORS.length;
    const newEnum = {
      value: value.trim(),
      label: value.trim(),
      color: DEFAULT_BADGE_COLORS[colorIdx],
    };
    updateField(fieldIndex, {
      enum_values: [...existing, newEnum],
    });
  };

  const removeEnumValue = (fieldIndex: number, enumIndex: number) => {
    const field = fields[fieldIndex];
    const newEnums = (field.enum_values || []).filter(
      (_: EnumValue, i: number) => i !== enumIndex
    );
    updateField(fieldIndex, { enum_values: newEnums });
  };

  const updateEnumColor = (
    fieldIndex: number,
    enumIndex: number,
    color: string
  ) => {
    const field = fields[fieldIndex];
    const newEnums = [...(field.enum_values || [])];
    newEnums[enumIndex] = { ...newEnums[enumIndex], color };
    updateField(fieldIndex, { enum_values: newEnums });
  };

  if (!entity) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-400">No entity selected</p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-black">{entity.name}</h2>
          <p className="text-[10px] text-gray-400">
            {entity.table_name || entity.name.toLowerCase() + "s"} &middot;{" "}
            {fields.length} fields
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-1 rounded-lg bg-pink-500 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-pink-600"
        >
          <Plus className="h-3 w-3" />
          Add Field
        </button>
      </div>

      {/* Field list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {fields.map((field, index) => {
          const typeDisplay = getTypeDisplay(field);
          const colors = getTypeColors(typeDisplay);
          const isExpanded = expandedField === index;
          const isDragOver = dragOverIndex === index;
          const isEnum =
            field.type === "select" || typeDisplay === "ENUM";

          return (
            <div
              key={field.name + "-" + index}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              className={`rounded-xl border transition-all ${
                isExpanded
                  ? "border-pink-200 bg-pink-50/30 shadow-sm"
                  : isDragOver
                  ? "border-pink-300 bg-pink-50"
                  : "border-gray-200 bg-white hover:border-gray-300"
              }`}
            >
              {/* Field card header */}
              <div
                className="flex cursor-pointer items-center gap-2 px-3 py-2.5"
                onClick={() =>
                  setExpandedField(isExpanded ? null : index)
                }
              >
                {/* Drag handle */}
                <div
                  className="cursor-grab text-gray-300 hover:text-gray-500 active:cursor-grabbing"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <GripVertical className="h-4 w-4" />
                </div>

                {/* Expand arrow */}
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3 text-gray-400 flex-shrink-0" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-gray-400 flex-shrink-0" />
                )}

                {/* Field name */}
                <span className="text-xs font-medium text-black flex-1 min-w-0 truncate">
                  {field.label || field.name}
                  {field.required && (
                    <span className="ml-1 text-pink-500">*</span>
                  )}
                </span>

                {/* Type badge */}
                <span
                  className="flex-shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold"
                  style={{
                    backgroundColor: colors.bg,
                    color: colors.text,
                  }}
                >
                  {typeDisplay}
                </span>

                {/* Nullable indicator */}
                {!field.required && (
                  <span className="text-[9px] text-gray-400 flex-shrink-0">
                    nullable
                  </span>
                )}

                {/* Show in table toggle */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFieldProp(index, "show_in_table");
                  }}
                  className={`rounded p-1 transition ${
                    field.show_in_table !== false
                      ? "text-pink-500 bg-pink-50"
                      : "text-gray-300 hover:text-gray-500"
                  }`}
                  title={
                    field.show_in_table !== false
                      ? "Shown in table"
                      : "Hidden from table"
                  }
                >
                  <Table2 className="h-3 w-3" />
                </button>

                {/* Show in form toggle */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFieldProp(index, "show_in_form");
                  }}
                  className={`rounded p-1 transition ${
                    field.show_in_form !== false
                      ? "text-pink-500 bg-pink-50"
                      : "text-gray-300 hover:text-gray-500"
                  }`}
                  title={
                    field.show_in_form !== false
                      ? "Shown in form"
                      : "Hidden from form"
                  }
                >
                  <FormInput className="h-3 w-3" />
                </button>

                {/* Delete button */}
                {deleteConfirm === index ? (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => deleteField(index)}
                      className="rounded bg-red-500 px-1.5 py-0.5 text-[9px] font-medium text-white hover:bg-red-600 transition"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      className="rounded bg-gray-200 px-1.5 py-0.5 text-[9px] font-medium text-gray-600 hover:bg-gray-300 transition"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteConfirm(index);
                    }}
                    className="rounded p-1 text-gray-300 transition hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>

              {/* Expanded field details */}
              {isExpanded && (
                <div className="border-t border-gray-100 px-4 py-3 space-y-3">
                  {/* Field name */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                        Field Name
                      </label>
                      <input
                        type="text"
                        value={field.name || ""}
                        onChange={(e) =>
                          updateField(index, { name: e.target.value })
                        }
                        className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-black outline-none transition focus:border-pink-300 focus:ring-1 focus:ring-pink-200"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                        Label
                      </label>
                      <input
                        type="text"
                        value={field.label || ""}
                        onChange={(e) =>
                          updateField(index, { label: e.target.value })
                        }
                        className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-black outline-none transition focus:border-pink-300 focus:ring-1 focus:ring-pink-200"
                      />
                    </div>
                  </div>

                  {/* Type and required */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                        Type
                      </label>
                      <select
                        value={field.type || "text"}
                        onChange={(e) => {
                          const match = FIELD_TYPES.find(
                            (t) => t.value === e.target.value
                          );
                          updateField(index, {
                            type: e.target.value,
                            sql_type: match?.sqlType || "VARCHAR",
                            ...(e.target.value === "select"
                              ? { enum_values: field.enum_values || [] }
                              : {}),
                          });
                        }}
                        className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-black outline-none transition focus:border-pink-300 focus:ring-1 focus:ring-pink-200"
                      >
                        {FIELD_TYPES.map((ft) => (
                          <option key={ft.value} value={ft.value}>
                            {ft.label} ({ft.sqlType})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-end">
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={field.required || false}
                          onChange={() =>
                            toggleFieldProp(index, "required")
                          }
                          className="h-3.5 w-3.5 rounded border-gray-300 text-pink-500 focus:ring-pink-400"
                        />
                        <span className="text-xs text-gray-600">Required</span>
                      </label>
                    </div>
                  </div>

                  {/* Placeholder / default */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                        Placeholder
                      </label>
                      <input
                        type="text"
                        value={field.placeholder || ""}
                        onChange={(e) =>
                          updateField(index, { placeholder: e.target.value })
                        }
                        className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-black outline-none transition focus:border-pink-300 focus:ring-1 focus:ring-pink-200"
                        placeholder="Enter placeholder..."
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                        Default Value
                      </label>
                      <input
                        type="text"
                        value={field.default_value || ""}
                        onChange={(e) =>
                          updateField(index, { default_value: e.target.value })
                        }
                        className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-black outline-none transition focus:border-pink-300 focus:ring-1 focus:ring-pink-200"
                        placeholder="Default value..."
                      />
                    </div>
                  </div>

                  {/* Enum values editor for select fields */}
                  {isEnum && (
                    <div>
                      <label className="mb-1.5 block text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                        Enum Values
                      </label>
                      <div className="space-y-1.5">
                        {(field.enum_values || []).map(
                          (ev: EnumValue, ei: number) => (
                            <div
                              key={ei}
                              className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-1.5"
                            >
                              {/* Color picker */}
                              <input
                                type="color"
                                value={ev.color || "#3b82f6"}
                                onChange={(e) =>
                                  updateEnumColor(
                                    index,
                                    ei,
                                    e.target.value
                                  )
                                }
                                className="h-5 w-5 cursor-pointer rounded border-0 p-0"
                                title="Badge color"
                              />
                              {/* Preview badge */}
                              <span
                                className="rounded-full px-2 py-0.5 text-[9px] font-medium text-white"
                                style={{
                                  backgroundColor: ev.color || "#3b82f6",
                                }}
                              >
                                {ev.label || ev.value}
                              </span>
                              <span className="flex-1 text-[10px] text-gray-500 truncate">
                                {ev.value}
                              </span>
                              <button
                                onClick={() =>
                                  removeEnumValue(index, ei)
                                }
                                className="rounded p-0.5 text-gray-400 transition hover:text-red-500"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          )
                        )}
                        {/* Add enum value */}
                        <EnumAdder
                          onAdd={(val) => addEnumValue(index, val)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Add field form */}
        {showAddForm && (
          <div className="rounded-xl border-2 border-dashed border-pink-200 bg-pink-50/30 p-4 space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-pink-600">
              New Field
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[10px] font-medium text-gray-500">
                  Name
                </label>
                <input
                  type="text"
                  value={newFieldName}
                  onChange={(e) => setNewFieldName(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-black outline-none transition focus:border-pink-300 focus:ring-1 focus:ring-pink-200"
                  placeholder="field_name"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addField();
                    if (e.key === "Escape") setShowAddForm(false);
                  }}
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-medium text-gray-500">
                  Type
                </label>
                <select
                  value={newFieldType}
                  onChange={(e) => setNewFieldType(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-black outline-none transition focus:border-pink-300 focus:ring-1 focus:ring-pink-200"
                >
                  {FIELD_TYPES.map((ft) => (
                    <option key={ft.value} value={ft.value}>
                      {ft.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={newFieldRequired}
                onChange={(e) => setNewFieldRequired(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300 text-pink-500 focus:ring-pink-400"
              />
              <span className="text-xs text-gray-600">Required</span>
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={addField}
                disabled={!newFieldName.trim()}
                className="flex items-center gap-1 rounded-lg bg-pink-500 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-pink-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Check className="h-3 w-3" />
                Add
              </button>
              <button
                onClick={() => setShowAddForm(false)}
                className="rounded-lg px-3 py-1.5 text-[11px] font-medium text-gray-500 transition hover:bg-gray-100 hover:text-black"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Add field button when form is not visible */}
        {!showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-gray-200 py-3 text-xs font-medium text-gray-400 transition hover:border-pink-300 hover:text-pink-500"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Field
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Inline enum value adder ── */
function EnumAdder({ onAdd }: { onAdd: (val: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-black outline-none transition focus:border-pink-300 focus:ring-1 focus:ring-pink-200"
        placeholder="Add value..."
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) {
            onAdd(value);
            setValue("");
          }
        }}
      />
      <button
        onClick={() => {
          if (value.trim()) {
            onAdd(value);
            setValue("");
          }
        }}
        disabled={!value.trim()}
        className="flex-shrink-0 rounded-lg bg-pink-500 p-1.5 text-white transition hover:bg-pink-600 disabled:opacity-40"
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}
