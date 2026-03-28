/**
 * SpecEditor — Visual spec builder with entity list + field editor.
 * Left panel: entity cards with drag-to-reorder.
 * Right panel: field editor for the selected entity.
 * Bottom bar: Apply / Reset / counts.
 */
import { useState, useCallback, useMemo } from "react";
import {
  Check,
  Plus,
  Trash2,
  GripVertical,
  ChevronRight,
  ToggleLeft,
  ToggleRight,
  X,
} from "lucide-react";
import type { AppSpec, FieldSpec, UIConfig } from "@/types/spec";

interface SpecEditorProps {
  spec: AppSpec;
  onSpecUpdate: (spec: AppSpec) => void;
}

/* ── Field type options ── */
const FIELD_TYPES = [
  "Text",
  "Number",
  "Date",
  "Boolean",
  "Select",
  "Email",
  "Phone",
  "Price",
  "URL",
  "Textarea",
  "Relation",
] as const;

type FieldType = (typeof FIELD_TYPES)[number];

const FIELD_TYPE_TO_DB: Record<FieldType, string> = {
  Text: "VARCHAR(255)",
  Number: "INTEGER",
  Date: "DATE",
  Boolean: "BOOLEAN",
  Select: "VARCHAR(100)",
  Email: "VARCHAR(320)",
  Phone: "VARCHAR(50)",
  Price: "NUMERIC(12,2)",
  URL: "TEXT",
  Textarea: "TEXT",
  Relation: "UUID",
};

const FIELD_TYPE_TO_TS: Record<FieldType, string> = {
  Text: "string",
  Number: "number",
  Date: "string",
  Boolean: "boolean",
  Select: "string",
  Email: "string",
  Phone: "string",
  Price: "number",
  URL: "string",
  Textarea: "string",
  Relation: "string",
};

const FIELD_TYPE_TO_INPUT: Record<FieldType, string> = {
  Text: "text_input",
  Number: "number_input",
  Date: "date_input",
  Boolean: "checkbox",
  Select: "select",
  Email: "text_input",
  Phone: "text_input",
  Price: "number_input",
  URL: "text_input",
  Textarea: "textarea",
  Relation: "relation_select",
};

const BADGE_COLORS = [
  "#ec4899", "#8b5cf6", "#3b82f6", "#10b981", "#f59e0b",
  "#ef4444", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

/* ── Helpers ── */

function dbTypeToFieldType(dbType: string, inputComponent?: string): FieldType {
  if (inputComponent === "textarea") return "Textarea";
  if (inputComponent === "select") return "Select";
  if (inputComponent === "relation_select") return "Relation";
  if (inputComponent === "checkbox") return "Boolean";
  if (dbType === "BOOLEAN") return "Boolean";
  if (dbType === "DATE") return "Date";
  if (dbType === "TEXT" && inputComponent === "textarea") return "Textarea";
  if (dbType === "TEXT") return "URL";
  if (dbType?.startsWith("NUMERIC")) return "Price";
  if (dbType === "INTEGER" || dbType === "SMALLINT") return "Number";
  if (dbType?.startsWith("VARCHAR(32")) return "Email";
  if (dbType?.startsWith("VARCHAR(5")) return "Phone";
  if (dbType === "UUID") return "Relation";
  return "Text";
}

function generateTableName(name: string): string {
  const snake = name
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/\s+/g, "_")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
  if (snake.endsWith("s") || snake.endsWith("x") || snake.endsWith("z"))
    return snake + "es";
  if (snake.endsWith("y") && snake.length > 1 && !"aeiou".includes(snake[snake.length - 2]))
    return snake.slice(0, -1) + "ies";
  return snake + "s";
}

const SYSTEM_FIELD_NAMES = new Set([
  "id", "org_id", "created_at", "updated_at", "deleted_at", "version",
]);

/* ── Types for internal state ── */

