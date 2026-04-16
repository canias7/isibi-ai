import type { AppSpec, EntitySpec, ModuleSpec } from "@/types/spec";

// ── Runtime spec store ──────────────────────────────────────────────
// The spec is fetched at runtime. It could be a CRM, a restaurant system,
// an HR tool — whatever the AI generated for the customer.

let _spec: AppSpec | null = null;

/**
 * Load the spec that drives this app instance.
 * Priority:
 *   1. GET /api/spec  (backend serves the generated spec for this org)
 *   2. Bundled fallback for local dev
 */
/**
 * Load the spec from the backend.
 * Returns null if no spec exists yet (user hasn't generated one).
 */
export async function loadSpec(): Promise<AppSpec | null> {
  try {
    const apiBase = import.meta.env.VITE_API_URL || "/api";
    const res = await fetch(`${apiBase}/spec`);
    if (res.ok) {
      _spec = (await res.json()) as AppSpec;
      return _spec;
    }
  } catch (err) {
    console.warn("Failed to load spec from backend:", err);
  }
  return null;
}

export function getSpec(): AppSpec {
  if (!_spec) throw new Error("Spec not loaded. Call loadSpec() first.");
  return _spec;
}

// ── Entity helpers ──────────────────────────────────────────────────

export function getEntity(name: string): EntitySpec | undefined {
  return getSpec().entities.find(
    (e) => e.name.toLowerCase() === name.toLowerCase() || e.table === name
  );
}

export function getAllEntities(): EntitySpec[] {
  return getSpec().entities;
}

// ── Module helpers ──────────────────────────────────────────────────

export function getAllModules(): ModuleSpec[] {
  return getSpec().modules ?? [];
}

/**
 * Resolve the entity a module renders.
 * Uses the explicit `module.entity` field.
 * Falls back to name-based matching (singular of module name → entity name)
 * so it works with specs that don't have the entity field yet.
 */
export function getEntityForModule(mod: ModuleSpec): EntitySpec | undefined {
  const entities = getAllEntities();

  // 1. Explicit entity field (preferred — the AI should always set this)
  if (mod.entity) {
    const match = entities.find(
      (e) => e.name === mod.entity || e.table === mod.entity
    );
    if (match) return match;
  }

  // 2. Fallback: try singularizing the module name
  const singular = mod.name.replace(/ies$/, "y").replace(/s$/, "");
  return entities.find(
    (e) => e.name.toLowerCase() === singular.toLowerCase()
  );
}

// ── Field helpers ───────────────────────────────────────────────────

export function getFormFields(entity: EntitySpec, mode: "create" | "edit") {
  const formConfig =
    mode === "create"
      ? entity.ui_config.create_form
      : entity.ui_config.edit_form;
  if (!formConfig) return [];

  return formConfig.field_order
    .map((name) => entity.fields.find((f) => f.name === name))
    .filter((f): f is NonNullable<typeof f> => f != null && f.show_in_form);
}

export function getTableColumns(entity: EntitySpec) {
  const listView = entity.ui_config.list_view;
  if (!listView) return [];
  return listView.columns.filter(
    (c) => c !== "selection_checkbox" && c !== "row_actions"
  );
}
