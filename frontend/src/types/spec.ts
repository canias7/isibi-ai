// ── Field-level spec ────────────────────────────────────────────────

export interface FieldSpec {
  [key: string]: unknown;
  name: string;
  db_type: string;
  ts_type: string;
  nullable: boolean;
  primary_key?: boolean;
  default?: string | number | boolean | null;
  enum_values?: string[];
  input_component: string | null;
  display_component: string | null;
  display_link_to?: string;
  display_clickable?: boolean;
  display_max_visible?: number;
  display_max_lines?: number;
  display_align?: string;
  editable: boolean;
  sortable: boolean;
  filterable: boolean;
  filter_type?: string;
  show_in_table: boolean;
  show_in_form: boolean;
  fk_entity?: string;
  auto_set?: string;
  // Badge colors keyed by enum value → tailwind color name
  badge_colors?: Record<string, string>;
  validation?: {
    required?: boolean;
    max_length?: number;
    min?: number;
    max?: number;
    format?: string;
    positive?: boolean;
    unique_warning?: boolean;
  };
}

// ── UI config ───────────────────────────────────────────────────────

export interface EmptyState {
  icon: string;
  heading: string;
  subtext: string;
  action_label: string;
}

export interface TabSpec {
  name: string;
  eager: boolean;
  component: string;
  data_query: string;
  count_query?: string;
  action?: {
    label: string;
    opens: string;
    prefill?: Record<string, string>;
  };
}

export interface ListViewConfig {
  layout: string;
  default_sort: string;
  default_sort_order?: string;
  page_size: number;
  columns: string[];
  quick_filter_tabs?: string[];
  filters: string[];
  bulk_actions?: string[];
  row_actions?: string[];
  empty_state: EmptyState;
  kanban_columns?: string[];
  overdue_row_style?: string;
}

export interface DetailViewConfig {
  layout: string;
  route: string;
  tabs: TabSpec[];
  header?: {
    title_fields: string[];
    badge_fields: string[];
    meta_fields: string[];
  };
  primary_fields: string[];
  secondary_fields: string[];
}

export interface FormConfig {
  type: string;
  title: string;
  required_fields: string[];
  field_order: string[];
  submit_action: string;
  on_success: string[];
  prefilled?: boolean;
}

export interface UIConfig {
  list_view?: ListViewConfig;
  detail_view?: DetailViewConfig;
  create_form?: FormConfig;
  edit_form?: FormConfig;
}

// ── Entity spec ─────────────────────────────────────────────────────

export interface RelationshipSpec {
  type: string;
  entity: string;
  foreign_key: string;
  on_delete: string;
}

export interface EntitySpec {
  name: string;
  table: string;
  description: string;
  fields: FieldSpec[];
  indexes?: string[];
  relationships?: RelationshipSpec[];
  ui_config: UIConfig;
}

// ── Module spec ─────────────────────────────────────────────────────
// Each module maps to a page/route. `entity` explicitly declares
// which entity this module renders — no guessing.

export interface ModuleSpec {
  name: string;
  route: string;
  detail_route?: string;
  component: string;
  detail_component?: string;
  layout: string;            // "table" | "kanban" | "split" | "dashboard" | "detail"
  sidebar_order: number;
  sidebar_icon?: string;     // Lucide icon name, e.g. "Users", "ShoppingCart"
  sidebar_badge?: string;
  entity?: string;           // ← KEY: explicit entity name this module is for
  primary_action?: {
    label: string;
    opens: string;
  };
  visible_to_roles?: string[];
}

// ── Dashboard stat config (spec-driven) ─────────────────────────────

export interface DashboardStatSpec {
  [key: string]: unknown;
  label: string;
  key?: string;
  entity?: string;
  name?: string;
  title?: string;
  icon: string;
  color: string;
  link_to?: string;
}

export interface DashboardConfig {
  stat_cards: DashboardStatSpec[];
  filters?: string[];
}

// ── Top-level app spec ──────────────────────────────────────────────
// Renamed from CRMSpec → AppSpec since this drives ANY app, not just CRM

export interface AppSpec {
  _meta?: Record<string, unknown>;
  app_name?: string;
  name?: string;
  app_type?: string;
  entities: EntitySpec[];
  modules: ModuleSpec[];
  dashboard?: DashboardConfig;
  design_system?: {
    colors?: { primary?: string; secondary?: string; [key: string]: unknown };
    [key: string]: unknown;
  };
  pagination?: {
    default_page_size: number;
    max_page_size: number;
  };
  [key: string]: unknown;
}

// Keep backward compat alias
export type CRMSpec = AppSpec;