interface EditableField {
  id: string;
  name: string;
  fieldType: FieldType;
  required: boolean;
  showInTable: boolean;
  showInForm: boolean;
  enumValues?: { value: string; color: string }[];
  relationEntity?: string;
  label?: string;
  isSystem?: boolean;
}

interface EditableEntity {
  id: string;
  name: string;
  table: string;
  description: string;
  fields: EditableField[];
}

/* ── Convert spec to editable state ── */

function specToEntities(spec: AppSpec): EditableEntity[] {
  const entities: EditableEntity[] = [];
  const rawEntities = spec?.entities || [];

  for (const ent of rawEntities) {
    if (!ent || typeof ent !== "object") continue;

    const fields: EditableField[] = [];
    for (const f of ent.fields || []) {
      if (!f || typeof f !== "object") continue;
      if (SYSTEM_FIELD_NAMES.has(f.name)) continue;

      const ft = dbTypeToFieldType(f.db_type, f.input_component ?? undefined);

      const enumValues: { value: string; color: string }[] = [];
      if (ft === "Select" && f.enum_values) {
        const colors = f.badge_colors || {};
        for (const v of f.enum_values) {
          enumValues.push({ value: v, color: colors[v] || BADGE_COLORS[0] });
        }
      }

      fields.push({
        id: crypto.randomUUID(),
        name: f.name || "field",
        fieldType: ft,
        required: f.nullable === false,
        showInTable: f.show_in_table !== false,
        showInForm: f.show_in_form !== false,
        label: (f.label as string) || f.name,
        enumValues: ft === "Select" ? enumValues : undefined,
        relationEntity: ft === "Relation" ? f.fk_entity || "" : undefined,
        isSystem: false,
      });
    }

    entities.push({
      id: crypto.randomUUID(),
      name: ent.name || "Entity",
      table: ent.table || generateTableName(ent.name || "entity"),
      description: ent.description || "",
      fields,
    });
  }

  return entities;
}

/* ── Convert editable state back to spec ── */

function entitiesToSpec(entities: EditableEntity[], originalSpec: AppSpec): AppSpec {
  const spec = JSON.parse(JSON.stringify(originalSpec)) as AppSpec;

  spec.entities = entities.map((ent) => {
    const fields = ent.fields.map((f) => {
      const dbType = FIELD_TYPE_TO_DB[f.fieldType];
      const base: Record<string, unknown> = {
        name: f.name,
        label: f.label || f.name.charAt(0).toUpperCase() + f.name.slice(1).replace(/_/g, " "),
        db_type: f.fieldType === "Select"
          ? `ENUM(${(f.enumValues || []).map((v) => `'${v.value}'`).join(",")})`
          : dbType + (f.required ? " NOT NULL" : ""),
        ts_type: FIELD_TYPE_TO_TS[f.fieldType],
        nullable: !f.required,
        editable: true,
        show_in_table: f.showInTable,
        show_in_form: f.showInForm,
        input_component: FIELD_TYPE_TO_INPUT[f.fieldType],
        display_component: f.fieldType === "Boolean" ? "Badge" : "Text",
      };
      if (f.fieldType === "Select" && f.enumValues) {
        base.enum_values = f.enumValues.map((v) => v.value);
        base.badge_colors = Object.fromEntries(
          f.enumValues.map((v) => [v.value, v.color])
        );
      }
      if (f.fieldType === "Relation" && f.relationEntity) {
        base.fk_entity = f.relationEntity;
        base.input_component = "relation_select";
      }
      return base;
    });

    return {
      name: ent.name,
      table: ent.table,
      description: ent.description,
      fields: fields as unknown as FieldSpec[],
      ui_config: {} as UIConfig,
    };
  });

  // Regenerate modules from entities
  spec.modules = [
    {
      name: "Dashboard",
      route: "/",
      component: "DashboardPage",
      layout: "sidebar",
      sidebar_order: 1,
      sidebar_icon: "BarChart3",
      entity: undefined,
    },
    ...entities.map((ent, i) => ({
      name: ent.name + "s",
      route: "/" + ent.table,
      component: ent.name + "Page",
      layout: "sidebar",
      sidebar_order: i + 2,
      sidebar_icon: "Box",
      entity: ent.name,
    })),
  ];

  return spec;
}

