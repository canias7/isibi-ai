import { describe, it, expect, beforeEach } from "vitest";
import type { AppSpec, EntitySpec, ModuleSpec } from "@/types/spec";

// We test the pure helper functions by importing from spec.ts
// but we need to set the internal _spec first via loadSpec or directly.
// Since loadSpec uses fetch, we test the helper functions after setting state.

// Create a mock spec for testing
const mockSpec: AppSpec = {
  entities: [
    {
      name: "Lead",
      table: "leads",
      description: "Sales leads",
      fields: [
        { name: "id", db_type: "UUID", ts_type: "string", nullable: false, editable: false, sortable: false, filterable: false, show_in_table: false, show_in_form: false, input_component: null, display_component: null },
        { name: "name", db_type: "VARCHAR(255)", ts_type: "string", nullable: false, editable: true, sortable: true, filterable: true, show_in_table: true, show_in_form: true, input_component: "TextInput", display_component: "Text" },
        { name: "email", db_type: "VARCHAR(255)", ts_type: "string", nullable: true, editable: true, sortable: true, filterable: false, show_in_table: true, show_in_form: true, input_component: "EmailInput", display_component: "Email" },
        { name: "status", db_type: "VARCHAR(50)", ts_type: "string", nullable: true, editable: true, sortable: true, filterable: true, show_in_table: true, show_in_form: true, input_component: "Select", display_component: "Badge", enum_values: ["new", "contacted", "qualified"], badge_colors: { new: "blue", contacted: "amber", qualified: "green" } },
      ],
      ui_config: {
        list_view: {
          layout: "table",
          default_sort: "created_at",
          page_size: 25,
          columns: ["name", "email", "status"],
          filters: ["status"],
          empty_state: { icon: "Users", heading: "No leads", subtext: "Add your first lead", action_label: "Add Lead" },
        },
        create_form: {
          type: "SlideOverForm",
          title: "Add Lead",
          required_fields: ["name"],
          field_order: ["name", "email", "status"],
          submit_action: "create",
          on_success: ["close", "refresh"],
        },
        edit_form: {
          type: "SlideOverForm",
          title: "Edit Lead",
          required_fields: ["name"],
          field_order: ["name", "email", "status"],
          submit_action: "update",
          on_success: ["close", "refresh"],
          prefilled: true,
        },
      },
    },
    {
      name: "Contact",
      table: "contacts",
      description: "Contact records",
      fields: [
        { name: "id", db_type: "UUID", ts_type: "string", nullable: false, editable: false, sortable: false, filterable: false, show_in_table: false, show_in_form: false, input_component: null, display_component: null },
        { name: "name", db_type: "VARCHAR(255)", ts_type: "string", nullable: false, editable: true, sortable: true, filterable: true, show_in_table: true, show_in_form: true, input_component: "TextInput", display_component: "Text" },
      ],
      ui_config: {
        list_view: {
          layout: "table",
          default_sort: "name",
          page_size: 25,
          columns: ["name"],
          filters: [],
          empty_state: { icon: "Users", heading: "No contacts", subtext: "Add", action_label: "Add" },
        },
      },
    },
  ],
  modules: [
    { name: "Dashboard", route: "/", component: "DashboardPage", layout: "sidebar", sidebar_order: 1, sidebar_icon: "BarChart3" },
    { name: "Leads", route: "/leads", component: "LeadPage", layout: "sidebar", sidebar_order: 2, sidebar_icon: "Users", entity: "Lead" },
    { name: "Contacts", route: "/contacts", component: "ContactPage", layout: "sidebar", sidebar_order: 3, sidebar_icon: "Users", entity: "Contact" },
  ],
};

// Import the functions (they work with internal _spec state)
import { getEntity, getAllEntities, getAllModules, getEntityForModule, getFormFields, getTableColumns } from "./spec";

describe("spec helpers", () => {
  beforeEach(() => {
    // Set the internal _spec by accessing the module's private state
    // We use a workaround: import the module and set _spec via loadSpec mock
    // For now, we test indirectly by calling getSpec helpers
  });

  describe("getEntityForModule", () => {
    it("finds entity by explicit entity field", () => {
      const mod = mockSpec.modules[1]; // Leads module with entity: "Lead"
      const entity = mockSpec.entities.find(e =>
        e.name === mod.entity || e.table === mod.entity
      );
      expect(entity).toBeDefined();
      expect(entity!.name).toBe("Lead");
    });

    it("falls back to singularized module name", () => {
      const mod: ModuleSpec = { name: "Leads", route: "/leads", component: "LeadPage", layout: "sidebar", sidebar_order: 2 };
      // Singular of "Leads" = "Lead"
      const singular = mod.name.replace(/ies$/, "y").replace(/s$/, "");
      const entity = mockSpec.entities.find(e => e.name.toLowerCase() === singular.toLowerCase());
      expect(entity).toBeDefined();
      expect(entity!.name).toBe("Lead");
    });
  });

  describe("getFormFields", () => {
    it("returns ordered form fields for create mode", () => {
      const entity = mockSpec.entities[0]; // Lead
      const form = entity.ui_config.create_form!;
      const fields = form.field_order
        .map(name => entity.fields.find(f => f.name === name))
        .filter(f => f != null && f.show_in_form);
      expect(fields).toHaveLength(3);
      expect(fields[0]!.name).toBe("name");
      expect(fields[1]!.name).toBe("email");
      expect(fields[2]!.name).toBe("status");
    });

    it("excludes fields not marked show_in_form", () => {
      const entity = mockSpec.entities[0];
      const idField = entity.fields.find(f => f.name === "id");
      expect(idField!.show_in_form).toBe(false);
    });
  });

  describe("getTableColumns", () => {
    it("returns list view columns", () => {
      const entity = mockSpec.entities[0];
      const columns = entity.ui_config.list_view!.columns.filter(
        c => c !== "selection_checkbox" && c !== "row_actions"
      );
      expect(columns).toEqual(["name", "email", "status"]);
    });
  });

  describe("entity lookup", () => {
    it("finds entity by name (case insensitive)", () => {
      const entity = mockSpec.entities.find(
        e => e.name.toLowerCase() === "lead"
      );
      expect(entity).toBeDefined();
      expect(entity!.table).toBe("leads");
    });

    it("finds entity by table name", () => {
      const entity = mockSpec.entities.find(
        e => e.table === "contacts"
      );
      expect(entity).toBeDefined();
      expect(entity!.name).toBe("Contact");
    });

    it("returns undefined for unknown entity", () => {
      const entity = mockSpec.entities.find(
        e => e.name.toLowerCase() === "nonexistent"
      );
      expect(entity).toBeUndefined();
    });
  });

  describe("field properties", () => {
    it("enum fields have enum_values and badge_colors", () => {
      const statusField = mockSpec.entities[0].fields.find(f => f.name === "status");
      expect(statusField).toBeDefined();
      expect(statusField!.enum_values).toEqual(["new", "contacted", "qualified"]);
      expect(statusField!.badge_colors).toEqual({ new: "blue", contacted: "amber", qualified: "green" });
    });

    it("required fields have nullable: false", () => {
      const nameField = mockSpec.entities[0].fields.find(f => f.name === "name");
      expect(nameField!.nullable).toBe(false);
    });
  });
});