/* ── Toggle component ── */

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-black transition"
      title={label}
    >
      {checked ? (
        <ToggleRight className="h-4 w-4 text-pink-500" />
      ) : (
        <ToggleLeft className="h-4 w-4 text-gray-300" />
      )}
      <span className={checked ? "text-black" : ""}>{label}</span>
    </button>
  );
}

/* ── Enum Values Editor ── */

function EnumEditor({
  values,
  onChange,
}: {
  values: { value: string; color: string }[];
  onChange: (v: { value: string; color: string }[]) => void;
}) {
  const addValue = () => {
    onChange([
      ...values,
      { value: "Option " + (values.length + 1), color: BADGE_COLORS[values.length % BADGE_COLORS.length] },
    ]);
  };

  const removeValue = (idx: number) => {
    onChange(values.filter((_, i) => i !== idx));
  };

  const updateValue = (idx: number, val: string) => {
    const next = [...values];
    next[idx] = { ...next[idx], value: val };
    onChange(next);
  };

  const updateColor = (idx: number, color: string) => {
    const next = [...values];
    next[idx] = { ...next[idx], color };
    onChange(next);
  };

  return (
    <div className="mt-2 ml-6 rounded-lg border border-gray-100 bg-gray-50 p-3">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
        Enum Values
      </p>
      <div className="space-y-1.5">
        {values.map((v, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="color"
              value={v.color}
              onChange={(e) => updateColor(i, e.target.value)}
              className="h-6 w-6 cursor-pointer rounded border-0 p-0"
              title="Badge color"
            />
            <input
              type="text"
              value={v.value}
              onChange={(e) => updateValue(i, e.target.value)}
              className="flex-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-black outline-none focus:border-pink-300 focus:ring-1 focus:ring-pink-200"
            />
            <button
              onClick={() => removeValue(i)}
              className="text-gray-300 hover:text-red-500 transition"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={addValue}
        className="mt-2 flex items-center gap-1 text-[11px] font-medium text-pink-500 hover:text-pink-600 transition"
      >
        <Plus className="h-3 w-3" /> Add value
      </button>
    </div>
  );
}

/* ── Field Row ── */

function FieldRow({
  field,
  entityNames,
  onUpdate,
  onDelete,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  field: EditableField;
  entityNames: string[];
  onUpdate: (f: EditableField) => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver(e);
      }}
      onDrop={onDrop}
      className="group rounded-lg border border-gray-100 bg-white p-3 hover:border-pink-200 transition"
    >
      <div className="flex items-center gap-3">
        {/* Drag handle */}
        <div className="cursor-grab text-gray-200 group-hover:text-gray-400 transition">
          <GripVertical className="h-4 w-4" />
        </div>

        {/* Field name */}
        <input
          type="text"
          value={field.name}
          onChange={(e) => onUpdate({ ...field, name: e.target.value })}
          className="w-40 rounded border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-black outline-none focus:border-pink-300 focus:ring-1 focus:ring-pink-200"
          placeholder="field_name"
        />

        {/* Type dropdown */}
        <select
          value={field.fieldType}
          onChange={(e) => {
            const ft = e.target.value as FieldType;
            const updated: EditableField = { ...field, fieldType: ft };
            if (ft === "Select" && !updated.enumValues?.length) {
              updated.enumValues = [
                { value: "Option 1", color: BADGE_COLORS[0] },
                { value: "Option 2", color: BADGE_COLORS[1] },
              ];
            }
            if (ft === "Relation" && !updated.relationEntity) {
              updated.relationEntity = entityNames[0] || "";
            }
            onUpdate(updated);
          }}
          className="w-28 rounded border border-gray-200 bg-white px-2 py-1.5 text-xs text-black outline-none focus:border-pink-300 focus:ring-1 focus:ring-pink-200"
        >
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        {/* Toggles */}
        <div className="flex items-center gap-3 ml-auto">
          <Toggle
            checked={field.required}
            onChange={(v) => onUpdate({ ...field, required: v })}
            label="Required"
          />
          <Toggle
            checked={field.showInTable}
            onChange={(v) => onUpdate({ ...field, showInTable: v })}
            label="Table"
          />
          <Toggle
            checked={field.showInForm}
            onChange={(v) => onUpdate({ ...field, showInForm: v })}
            label="Form"
          />
        </div>

        {/* Delete */}
        <button
          onClick={onDelete}
          className="ml-2 text-gray-200 hover:text-red-500 transition"
          title="Delete field"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Enum editor */}
      {field.fieldType === "Select" && (
        <EnumEditor
          values={field.enumValues || []}
          onChange={(vals) => onUpdate({ ...field, enumValues: vals })}
        />
      )}

      {/* Relation entity picker */}
      {field.fieldType === "Relation" && (
        <div className="mt-2 ml-6">
          <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
            Related Entity
          </label>
          <select
            value={field.relationEntity || ""}
            onChange={(e) =>
              onUpdate({ ...field, relationEntity: e.target.value })
            }
            className="mt-1 w-48 rounded border border-gray-200 bg-white px-2 py-1.5 text-xs text-black outline-none focus:border-pink-300 focus:ring-1 focus:ring-pink-200"
          >
            <option value="">Select entity...</option>
            {entityNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════ */

export function SpecEditor({ spec, onSpecUpdate }: SpecEditorProps) {
  const [entities, setEntities] = useState<EditableEntity[]>(() =>
    specToEntities(spec)
  );
  const [originalEntities] = useState<EditableEntity[]>(() =>
    specToEntities(spec)
  );
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const initial = specToEntities(spec);
    return initial.length > 0 ? initial[0].id : null;
  });
  const [applied, setApplied] = useState(false);
  const [dragEntityIdx, setDragEntityIdx] = useState<number | null>(null);
  const [dragFieldIdx, setDragFieldIdx] = useState<number | null>(null);

  const selectedEntity = useMemo(
    () => entities.find((e) => e.id === selectedId) || null,
    [entities, selectedId]
  );

  const entityNames = useMemo(() => entities.map((e) => e.name), [entities]);

  const totalFields = useMemo(
    () => entities.reduce((sum, e) => sum + e.fields.length, 0),
    [entities]
  );

  /* ── Entity operations ── */

  const addEntity = useCallback(() => {
    const idx = entities.length + 1;
    const name = "NewEntity" + idx;
    const newEntity: EditableEntity = {
      id: crypto.randomUUID(),
      name,
      table: generateTableName(name),
      description: name + " management",
      fields: [
        {
          id: crypto.randomUUID(),
          name: "name",
          fieldType: "Text",
          required: true,
          showInTable: true,
          showInForm: true,
          label: "Name",
        },
      ],
    };
    setEntities((prev) => [...prev, newEntity]);
    setSelectedId(newEntity.id);
  }, [entities.length]);

  const deleteEntity = useCallback(
    (id: string) => {
      setEntities((prev) => prev.filter((e) => e.id !== id));
      if (selectedId === id) {
        setSelectedId(entities.length > 1 ? entities[0].id : null);
      }
    },
    [selectedId, entities]
  );

  const updateEntity = useCallback(
    (id: string, updates: Partial<EditableEntity>) => {
      setEntities((prev) =>
        prev.map((e) => (e.id === id ? { ...e, ...updates } : e))
      );
    },
    []
  );

  /* ── Field operations ── */

  const addField = useCallback(() => {
    if (!selectedId) return;
    const newField: EditableField = {
      id: crypto.randomUUID(),
      name: "new_field",
      fieldType: "Text",
      required: false,
      showInTable: true,
      showInForm: true,
      label: "New Field",
    };
    setEntities((prev) =>
      prev.map((e) =>
        e.id === selectedId
          ? { ...e, fields: [...e.fields, newField] }
          : e
      )
    );
  }, [selectedId]);

  const updateField = useCallback(
    (fieldId: string) => (updated: EditableField) => {
      if (!selectedId) return;
      setEntities((prev) =>
        prev.map((e) =>
          e.id === selectedId
            ? {
                ...e,
                fields: e.fields.map((f) =>
                  f.id === fieldId ? updated : f
                ),
              }
            : e
        )
      );
    },
    [selectedId]
  );

  const deleteField = useCallback(
    (fieldId: string) => {
      if (!selectedId) return;
      setEntities((prev) =>
        prev.map((e) =>
          e.id === selectedId
            ? { ...e, fields: e.fields.filter((f) => f.id !== fieldId) }
            : e
        )
      );
    },
    [selectedId]
  );

  /* ── Drag & drop for entities ── */

  const handleEntityDrop = useCallback(
    (targetIdx: number) => {
      if (dragEntityIdx === null || dragEntityIdx === targetIdx) return;
      setEntities((prev) => {
        const next = [...prev];
        const [moved] = next.splice(dragEntityIdx, 1);
        next.splice(targetIdx, 0, moved);
        return next;
      });
      setDragEntityIdx(null);
    },
    [dragEntityIdx]
  );

  /* ── Drag & drop for fields ── */

  const handleFieldDrop = useCallback(
    (targetIdx: number) => {
      if (!selectedId || dragFieldIdx === null || dragFieldIdx === targetIdx) return;
      setEntities((prev) =>
        prev.map((e) => {
          if (e.id !== selectedId) return e;
          const fields = [...e.fields];
          const [moved] = fields.splice(dragFieldIdx, 1);
          fields.splice(targetIdx, 0, moved);
          return { ...e, fields };
        })
      );
      setDragFieldIdx(null);
    },
    [selectedId, dragFieldIdx]
  );

  /* ── Apply / Reset ── */

  const handleApply = useCallback(() => {
    const newSpec = entitiesToSpec(entities, spec);
    onSpecUpdate(newSpec);
    setApplied(true);
    setTimeout(() => setApplied(false), 2000);
  }, [entities, spec, onSpecUpdate]);

  const handleReset = useCallback(() => {
    setEntities(originalEntities.map((e) => ({ ...e })));
    setSelectedId(originalEntities.length > 0 ? originalEntities[0].id : null);
  }, [originalEntities]);

  return (
    <div className="flex h-full w-full flex-col bg-white">
      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Left panel: Entity list ── */}
        <div className="w-72 flex-shrink-0 border-r border-gray-200 flex flex-col bg-gray-50/50">
          <div className="border-b border-gray-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-black">Entities</h2>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {entities.length} {entities.length === 1 ? "entity" : "entities"}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {entities.map((ent, idx) => (
              <div
                key={ent.id}
                draggable
                onDragStart={() => setDragEntityIdx(idx)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleEntityDrop(idx)}
                onClick={() => setSelectedId(ent.id)}
                className={`group flex items-center gap-2 rounded-lg border p-3 cursor-pointer transition ${
                  selectedId === ent.id
                    ? "border-pink-300 bg-pink-50 shadow-sm"
                    : "border-gray-100 bg-white hover:border-gray-200 hover:shadow-sm"
                }`}
              >
                <div className="cursor-grab text-gray-200 group-hover:text-gray-400 transition">
                  <GripVertical className="h-3.5 w-3.5" />
                </div>

                <div className="flex-1 min-w-0">
                  <p
                    className={`text-xs font-semibold truncate ${
                      selectedId === ent.id ? "text-pink-700" : "text-black"
                    }`}
                  >
                    {ent.name}
                  </p>
                  <p className="text-[10px] text-gray-400 truncate mt-0.5">
                    {ent.table} &middot; {ent.fields.length}{" "}
                    {ent.fields.length === 1 ? "field" : "fields"}
                  </p>
                </div>

                <ChevronRight
                  className={`h-3.5 w-3.5 flex-shrink-0 transition ${
                    selectedId === ent.id ? "text-pink-400" : "text-gray-200"
                  }`}
                />
              </div>
            ))}
          </div>

          {/* Add entity button */}
          <div className="border-t border-gray-200 p-3">
            <button
              onClick={addEntity}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-500 hover:border-pink-300 hover:text-pink-500 transition"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Entity
            </button>
          </div>
        </div>

        {/* ── Right panel: Field editor ── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedEntity ? (
            <>
              {/* Entity header */}
              <div className="border-b border-gray-200 px-6 py-4">
                <div className="flex items-start gap-4">
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center gap-3">
                      <input
                        type="text"
                        value={selectedEntity.name}
                        onChange={(e) =>
                          updateEntity(selectedEntity.id, {
                            name: e.target.value,
                            table: generateTableName(e.target.value),
                          })
                        }
                        className="text-lg font-bold text-black border-b border-transparent hover:border-gray-200 focus:border-pink-400 outline-none pb-0.5 transition"
                        placeholder="Entity name"
                      />
                      <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[10px] font-medium text-gray-400">
                        {selectedEntity.table}
                      </span>
                    </div>
                    <input
                      type="text"
                      value={selectedEntity.description}
                      onChange={(e) =>
                        updateEntity(selectedEntity.id, {
                          description: e.target.value,
                        })
                      }
                      className="w-full text-xs text-gray-400 border-b border-transparent hover:border-gray-200 focus:border-pink-400 outline-none pb-0.5 transition"
                      placeholder="Description..."
                    />
                  </div>
                  <button
                    onClick={() => deleteEntity(selectedEntity.id)}
                    className="rounded-lg p-2 text-gray-300 hover:bg-red-50 hover:text-red-500 transition"
                    title="Delete entity"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Field list */}
              <div className="flex-1 overflow-y-auto px-6 py-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                    Fields ({selectedEntity.fields.length})
                  </p>
                  <div className="flex items-center gap-6 text-[10px] text-gray-300 font-medium">
                    <span className="w-40">Name</span>
                    <span className="w-28">Type</span>
                    <span className="ml-auto flex gap-6">
                      <span>Required</span>
                      <span>Table</span>
                      <span>Form</span>
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  {selectedEntity.fields.map((field, idx) => (
                    <FieldRow
                      key={field.id}
                      field={field}
                      entityNames={entityNames}
                      onUpdate={updateField(field.id)}
                      onDelete={() => deleteField(field.id)}
                      onDragStart={() => setDragFieldIdx(idx)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleFieldDrop(idx)}
                    />
                  ))}
                </div>

                {/* Add field button */}
                <button
                  onClick={addField}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-200 bg-gray-50/50 px-3 py-2.5 text-xs font-medium text-gray-400 hover:border-pink-300 hover:text-pink-500 transition"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Field
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <p className="text-sm text-gray-400">No entity selected</p>
                <p className="text-xs text-gray-300 mt-1">
                  Select an entity from the left or add a new one
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom bar ── */}
      <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-6 py-3">
        <p className="text-xs text-gray-400">
          {entities.length} {entities.length === 1 ? "entity" : "entities"} &middot;{" "}
          {totalFields} {totalFields === 1 ? "field" : "fields"}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="rounded-lg border border-gray-200 bg-white px-4 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-black transition"
          >
            Reset
          </button>
          <button
            onClick={handleApply}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold text-white transition ${
              applied
                ? "bg-green-500"
                : "bg-pink-500 hover:bg-pink-600"
            }`}
          >
            <Check className="h-3.5 w-3.5" />
            {applied ? "Applied!" : "Apply Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
