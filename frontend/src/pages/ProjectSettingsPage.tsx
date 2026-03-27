import { useState, useEffect, useCallback } from "react";
import {
  Settings,
  Palette,
  Users,
  Zap,
  Plug,
  Database,
  Lock,
  LayoutGrid,
  Wrench,
  Loader2,
  Check,
  X,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Upload,
  Download,
  ExternalLink,
  Copy,
  RefreshCw,
  Play,
} from "lucide-react";
import { get, post, put, patch, del } from "@/api/client";

// ─── Types ───
interface Props {
  projectId: string;
  spec: any;
  onSpecUpdate: (spec: any) => void;
}

type Category =
  | "general"
  | "branding"
  | "roles"
  | "automations"
  | "integrations"
  | "data"
  | "security"
  | "views"
  | "advanced";

interface Toast {
  id: number;
  type: "success" | "error";
  message: string;
}

// ─── Toast system ───
let toastId = 0;

// ─── Category config ───
const CATEGORIES: { id: Category; label: string; icon: typeof Settings }[] = [
  { id: "general", label: "General", icon: Settings },
  { id: "branding", label: "Branding", icon: Palette },
  { id: "roles", label: "User Roles", icon: Users },
  { id: "automations", label: "Automations", icon: Zap },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "data", label: "Data", icon: Database },
  { id: "security", label: "Security", icon: Lock },
  { id: "views", label: "Views", icon: LayoutGrid },
  { id: "advanced", label: "Advanced", icon: Wrench },
];

/** Helper: gracefully handle 403/404 by returning a fallback */
async function safeFetch<T>(fn: () => Promise<T>, fallback: T): Promise<{ data: T; unavailable: boolean }> {
  try {
    const data = await fn();
    return { data, unavailable: false };
  } catch (err: any) {
    if (err?.status === 403 || err?.status === 404) {
      return { data: fallback, unavailable: true };
    }
    return { data: fallback, unavailable: false };
  }
}

// ─── Reusable components ───

function SectionCard({
  title,
  children,
  saving,
  onSave,
  unavailable,
}: {
  title: string;
  children: React.ReactNode;
  saving?: boolean;
  onSave?: () => void;
  unavailable?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-4 text-sm font-semibold text-black">{title}</h3>
      {unavailable && (
        <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
          Not available on free plan. Upgrade to access this feature.
        </div>
      )}
      {children}
      {onSave && !unavailable && (
        <div className="mt-5 flex justify-end">
          <button
            onClick={onSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-xs font-medium text-gray-600">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-gray-400">{hint}</p>}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-black placeholder-gray-400 focus:border-pink-400 focus:outline-none focus:ring-1 focus:ring-pink-400"
    />
  );
}

function Toggle({
  checked,
  onChange,
  label,
  disabled,
  disabledHint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  disabledHint?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <span className="text-sm text-black">{label}</span>
        {disabled && disabledHint && (
          <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
            {disabledHint}
          </span>
        )}
      </div>
      <button
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className={`relative h-6 w-11 rounded-full transition ${
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
        } ${checked ? "bg-pink-500" : "bg-gray-200"}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function Accordion({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-gray-100">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-gray-50"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
          <span className="text-sm font-medium text-black">{title}</span>
          {count !== undefined && (
            <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
              {count}
            </span>
          )}
        </div>
      </button>
      {open && <div className="border-t border-gray-100 px-4 py-3">{children}</div>}
    </div>
  );
}

function ColorPicker({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-xs font-medium text-gray-600">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value || "#ec4899"}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-9 cursor-pointer rounded-lg border border-gray-200"
        />
        <input
          type="text"
          value={value || "#ec4899"}
          onChange={(e) => onChange(e.target.value)}
          className="w-28 rounded-lg border border-gray-200 px-3 py-2 text-sm text-black font-mono focus:border-pink-400 focus:outline-none focus:ring-1 focus:ring-pink-400"
        />
      </div>
    </div>
  );
}

// ─── Main Component ───
/** Skeleton shown while a settings section is loading */
function SettingsSkeleton() {
  return (
    <div className="animate-pulse space-y-5">
      <div>
        <div className="h-5 bg-gray-200 rounded w-1/3 mb-1" />
        <div className="h-3 bg-gray-200 rounded w-1/2" />
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
        <div className="h-4 bg-gray-200 rounded w-1/4" />
        <div className="h-9 bg-gray-200 rounded w-full" />
        <div className="h-4 bg-gray-200 rounded w-1/3 mt-3" />
        <div className="h-9 bg-gray-200 rounded w-full" />
        <div className="h-4 bg-gray-200 rounded w-1/4 mt-3" />
        <div className="h-9 bg-gray-200 rounded w-24" />
      </div>
    </div>
  );
}

export function ProjectSettingsPage({ projectId, spec, onSpecUpdate }: Props) {
  const [activeCategory, setActiveCategory] = useState<Category>("general");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [sectionReady, setSectionReady] = useState(false);

  // Show skeleton briefly when switching categories
  useEffect(() => {
    setSectionReady(false);
    const timer = setTimeout(() => setSectionReady(true), 150);
    return () => clearTimeout(timer);
  }, [activeCategory]);

  const showToast = useCallback((type: "success" | "error", message: string) => {
    const id = ++toastId;
    setToasts((t) => [...t, { id, type, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  }, []);

  const projectBase = `/projects/${projectId}`;
  const appBase = `/apps/${projectId}`;

  return (
    <div className="flex h-full overflow-hidden bg-gray-50">
      {/* Left sidebar - categories */}
      <div className="w-56 shrink-0 border-r border-gray-200 bg-white">
        <div className="px-4 py-4">
          <h2 className="text-sm font-semibold text-black">Project Settings</h2>
          <p className="mt-0.5 text-[11px] text-gray-400">Configure your app</p>
        </div>
        <nav className="space-y-0.5 px-2 pb-4">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const isActive = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                  isActive
                    ? "bg-pink-50 font-medium text-pink-700"
                    : "text-gray-600 hover:bg-gray-50 hover:text-black"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {cat.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Right panel */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-2xl space-y-5">
          {!sectionReady ? (
            <SettingsSkeleton />
          ) : (
            <>
          {activeCategory === "general" && (
            <GeneralSettings
              projectId={projectId}
              spec={spec}
              onSpecUpdate={onSpecUpdate}
              showToast={showToast}
              projectBase={projectBase}
            />
          )}
          {activeCategory === "branding" && (
            <BrandingSettings
              projectId={projectId}
              spec={spec}
              onSpecUpdate={onSpecUpdate}
              showToast={showToast}
              projectBase={projectBase}
            />
          )}
          {activeCategory === "roles" && (
            <RolesSettings
              projectId={projectId}
              spec={spec}
              showToast={showToast}
              appBase={appBase}
            />
          )}
          {activeCategory === "automations" && (
            <AutomationsSettings
              projectId={projectId}
              spec={spec}
              showToast={showToast}
              projectBase={projectBase}
              appBase={appBase}
            />
          )}
          {activeCategory === "integrations" && (
            <IntegrationsSettings
              projectId={projectId}
              showToast={showToast}
              projectBase={projectBase}
            />
          )}
          {activeCategory === "data" && (
            <DataSettings
              projectId={projectId}
              spec={spec}
              showToast={showToast}
              appBase={appBase}
            />
          )}
          {activeCategory === "security" && (
            <SecuritySettings
              projectId={projectId}
              showToast={showToast}
              projectBase={projectBase}
              appBase={appBase}
            />
          )}
          {activeCategory === "views" && (
            <ViewsSettings
              projectId={projectId}
              spec={spec}
              showToast={showToast}
              projectBase={projectBase}
            />
          )}
          {activeCategory === "advanced" && (
            <AdvancedSettings
              projectId={projectId}
              spec={spec}
              showToast={showToast}
              projectBase={projectBase}
              appBase={appBase}
            />
          )}
            </>
          )}
        </div>
      </div>

      {/* Toast notifications */}
      <div className="fixed bottom-4 right-4 z-50 space-y-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-all animate-in slide-in-from-bottom-2 ${
              toast.type === "success"
                ? "bg-green-600 text-white"
                : "bg-red-600 text-white"
            }`}
          >
            {toast.type === "success" ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 1. GENERAL SETTINGS
// ═══════════════════════════════════════════════════════════════
function GeneralSettings({
  projectId,
  spec,
  onSpecUpdate,
  showToast,
  projectBase,
}: {
  projectId: string;
  spec: any;
  onSpecUpdate: (s: any) => void;
  showToast: (type: "success" | "error", msg: string) => void;
  projectBase: string;
}) {
  const [appName, setAppName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load project data from API on mount
  useEffect(() => {
    (async () => {
      try {
        const data = await get<any>(`${projectBase}`);
        if (data) {
          setAppName(data.name || data.app_name || spec?.app_name || "");
          setDescription(data.description || spec?.description || "");
        }
      } catch {
        // Fallback to spec
        setAppName(spec?.app_name || "");
        setDescription(spec?.description || "");
      } finally {
        setLoading(false);
      }
    })();
  }, [projectBase]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await patch(`${projectBase}`, { name: appName, description });
      const updated = { ...spec, app_name: appName, description };
      onSpecUpdate(updated);
      showToast("success", "General settings saved");
    } catch {
      showToast("error", "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <>
      <div className="mb-2">
        <h2 className="text-lg font-semibold text-black">General</h2>
        <p className="text-xs text-gray-400">Basic app configuration</p>
      </div>
      <SectionCard title="App Identity" saving={saving} onSave={handleSave}>
        <FormField label="App Name">
          <TextInput value={appName} onChange={setAppName} placeholder="My App" />
        </FormField>
        <FormField label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe your application..."
            rows={3}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-black placeholder-gray-400 focus:border-pink-400 focus:outline-none focus:ring-1 focus:ring-pink-400"
          />
        </FormField>
      </SectionCard>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// 2. BRANDING SETTINGS
// ═══════════════════════════════════════════════════════════════
function BrandingSettings({
  projectId,
  spec,
  onSpecUpdate,
  showToast,
  projectBase,
}: {
  projectId: string;
  spec: any;
  onSpecUpdate: (s: any) => void;
  showToast: (type: "success" | "error", msg: string) => void;
  projectBase: string;
}) {
  const [logoUrl, setLogoUrl] = useState("");
  const [primaryColor, setPrimaryColor] = useState(spec?.primary_color || "#ec4899");
  const [secondaryColor, setSecondaryColor] = useState("#1f2937");
  const [hidePoweredBy, setHidePoweredBy] = useState(false);
  const [customCss, setCustomCss] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, unavailable: notAvail } = await safeFetch(
        () => get<any>(`${projectBase}/branding`),
        null
      );
      setUnavailable(notAvail);
      if (data) {
        setLogoUrl(data.logo_url || "");
        setPrimaryColor(data.primary_color || spec?.primary_color || "#ec4899");
        setSecondaryColor(data.secondary_color || "#1f2937");
        setHidePoweredBy(data.hide_powered_by || false);
        setCustomCss(data.custom_css || "");
      }
      setLoaded(true);
    })();
  }, [projectBase]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await put(`${projectBase}/branding`, {
        logo_url: logoUrl,
        primary_color: primaryColor,
        secondary_color: secondaryColor,
        hide_powered_by: hidePoweredBy,
        custom_css: customCss,
      });
      showToast("success", "Branding saved");
    } catch {
      showToast("error", "Failed to save branding");
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <>
      <div className="mb-2">
        <h2 className="text-lg font-semibold text-black">Branding</h2>
        <p className="text-xs text-gray-400">Customize the look and feel of your app</p>
      </div>
      <SectionCard title="Brand Identity" saving={saving} onSave={handleSave} unavailable={unavailable}>
        <FormField label="Logo URL" hint="Direct link to your logo image (PNG, SVG recommended)">
          <TextInput value={logoUrl} onChange={setLogoUrl} placeholder="https://example.com/logo.png" />
          {logoUrl && (
            <div className="mt-2 flex h-12 w-12 items-center justify-center rounded-lg border border-gray-200 bg-gray-50">
              <img src={logoUrl} alt="Logo preview" className="max-h-10 max-w-10 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            </div>
          )}
        </FormField>
        <ColorPicker value={primaryColor} onChange={setPrimaryColor} label="Primary Color" />
        <ColorPicker value={secondaryColor} onChange={setSecondaryColor} label="Secondary Color" />
        <Toggle
          checked={hidePoweredBy}
          onChange={setHidePoweredBy}
          label="Hide 'Powered by isibi.ai'"
          disabled={false}
          disabledHint="Pro plan required"
        />
        <FormField label="Custom CSS" hint="Advanced: inject custom CSS into your app">
          <textarea
            value={customCss}
            onChange={(e) => setCustomCss(e.target.value)}
            placeholder=".my-class { color: red; }"
            rows={5}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-xs text-black placeholder-gray-400 focus:border-pink-400 focus:outline-none focus:ring-1 focus:ring-pink-400"
          />
        </FormField>
      </SectionCard>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// 3. USER ROLES
// ═══════════════════════════════════════════════════════════════
function RolesSettings({
  projectId,
  spec,
  showToast,
  appBase,
}: {
  projectId: string;
  spec: any;
  showToast: (type: "success" | "error", msg: string) => void;
  appBase: string;
}) {
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleLabel, setNewRoleLabel] = useState("");
  const [newRoleScope, setNewRoleScope] = useState("all");
  const [addingRole, setAddingRole] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const entities = spec?.entities?.map((e: any) => e.name) || [];
  const actions = ["create", "read", "update", "delete"];

  const loadRoles = async () => {
    try {
      const data = await get<any[]>(`${appBase}/roles`);
      setRoles(data || []);
    } catch {
      setRoles([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadRoles(); }, [appBase]);

  const addRole = async () => {
    if (!newRoleName.trim()) return;
    setAddingRole(true);
    try {
      const perms: Record<string, string[]> = {};
      entities.forEach((e: string) => { perms[e] = ["read"]; });
      await post(`${appBase}/roles`, {
        name: newRoleName.trim(),
        label: newRoleLabel.trim() || newRoleName.trim(),
        scope: newRoleScope,
        permissions: perms,
      });
      setNewRoleName("");
      setNewRoleLabel("");
      setNewRoleScope("all");
      await loadRoles();
      showToast("success", `Role "${newRoleName.trim()}" created`);
    } catch {
      showToast("error", "Failed to create role");
    } finally {
      setAddingRole(false);
    }
  };

  const togglePermission = (roleIdx: number, entity: string, action: string) => {
    setRoles((prev) =>
      prev.map((r, i) => {
        if (i !== roleIdx) return r;
        const perms = { ...(r.permissions || {}) };
        const entityPerms = [...(perms[entity] || [])];
        const idx = entityPerms.indexOf(action);
        if (idx > -1) entityPerms.splice(idx, 1);
        else entityPerms.push(action);
        perms[entity] = entityPerms;
        return { ...r, permissions: perms };
      })
    );
  };

  const saveRole = async (role: any) => {
    setSavingId(role.id);
    try {
      await put(`${appBase}/roles/${role.id}`, { name: role.name, label: role.label, scope: role.scope, permissions: role.permissions });
      showToast("success", `Role "${role.name}" saved`);
    } catch {
      showToast("error", "Failed to save role");
    } finally {
      setSavingId(null);
    }
  };

  const deleteRole = async (role: any) => {
    if (!confirm(`Delete role "${role.name}"?`)) return;
    try {
      await del(`${appBase}/roles/${role.id}`);
      await loadRoles();
      showToast("success", `Role "${role.name}" deleted`);
    } catch {
      showToast("error", "Failed to delete role");
    }
  };

  const updateRoleField = (roleIdx: number, field: string, value: string) => {
    setRoles((prev) =>
      prev.map((r, i) => (i === roleIdx ? { ...r, [field]: value } : r))
    );
  };

  const selectClass = "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-black focus:border-pink-400 focus:outline-none focus:ring-1 focus:ring-pink-400";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <>
      <div className="mb-2">
        <h2 className="text-lg font-semibold text-black">User Roles</h2>
        <p className="text-xs text-gray-400">Manage roles and permissions for your app users</p>
      </div>

      {/* Add role */}
      <SectionCard title="Add Role">
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <FormField label="Name">
              <TextInput value={newRoleName} onChange={setNewRoleName} placeholder="e.g. manager" />
            </FormField>
            <FormField label="Label">
              <TextInput value={newRoleLabel} onChange={setNewRoleLabel} placeholder="e.g. Manager" />
            </FormField>
            <FormField label="Scope">
              <select value={newRoleScope} onChange={(e) => setNewRoleScope(e.target.value)} className={selectClass}>
                <option value="all">All records</option>
                <option value="own">Own records only</option>
                <option value="team">Team records</option>
                <option value="none">No access</option>
              </select>
            </FormField>
          </div>
          <button
            onClick={addRole}
            disabled={addingRole || !newRoleName.trim()}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
          >
            {addingRole ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Add
          </button>
        </div>
      </SectionCard>

      {/* Role permissions */}
      {roles.map((role, ri) => (
        <SectionCard
          key={role.id || ri}
          title={role.label || role.name}
          saving={savingId === role.id}
          onSave={() => saveRole(role)}
        >
          <div className="mb-4 grid grid-cols-3 gap-2">
            <FormField label="Name">
              <TextInput value={role.name || ""} onChange={(v) => updateRoleField(ri, "name", v)} placeholder="name" />
            </FormField>
            <FormField label="Label">
              <TextInput value={role.label || ""} onChange={(v) => updateRoleField(ri, "label", v)} placeholder="Label" />
            </FormField>
            <FormField label="Scope">
              <select value={role.scope || "all"} onChange={(e) => updateRoleField(ri, "scope", e.target.value)} className={selectClass}>
                <option value="all">All records</option>
                <option value="own">Own records only</option>
                <option value="team">Team records</option>
                <option value="none">No access</option>
              </select>
            </FormField>
          </div>

          <p className="mb-2 text-xs font-medium text-gray-500">Permissions Grid</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="py-2 text-left font-medium text-gray-500">Entity</th>
                  {actions.map((a) => (
                    <th key={a} className="py-2 text-center font-medium text-gray-500 capitalize">{a}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entities.map((entity: string) => (
                  <tr key={entity} className="border-b border-gray-50">
                    <td className="py-2 font-medium text-black">{entity}</td>
                    {actions.map((action) => {
                      const checked = (role.permissions?.[entity] || []).includes(action);
                      return (
                        <td key={action} className="py-2 text-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => togglePermission(ri, entity, action)}
                            className="h-4 w-4 rounded border-gray-300 text-pink-500 focus:ring-pink-400"
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex justify-start">
            <button
              onClick={() => deleteRole(role)}
              className="flex items-center gap-1 text-xs text-red-500 transition hover:text-red-700"
            >
              <Trash2 className="h-3 w-3" />
              Delete role
            </button>
          </div>
        </SectionCard>
      ))}

      {roles.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center">
          <Users className="mx-auto mb-2 h-8 w-8 text-gray-300" />
          <p className="text-sm text-gray-500">No roles configured yet</p>
          <p className="mt-1 text-xs text-gray-400">Add a role above to get started</p>
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// 4. AUTOMATIONS
// ═══════════════════════════════════════════════════════════════
function AutomationsSettings({
  projectId,
  spec,
  showToast,
  projectBase,
  appBase,
}: {
  projectId: string;
  spec: any;
  showToast: (type: "success" | "error", msg: string) => void;
  projectBase: string;
  appBase: string;
}) {
  const entities = spec?.entities?.map((e: any) => e.name) || [];
  const [loading, setLoading] = useState(true);

  // ── Email Triggers ──
  const [emailTriggers, setEmailTriggers] = useState<any[]>([]);
  const [emailForm, setEmailForm] = useState({ event: "created", entity: entities[0] || "", to_field: "", subject: "", body_template: "" });
  const [emailSaving, setEmailSaving] = useState(false);

  // ── Webhooks ──
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [webhookForm, setWebhookForm] = useState({ event: "created", entity: entities[0] || "", url: "" });
  const [webhookSaving, setWebhookSaving] = useState(false);

  // ── Auto-assign ──
  const [autoAssigns, setAutoAssigns] = useState<any[]>([]);
  const [autoForm, setAutoForm] = useState({ entity: entities[0] || "", field: "", members: "", strategy: "round_robin" });
  const [autoSaving, setAutoSaving] = useState(false);

  // ── Status Rules ──
  const [statusRules, setStatusRules] = useState<any[]>([]);
  const [statusForm, setStatusForm] = useState({ entity: entities[0] || "", field: "", from_status: "", to_status: "", after_days: "7" });
  const [statusSaving, setStatusSaving] = useState(false);

  // ── Deadline Reminders ──
  const [reminders, setReminders] = useState<any[]>([]);
  const [reminderForm, setReminderForm] = useState({ entity: entities[0] || "", date_field: "", days_before: "1", notify_field: "" });
  const [reminderSaving, setReminderSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try { const d = await get<any[]>(`${projectBase}/email-triggers`); setEmailTriggers(d || []); } catch {}
      try { const d = await get<any[]>(`${projectBase}/webhook-triggers`); setWebhooks(d || []); } catch {}
      try { const d = await get<any[]>(`${appBase}/auto-assign/rules`); setAutoAssigns(d || []); } catch {}
      try { const d = await get<any[]>(`${appBase}/status-rules`); setStatusRules(d || []); } catch {}
      try { const d = await get<any[]>(`${appBase}/deadline-reminders`); setReminders(d || []); } catch {}
      setLoading(false);
    };
    load();
  }, [projectBase, appBase]);

  const events = ["created", "updated", "deleted", "status_changed"];

  const reloadEmailTriggers = async () => { const d = await get<any[]>(`${projectBase}/email-triggers`); setEmailTriggers(d || []); };
  const reloadWebhooks = async () => { const d = await get<any[]>(`${projectBase}/webhook-triggers`); setWebhooks(d || []); };
  const reloadAutoAssigns = async () => { const d = await get<any[]>(`${appBase}/auto-assign/rules`); setAutoAssigns(d || []); };
  const reloadStatusRules = async () => { const d = await get<any[]>(`${appBase}/status-rules`); setStatusRules(d || []); };
  const reloadReminders = async () => { const d = await get<any[]>(`${appBase}/deadline-reminders`); setReminders(d || []); };

  const addEmailTrigger = async () => {
    setEmailSaving(true);
    try {
      await post(`${projectBase}/email-triggers`, emailForm);
      await reloadEmailTriggers();
      setEmailForm({ event: "created", entity: entities[0] || "", to_field: "", subject: "", body_template: "" });
      showToast("success", "Email trigger added");
    } catch { showToast("error", "Failed to add email trigger"); }
    finally { setEmailSaving(false); }
  };

  const addWebhook = async () => {
    setWebhookSaving(true);
    try {
      await post(`${projectBase}/webhook-triggers`, webhookForm);
      await reloadWebhooks();
      setWebhookForm({ event: "created", entity: entities[0] || "", url: "" });
      showToast("success", "Webhook added");
    } catch { showToast("error", "Failed to add webhook"); }
    finally { setWebhookSaving(false); }
  };

  const addAutoAssign = async () => {
    setAutoSaving(true);
    try {
      await post(`${appBase}/auto-assign/rules`, { ...autoForm, members: autoForm.members.split(",").map((m) => m.trim()).filter(Boolean) });
      await reloadAutoAssigns();
      setAutoForm({ entity: entities[0] || "", field: "", members: "", strategy: "round_robin" });
      showToast("success", "Auto-assign rule added");
    } catch { showToast("error", "Failed to add auto-assign rule"); }
    finally { setAutoSaving(false); }
  };

  const addStatusRule = async () => {
    setStatusSaving(true);
    try {
      await post(`${appBase}/status-rules`, { ...statusForm, after_days: parseInt(statusForm.after_days) || 7 });
      await reloadStatusRules();
      setStatusForm({ entity: entities[0] || "", field: "", from_status: "", to_status: "", after_days: "7" });
      showToast("success", "Status rule added");
    } catch { showToast("error", "Failed to add status rule"); }
    finally { setStatusSaving(false); }
  };

  const addReminder = async () => {
    setReminderSaving(true);
    try {
      await post(`${appBase}/deadline-reminders`, { ...reminderForm, days_before: parseInt(reminderForm.days_before) || 1 });
      await reloadReminders();
      setReminderForm({ entity: entities[0] || "", date_field: "", days_before: "1", notify_field: "" });
      showToast("success", "Deadline reminder added");
    } catch { showToast("error", "Failed to add reminder"); }
    finally { setReminderSaving(false); }
  };

  const deleteEmailTrigger = async (id: string) => {
    try { await del(`${projectBase}/email-triggers/${id}`); await reloadEmailTriggers(); showToast("success", "Deleted"); }
    catch { showToast("error", "Failed to delete"); }
  };
  const deleteWebhook = async (id: string) => {
    try { await del(`${projectBase}/webhook-triggers/${id}`); await reloadWebhooks(); showToast("success", "Deleted"); }
    catch { showToast("error", "Failed to delete"); }
  };
  const deleteAutoAssign = async (id: string) => {
    try { await del(`${appBase}/auto-assign/rules/${id}`); await reloadAutoAssigns(); showToast("success", "Deleted"); }
    catch { showToast("error", "Failed to delete"); }
  };
  const deleteStatusRule = async (id: string) => {
    try { await del(`${appBase}/status-rules/${id}`); await reloadStatusRules(); showToast("success", "Deleted"); }
    catch { showToast("error", "Failed to delete"); }
  };
  const deleteReminder = async (id: string) => {
    try { await del(`${appBase}/deadline-reminders/${id}`); await reloadReminders(); showToast("success", "Deleted"); }
    catch { showToast("error", "Failed to delete"); }
  };

  const selectClass = "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-black focus:border-pink-400 focus:outline-none focus:ring-1 focus:ring-pink-400";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <>
      <div className="mb-2">
        <h2 className="text-lg font-semibold text-black">Automations</h2>
        <p className="text-xs text-gray-400">Configure automated workflows and triggers</p>
      </div>

      <div className="space-y-3">
        {/* Email Triggers */}
        <Accordion title="Email Triggers" count={emailTriggers.length}>
          {emailTriggers.map((t, i) => (
            <div key={t.id || i} className="mb-2 flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs">
              <span>On <strong>{t.event}</strong> of <strong>{t.entity}</strong> &rarr; email to {t.to_field}</span>
              <button onClick={() => deleteEmailTrigger(t.id)} className="text-red-400 hover:text-red-600"><Trash2 className="h-3 w-3" /></button>
            </div>
          ))}
          <div className="mt-3 space-y-2 rounded-lg border border-gray-100 p-3">
            <div className="grid grid-cols-2 gap-2">
              <select value={emailForm.event} onChange={(e) => setEmailForm({ ...emailForm, event: e.target.value })} className={selectClass}>
                {events.map((ev) => <option key={ev} value={ev}>{ev}</option>)}
              </select>
              <select value={emailForm.entity} onChange={(e) => setEmailForm({ ...emailForm, entity: e.target.value })} className={selectClass}>
                {entities.map((en: string) => <option key={en} value={en}>{en}</option>)}
              </select>
            </div>
            <TextInput value={emailForm.to_field} onChange={(v) => setEmailForm({ ...emailForm, to_field: v })} placeholder="to_field (e.g. email)" />
            <TextInput value={emailForm.subject} onChange={(v) => setEmailForm({ ...emailForm, subject: v })} placeholder="Email subject" />
            <textarea value={emailForm.body_template} onChange={(e) => setEmailForm({ ...emailForm, body_template: e.target.value })} placeholder="Email body template (use {{field_name}})" rows={3} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-black placeholder-gray-400 focus:border-pink-400 focus:outline-none focus:ring-1 focus:ring-pink-400" />
            <button onClick={addEmailTrigger} disabled={emailSaving} className="flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50">
              {emailSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Add Trigger
            </button>
          </div>
        </Accordion>

        {/* Webhooks */}
        <Accordion title="Webhooks" count={webhooks.length}>
          {webhooks.map((w, i) => (
            <div key={w.id || i} className="mb-2 flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs">
              <span>On <strong>{w.event}</strong> of <strong>{w.entity}</strong> &rarr; POST {w.url}</span>
              <button onClick={() => deleteWebhook(w.id)} className="text-red-400 hover:text-red-600"><Trash2 className="h-3 w-3" /></button>
            </div>
          ))}
          <div className="mt-3 space-y-2 rounded-lg border border-gray-100 p-3">
            <div className="grid grid-cols-2 gap-2">
              <select value={webhookForm.event} onChange={(e) => setWebhookForm({ ...webhookForm, event: e.target.value })} className={selectClass}>
                {events.map((ev) => <option key={ev} value={ev}>{ev}</option>)}
              </select>
              <select value={webhookForm.entity} onChange={(e) => setWebhookForm({ ...webhookForm, entity: e.target.value })} className={selectClass}>
                {entities.map((en: string) => <option key={en} value={en}>{en}</option>)}
              </select>
            </div>
            <TextInput value={webhookForm.url} onChange={(v) => setWebhookForm({ ...webhookForm, url: v })} placeholder="https://example.com/webhook" />
            <button onClick={addWebhook} disabled={webhookSaving} className="flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50">
              {webhookSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Add Webhook
            </button>
          </div>
        </Accordion>

        {/* Auto-assign */}
        <Accordion title="Auto-Assign Rules" count={autoAssigns.length}>
          {autoAssigns.map((a, i) => (
            <div key={a.id || i} className="mb-2 flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs">
              <span><strong>{a.entity}</strong>.{a.field} &rarr; {a.strategy} ({(a.members || []).length} members)</span>
              <button onClick={() => deleteAutoAssign(a.id)} className="text-red-400 hover:text-red-600"><Trash2 className="h-3 w-3" /></button>
            </div>
          ))}
          <div className="mt-3 space-y-2 rounded-lg border border-gray-100 p-3">
            <select value={autoForm.entity} onChange={(e) => setAutoForm({ ...autoForm, entity: e.target.value })} className={selectClass}>
              {entities.map((en: string) => <option key={en} value={en}>{en}</option>)}
            </select>
            <TextInput value={autoForm.field} onChange={(v) => setAutoForm({ ...autoForm, field: v })} placeholder="Field to assign (e.g. assigned_to)" />
            <TextInput value={autoForm.members} onChange={(v) => setAutoForm({ ...autoForm, members: v })} placeholder="Team members (comma separated)" />
            <select value={autoForm.strategy} onChange={(e) => setAutoForm({ ...autoForm, strategy: e.target.value })} className={selectClass}>
              <option value="round_robin">Round Robin</option>
              <option value="random">Random</option>
              <option value="least_loaded">Least Loaded</option>
            </select>
            <button onClick={addAutoAssign} disabled={autoSaving} className="flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50">
              {autoSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Add Rule
            </button>
          </div>
        </Accordion>

        {/* Status Rules */}
        <Accordion title="Status Transition Rules" count={statusRules.length}>
          {statusRules.map((s, i) => (
            <div key={s.id || i} className="mb-2 flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs">
              <span><strong>{s.entity}</strong>.{s.field}: {s.from_status} &rarr; {s.to_status} after {s.after_days}d</span>
              <button onClick={() => deleteStatusRule(s.id)} className="text-red-400 hover:text-red-600"><Trash2 className="h-3 w-3" /></button>
            </div>
          ))}
          <div className="mt-3 space-y-2 rounded-lg border border-gray-100 p-3">
            <select value={statusForm.entity} onChange={(e) => setStatusForm({ ...statusForm, entity: e.target.value })} className={selectClass}>
              {entities.map((en: string) => <option key={en} value={en}>{en}</option>)}
            </select>
            <TextInput value={statusForm.field} onChange={(v) => setStatusForm({ ...statusForm, field: v })} placeholder="Status field name" />
            <div className="grid grid-cols-3 gap-2">
              <TextInput value={statusForm.from_status} onChange={(v) => setStatusForm({ ...statusForm, from_status: v })} placeholder="From status" />
              <TextInput value={statusForm.to_status} onChange={(v) => setStatusForm({ ...statusForm, to_status: v })} placeholder="To status" />
              <TextInput value={statusForm.after_days} onChange={(v) => setStatusForm({ ...statusForm, after_days: v })} placeholder="Days" type="number" />
            </div>
            <button onClick={addStatusRule} disabled={statusSaving} className="flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50">
              {statusSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Add Rule
            </button>
          </div>
        </Accordion>

        {/* Deadline Reminders */}
        <Accordion title="Deadline Reminders" count={reminders.length}>
          {reminders.map((r, i) => (
            <div key={r.id || i} className="mb-2 flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs">
              <span><strong>{r.entity}</strong>.{r.date_field} &rarr; remind {r.days_before}d before via {r.notify_field}</span>
              <button onClick={() => deleteReminder(r.id)} className="text-red-400 hover:text-red-600"><Trash2 className="h-3 w-3" /></button>
            </div>
          ))}
          <div className="mt-3 space-y-2 rounded-lg border border-gray-100 p-3">
            <select value={reminderForm.entity} onChange={(e) => setReminderForm({ ...reminderForm, entity: e.target.value })} className={selectClass}>
              {entities.map((en: string) => <option key={en} value={en}>{en}</option>)}
            </select>
            <div className="grid grid-cols-3 gap-2">
              <TextInput value={reminderForm.date_field} onChange={(v) => setReminderForm({ ...reminderForm, date_field: v })} placeholder="Date field" />
              <TextInput value={reminderForm.days_before} onChange={(v) => setReminderForm({ ...reminderForm, days_before: v })} placeholder="Days before" type="number" />
              <TextInput value={reminderForm.notify_field} onChange={(v) => setReminderForm({ ...reminderForm, notify_field: v })} placeholder="Notify field" />
            </div>
            <button onClick={addReminder} disabled={reminderSaving} className="flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50">
              {reminderSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Add Reminder
            </button>
          </div>
        </Accordion>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// 5. INTEGRATIONS
// ═══════════════════════════════════════════════════════════════
const INTEGRATION_CATALOG = [
  { key: "slack", name: "Slack", icon: "\u{1F4AC}", description: "Send notifications to Slack channels" },
  { key: "google_calendar", name: "Google Calendar", icon: "\u{1F4C5}", description: "Sync events with Google Calendar" },
  { key: "zoom", name: "Zoom", icon: "\u{1F4F9}", description: "Schedule Zoom meetings automatically" },
  { key: "google_sheets", name: "Google Sheets", icon: "\u{1F4CA}", description: "Export and sync data to Sheets" },
  { key: "stripe", name: "Stripe", icon: "\u{1F4B3}", description: "Accept payments via Stripe" },
  { key: "twilio", name: "Twilio", icon: "\u{1F4F1}", description: "Send SMS notifications" },
  { key: "sendgrid", name: "SendGrid", icon: "\u{1F4E7}", description: "Transactional email delivery" },
  { key: "zapier", name: "Zapier", icon: "\u26A1", description: "Connect to 5000+ apps via Zapier" },
  { key: "mailchimp", name: "Mailchimp", icon: "\u{1F412}", description: "Email marketing automation" },
  { key: "hubspot", name: "HubSpot", icon: "\u{1F9F2}", description: "CRM and marketing sync" },
  { key: "github", name: "GitHub", icon: "\u{1F419}", description: "Issue tracking and code sync" },
  { key: "jira", name: "Jira", icon: "\u{1F4CB}", description: "Project management sync" },
];

function IntegrationsSettings({
  projectId,
  showToast,
  projectBase,
}: {
  projectId: string;
  showToast: (type: "success" | "error", msg: string) => void;
  projectBase: string;
}) {
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [configForm, setConfigForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  const loadIntegrations = async () => {
    try {
      const data = await get<any[]>(`${projectBase}/integrations`);
      setIntegrations(data || []);
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { loadIntegrations(); }, [projectBase]);

  const isConnected = (key: string) => integrations.some((i) => i.provider === key && i.enabled);
  const getIntegration = (key: string) => integrations.find((i) => i.provider === key);

  const handleConfigure = (key: string) => {
    const existing = integrations.find((i) => i.provider === key);
    setConfigForm(existing?.config || { api_key: "", webhook_url: "" });
    setConfiguring(key);
  };

  const saveConfigure = async () => {
    if (!configuring) return;
    setSaving(true);
    try {
      await post(`${projectBase}/integrations`, { provider: configuring, enabled: true, config: configForm });
      await loadIntegrations();
      setConfiguring(null);
      showToast("success", "Integration configured");
    } catch {
      showToast("error", "Failed to configure integration");
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async (key: string) => {
    try {
      const integration = getIntegration(key);
      if (integration) {
        await del(`${projectBase}/integrations/${integration.id}`);
        await loadIntegrations();
        showToast("success", "Integration disconnected");
      }
    } catch {
      showToast("error", "Failed to disconnect");
    }
  };

  const testIntegration = async (key: string) => {
    const integration = getIntegration(key);
    if (!integration) return;
    setTesting(key);
    try {
      await post(`${projectBase}/integrations/${integration.id}/test`, {});
      showToast("success", `${INTEGRATION_CATALOG.find((i) => i.key === key)?.name} connection test passed`);
    } catch {
      showToast("error", "Connection test failed");
    } finally {
      setTesting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <>
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-black">Integrations</h2>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-400">Coming Soon</span>
        </div>
        <p className="text-xs text-gray-400">Connect third-party services to your app (only Slack is fully functional)</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {INTEGRATION_CATALOG.map((integ) => {
          const connected = isConnected(integ.key);
          return (
            <div
              key={integ.key}
              className={`rounded-xl border p-4 transition ${
                connected ? "border-green-200 bg-green-50/50" : "border-gray-200 bg-white"
              }`}
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{integ.icon}</span>
                  <span className="text-sm font-medium text-black">{integ.name}</span>
                </div>
                {connected ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">
                    Connected
                  </span>
                ) : integ.key !== "slack" ? (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-400">
                    Coming Soon
                  </span>
                ) : null}
              </div>
              <p className="mb-3 text-xs text-gray-500">{integ.description}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => handleConfigure(integ.key)}
                  className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-black transition hover:bg-gray-200"
                >
                  Configure
                </button>
                {connected && (
                  <>
                    <button
                      onClick={() => testIntegration(integ.key)}
                      disabled={testing === integ.key}
                      className="flex items-center gap-1 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-600 transition hover:bg-blue-100 disabled:opacity-50"
                    >
                      {testing === integ.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                      Test
                    </button>
                    <button
                      onClick={() => disconnect(integ.key)}
                      className="rounded-lg px-3 py-1.5 text-xs text-red-500 transition hover:bg-red-50"
                    >
                      Disconnect
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Config modal */}
      {configuring && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-[400px] rounded-xl border border-gray-200 bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-black">
                Configure {INTEGRATION_CATALOG.find((i) => i.key === configuring)?.name}
              </h3>
              <button onClick={() => setConfiguring(null)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-black">
                <X className="h-4 w-4" />
              </button>
            </div>
            <FormField label="API Key">
              <TextInput value={configForm.api_key || ""} onChange={(v) => setConfigForm({ ...configForm, api_key: v })} placeholder="Enter API key" />
            </FormField>
            <FormField label="Webhook URL" hint="Optional: URL for receiving events">
              <TextInput value={configForm.webhook_url || ""} onChange={(v) => setConfigForm({ ...configForm, webhook_url: v })} placeholder="https://..." />
            </FormField>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfiguring(null)} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
              <button onClick={saveConfigure} disabled={saving} className="flex items-center gap-1.5 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// 6. DATA
// ═══════════════════════════════════════════════════════════════
function DataSettings({
  projectId,
  spec,
  showToast,
  appBase,
}: {
  projectId: string;
  spec: any;
  showToast: (type: "success" | "error", msg: string) => void;
  appBase: string;
}) {
  const entities = spec?.entities?.map((e: any) => e.name) || [];
  const [importEntity, setImportEntity] = useState(entities[0] || "");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<any>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(true);
  const [creatingSnapshot, setCreatingSnapshot] = useState(false);
  const [restoringSnapshotId, setRestoringSnapshotId] = useState<string | null>(null);
  const [gdprEmail, setGdprEmail] = useState("");
  const [gdprAction, setGdprAction] = useState<"export" | "delete">("export");
  const [gdprLoading, setGdprLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await get<any[]>(`${appBase}/snapshots`);
        setSnapshots(data || []);
      } catch {}
      finally { setSnapshotsLoading(false); }
    })();
  }, [appBase]);

  const handleImportPreview = async () => {
    if (!importFile || !importEntity) return;
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      formData.append("entity", importEntity);
      const token = localStorage.getItem("token");
      const res = await fetch(`${import.meta.env.VITE_API_URL || "/api"}${appBase}/import/preview`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) throw new Error("Preview failed");
      const preview = await res.json();
      setImportPreview(preview);
      showToast("success", `Preview ready: ${preview.row_count || 0} rows detected`);
    } catch {
      showToast("error", "Import preview failed");
    } finally {
      setImporting(false);
    }
  };

  const handleImportExecute = async () => {
    if (!importPreview) return;
    setImporting(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${import.meta.env.VITE_API_URL || "/api"}${appBase}/import/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ entity: importEntity, preview_id: importPreview.id || importPreview.preview_id }),
      });
      if (!res.ok) throw new Error("Import failed");
      setImportFile(null);
      setImportPreview(null);
      showToast("success", `Imported data to ${importEntity}`);
    } catch {
      showToast("error", "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const handleExport = async (entity: string, format: "csv" | "excel") => {
    setExporting(entity);
    try {
      const token = localStorage.getItem("token");
      const endpoint = format === "excel" ? "export/excel" : "export";
      const res = await fetch(`${import.meta.env.VITE_API_URL || "/api"}${appBase}/data/${entity}/${endpoint}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${entity}.${format === "excel" ? "xlsx" : "csv"}`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("success", `Exported ${entity}`);
    } catch {
      showToast("error", "Export failed");
    } finally {
      setExporting(null);
    }
  };

  const createSnapshot = async () => {
    setCreatingSnapshot(true);
    try {
      await post(`${appBase}/snapshots`, {});
      const data = await get<any[]>(`${appBase}/snapshots`);
      setSnapshots(data || []);
      showToast("success", "Snapshot created");
    } catch {
      showToast("error", "Failed to create snapshot");
    } finally {
      setCreatingSnapshot(false);
    }
  };

  const restoreSnapshot = async (snapshotId: string) => {
    setRestoringSnapshotId(snapshotId);
    try {
      await post(`${appBase}/snapshots/${snapshotId}/restore`, {});
      showToast("success", "Snapshot restored successfully");
    } catch {
      showToast("error", "Failed to restore snapshot");
    } finally {
      setRestoringSnapshotId(null);
    }
  };

  const handleGdpr = async () => {
    if (!gdprEmail.trim()) return;
    setGdprLoading(true);
    try {
      await post(`${appBase}/gdpr/${gdprAction}`, { email: gdprEmail.trim() });
      showToast("success", `GDPR ${gdprAction} request processed`);
      setGdprEmail("");
    } catch {
      showToast("error", `GDPR ${gdprAction} failed`);
    } finally {
      setGdprLoading(false);
    }
  };

  const selectClass = "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-black focus:border-pink-400 focus:outline-none focus:ring-1 focus:ring-pink-400";

  return (
    <>
      <div className="mb-2">
        <h2 className="text-lg font-semibold text-black">Data</h2>
        <p className="text-xs text-gray-400">Import, export, backup, and manage your data</p>
      </div>

      {/* Import */}
      <SectionCard title="Import Data">
        <FormField label="Target Entity">
          <select value={importEntity} onChange={(e) => { setImportEntity(e.target.value); setImportPreview(null); }} className={selectClass}>
            {entities.map((en: string) => <option key={en} value={en}>{en}</option>)}
          </select>
        </FormField>
        <FormField label="CSV File" hint="Upload a CSV file with headers matching field names">
          <input
            type="file"
            accept=".csv"
            onChange={(e) => { setImportFile(e.target.files?.[0] || null); setImportPreview(null); }}
            className="w-full text-sm text-gray-500 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-xs file:font-medium file:text-black hover:file:bg-gray-200"
          />
        </FormField>
        {importPreview && (
          <div className="mb-3 rounded-lg border border-green-200 bg-green-50 p-3">
            <p className="text-xs font-medium text-green-700">Preview: {importPreview.row_count || 0} rows, {importPreview.column_count || 0} columns detected</p>
            {importPreview.columns && (
              <p className="mt-1 text-[11px] text-green-600">Columns: {importPreview.columns.join(", ")}</p>
            )}
          </div>
        )}
        <div className="flex gap-2">
          {!importPreview ? (
            <button
              onClick={handleImportPreview}
              disabled={importing || !importFile}
              className="flex items-center gap-1.5 rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
            >
              {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {importing ? "Previewing..." : "Preview Import"}
            </button>
          ) : (
            <button
              onClick={handleImportExecute}
              disabled={importing}
              className="flex items-center gap-1.5 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {importing ? "Importing..." : "Confirm Import"}
            </button>
          )}
        </div>
      </SectionCard>

      {/* Export */}
      <SectionCard title="Export Data">
        <div className="space-y-2">
          {entities.map((entity: string) => (
            <div key={entity} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2.5">
              <span className="text-sm font-medium text-black">{entity}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => handleExport(entity, "csv")}
                  disabled={exporting === entity}
                  className="flex items-center gap-1 rounded-md bg-white border border-gray-200 px-2.5 py-1 text-xs text-black hover:bg-gray-100 disabled:opacity-50"
                >
                  <Download className="h-3 w-3" /> CSV
                </button>
                <button
                  onClick={() => handleExport(entity, "excel")}
                  disabled={exporting === entity}
                  className="flex items-center gap-1 rounded-md bg-white border border-gray-200 px-2.5 py-1 text-xs text-black hover:bg-gray-100 disabled:opacity-50"
                >
                  <Download className="h-3 w-3" /> Excel
                </button>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Snapshots */}
      <SectionCard title="Snapshots">
        <div className="mb-3 flex justify-end">
          <button
            onClick={createSnapshot}
            disabled={creatingSnapshot}
            className="flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {creatingSnapshot ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Create Snapshot
          </button>
        </div>
        {snapshotsLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-gray-400" /></div>
        ) : snapshots.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 py-8 text-center">
            <Database className="mx-auto mb-2 h-6 w-6 text-gray-300" />
            <p className="text-xs text-gray-400">No snapshots yet</p>
          </div>
        ) : (
          <div className="space-y-1">
            {snapshots.map((s, i) => (
              <div key={s.id || i} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs">
                <div>
                  <span className="font-medium text-black">{s.name || `Snapshot ${i + 1}`}</span>
                  <span className="ml-2 text-gray-400">{new Date(s.created_at).toLocaleString()}</span>
                </div>
                <button
                  onClick={() => restoreSnapshot(s.id)}
                  disabled={restoringSnapshotId === s.id}
                  className="flex items-center gap-1 text-pink-500 hover:text-pink-700 text-xs disabled:opacity-50"
                >
                  {restoringSnapshotId === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* GDPR */}
      <SectionCard title="GDPR Compliance">
        <FormField label="User Email">
          <TextInput value={gdprEmail} onChange={setGdprEmail} placeholder="user@example.com" type="email" />
        </FormField>
        <div className="mb-4 flex gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={gdprAction === "export"} onChange={() => setGdprAction("export")} className="text-pink-500" />
            Export user data
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={gdprAction === "delete"} onChange={() => setGdprAction("delete")} className="text-pink-500" />
            Delete user data
          </label>
        </div>
        <button
          onClick={handleGdpr}
          disabled={gdprLoading || !gdprEmail.trim()}
          className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
            gdprAction === "delete" ? "bg-red-600 hover:bg-red-700" : "bg-black hover:bg-gray-800"
          }`}
        >
          {gdprLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : gdprAction === "delete" ? <Trash2 className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
          {gdprAction === "delete" ? "Delete Data" : "Export Data"}
        </button>
      </SectionCard>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// 7. SECURITY
// ═══════════════════════════════════════════════════════════════
function SecuritySettings({
  projectId,
  showToast,
  projectBase,
  appBase,
}: {
  projectId: string;
  showToast: (type: "success" | "error", msg: string) => void;
  projectBase: string;
  appBase: string;
}) {
  const [ipWhitelistEnabled, setIpWhitelistEnabled] = useState(false);
  const [ipList, setIpList] = useState("");
  const [ipSaving, setIpSaving] = useState(false);
  const [ipUnavailable, setIpUnavailable] = useState(false);
  const [twoFaEnabled, setTwoFaEnabled] = useState(false);
  const [twoFaSaving, setTwoFaSaving] = useState(false);
  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [encryptionEnabled, setEncryptionEnabled] = useState(false);
  const [encryptionFields, setEncryptionFields] = useState<any[]>([]);
  const [encryptionEntity, setEncryptionEntity] = useState("");
  const [encryptionField, setEncryptionField] = useState("");
  const [encryptionSaving, setEncryptionSaving] = useState(false);
  const [encryptionUnavailable, setEncryptionUnavailable] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      // IP Whitelist: GET /projects/{projectId}/ip-whitelist
      {
        const { data, unavailable } = await safeFetch(
          () => get<any>(`${projectBase}/ip-whitelist`),
          null
        );
        setIpUnavailable(unavailable);
        if (data) {
          setIpWhitelistEnabled(data.enabled || false);
          setIpList((data.ips || []).join("\n"));
        }
      }
      // Encryption: GET /projects/{projectId}/encryption
      {
        const { data, unavailable } = await safeFetch(
          () => get<any>(`${projectBase}/encryption`),
          null
        );
        setEncryptionUnavailable(unavailable);
        if (data) {
          setEncryptionEnabled(data.enabled || false);
          setEncryptionFields(data.fields || []);
        }
      }
      // 2FA
      try {
        const tfa = await get<any>(`${appBase}/2fa/status`);
        setTwoFaEnabled(tfa?.enabled || false);
      } catch {}
      // Sessions: GET /apps/{projectId}/sessions
      try {
        const sess = await get<any[]>(`${appBase}/sessions`);
        setSessions(sess || []);
      } catch {}
      setSessionsLoading(false);
      setLoaded(true);
    })();
  }, [projectBase, appBase]);

  const saveIpWhitelist = async () => {
    setIpSaving(true);
    try {
      const ips = ipList.split("\n").map((ip) => ip.trim()).filter(Boolean);
      await put(`${projectBase}/ip-whitelist`, { enabled: ipWhitelistEnabled, ips });
      showToast("success", "IP whitelist saved");
    } catch {
      showToast("error", "Failed to save IP whitelist");
    } finally {
      setIpSaving(false);
    }
  };

  const saveEncryption = async () => {
    setEncryptionSaving(true);
    try {
      const fields = encryptionEntity && encryptionField
        ? [...encryptionFields, { entity: encryptionEntity, field: encryptionField }]
        : encryptionFields;
      await put(`${projectBase}/encryption`, { enabled: encryptionEnabled, fields });
      setEncryptionFields(fields);
      setEncryptionEntity("");
      setEncryptionField("");
      showToast("success", "Encryption settings saved");
    } catch {
      showToast("error", "Failed to save encryption settings");
    } finally {
      setEncryptionSaving(false);
    }
  };

  const toggle2fa = async () => {
    setTwoFaSaving(true);
    try {
      await post(`${appBase}/2fa/${twoFaEnabled ? "disable" : "enable"}`, {});
      setTwoFaEnabled(!twoFaEnabled);
      showToast("success", `2FA ${twoFaEnabled ? "disabled" : "enabled"}`);
    } catch {
      showToast("error", "Failed to update 2FA");
    } finally {
      setTwoFaSaving(false);
    }
  };

  const revokeSession = async (sessionId: string) => {
    try {
      await del(`${appBase}/sessions/${sessionId}`);
      setSessions((s) => s.filter((x) => x.id !== sessionId));
      showToast("success", "Session revoked");
    } catch {
      showToast("error", "Failed to revoke session");
    }
  };

  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <>
      <div className="mb-2">
        <h2 className="text-lg font-semibold text-black">Security</h2>
        <p className="text-xs text-gray-400">Protect your app and user data</p>
      </div>

      {/* IP Whitelist */}
      <SectionCard title="IP Whitelist" saving={ipSaving} onSave={saveIpWhitelist} unavailable={ipUnavailable}>
        <Toggle checked={ipWhitelistEnabled} onChange={setIpWhitelistEnabled} label="Enable IP Whitelist" />
        {ipWhitelistEnabled && (
          <FormField label="Allowed IPs" hint="One IP address per line">
            <textarea
              value={ipList}
              onChange={(e) => setIpList(e.target.value)}
              placeholder="192.168.1.1&#10;10.0.0.0/24"
              rows={4}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-xs text-black placeholder-gray-400 focus:border-pink-400 focus:outline-none focus:ring-1 focus:ring-pink-400"
            />
          </FormField>
        )}
      </SectionCard>

      {/* Field Encryption */}
      <SectionCard title="Field Encryption" saving={encryptionSaving} onSave={saveEncryption} unavailable={encryptionUnavailable}>
        <p className="mb-3 text-xs text-gray-500">Encrypt sensitive fields at rest in the database.</p>
        <Toggle checked={encryptionEnabled} onChange={setEncryptionEnabled} label="Enable field encryption" />
        {encryptionFields.length > 0 && (
          <div className="mb-3 space-y-1">
            {encryptionFields.map((ef, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs">
                <span><strong>{ef.entity}</strong>.{ef.field}</span>
                <button
                  onClick={() => setEncryptionFields((f) => f.filter((_, idx) => idx !== i))}
                  className="text-red-400 hover:text-red-600"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <FormField label="Entity">
            <TextInput value={encryptionEntity} onChange={setEncryptionEntity} placeholder="e.g. Customer" />
          </FormField>
          <FormField label="Field">
            <TextInput value={encryptionField} onChange={setEncryptionField} placeholder="e.g. ssn" />
          </FormField>
        </div>
      </SectionCard>

      {/* 2FA */}
      <SectionCard title="Two-Factor Authentication">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-black">Require 2FA for all users</p>
            <p className="mt-0.5 text-xs text-gray-400">Users will need to verify with a TOTP app</p>
          </div>
          <button
            onClick={toggle2fa}
            disabled={twoFaSaving}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              twoFaEnabled
                ? "bg-red-50 text-red-600 hover:bg-red-100"
                : "bg-green-50 text-green-700 hover:bg-green-100"
            }`}
          >
            {twoFaSaving ? <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> : twoFaEnabled ? "Disable" : "Enable"}
          </button>
        </div>
      </SectionCard>

      {/* Sessions */}
      <SectionCard title="Active Sessions">
        {sessionsLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-gray-400" /></div>
        ) : sessions.length === 0 ? (
          <p className="py-4 text-center text-xs text-gray-400">No active sessions found</p>
        ) : (
          <div className="space-y-1">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2.5">
                <div>
                  <p className="text-xs font-medium text-black">{s.user_agent || "Unknown device"}</p>
                  <p className="text-[11px] text-gray-400">{s.ip_address} - {new Date(s.created_at).toLocaleString()}</p>
                </div>
                <button
                  onClick={() => revokeSession(s.id)}
                  className="rounded-md px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// 8. VIEWS
// ═══════════════════════════════════════════════════════════════
const VIEW_TYPES = [
  { id: "table", label: "Table", icon: "\u{1F4CB}" },
  { id: "kanban", label: "Kanban", icon: "\u{1F4CA}" },
  { id: "calendar", label: "Calendar", icon: "\u{1F4C5}" },
  { id: "gantt", label: "Gantt Chart", icon: "\u{1F4C8}" },
  { id: "map", label: "Map", icon: "\u{1F5FA}\uFE0F" },
  { id: "gallery", label: "Gallery", icon: "\u{1F5BC}\uFE0F" },
  { id: "timeline", label: "Timeline", icon: "\u231B" },
  { id: "chart", label: "Chart", icon: "\u{1F4C9}" },
];

function ViewsSettings({
  projectId,
  spec,
  showToast,
  projectBase,
}: {
  projectId: string;
  spec: any;
  showToast: (type: "success" | "error", msg: string) => void;
  projectBase: string;
}) {
  const entities = spec?.entities || [];
  const [selectedEntity, setSelectedEntity] = useState(entities[0]?.name || "");
  const [viewConfigs, setViewConfigs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingView, setEditingView] = useState<string | null>(null);
  const [viewConfig, setViewConfig] = useState<Record<string, string>>({});

  const selectedEntityObj = entities.find((e: any) => e.name === selectedEntity);
  const fields = selectedEntityObj?.fields?.map((f: any) => f.name) || [];

  const loadViews = async () => {
    try {
      const data = await get<any[]>(`${projectBase}/views`);
      setViewConfigs(data || []);
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { loadViews(); }, [projectBase]);

  const entityViews = viewConfigs.filter((v) => v.entity === selectedEntity);

  const addView = async (viewType: string) => {
    setSaving(true);
    try {
      await post(`${projectBase}/views`, {
        entity: selectedEntity,
        view_type: viewType,
        config: {},
      });
      await loadViews();
      showToast("success", `${viewType} view added for ${selectedEntity}`);
    } catch {
      showToast("error", "Failed to add view");
    } finally {
      setSaving(false);
    }
  };

  const saveViewConfig = async (viewId: string) => {
    setSaving(true);
    try {
      await put(`${projectBase}/views/${viewId}`, { config: viewConfig });
      await loadViews();
      setEditingView(null);
      showToast("success", "View configuration saved");
    } catch {
      showToast("error", "Failed to save view config");
    } finally {
      setSaving(false);
    }
  };

  const deleteView = async (viewId: string) => {
    try {
      await del(`${projectBase}/views/${viewId}`);
      await loadViews();
      showToast("success", "View removed");
    } catch {
      showToast("error", "Failed to remove view");
    }
  };

  const selectClass = "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-black focus:border-pink-400 focus:outline-none focus:ring-1 focus:ring-pink-400";

  return (
    <>
      <div className="mb-2">
        <h2 className="text-lg font-semibold text-black">Views</h2>
        <p className="text-xs text-gray-400">Configure custom view types per entity</p>
      </div>

      {/* Entity selector */}
      <SectionCard title="Select Entity">
        <select value={selectedEntity} onChange={(e) => setSelectedEntity(e.target.value)} className={selectClass}>
          {entities.map((e: any) => <option key={e.name} value={e.name}>{e.name}</option>)}
        </select>
      </SectionCard>

      {/* Active views for entity */}
      {selectedEntity && (
        <SectionCard title={`Views for ${selectedEntity}`}>
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-gray-400" /></div>
          ) : entityViews.length === 0 ? (
            <p className="py-4 text-center text-xs text-gray-400">No custom views configured. Add one below.</p>
          ) : (
            <div className="space-y-2">
              {entityViews.map((v) => (
                <div key={v.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span>{VIEW_TYPES.find((vt) => vt.id === v.view_type)?.icon || "\u{1F4CB}"}</span>
                      <span className="text-sm font-medium text-black capitalize">{v.view_type}</span>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          setEditingView(v.id);
                          setViewConfig(v.config || {});
                        }}
                        className="rounded-md p-1.5 text-gray-400 hover:bg-gray-200 hover:text-black"
                      >
                        <Settings className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => deleteView(v.id)}
                        className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Config editor */}
                  {editingView === v.id && (
                    <div className="mt-3 space-y-2 border-t border-gray-200 pt-3">
                      {v.view_type === "kanban" && (
                        <FormField label="Group By Field">
                          <select value={viewConfig.group_by || ""} onChange={(e) => setViewConfig({ ...viewConfig, group_by: e.target.value })} className={selectClass}>
                            <option value="">Select field...</option>
                            {fields.map((f: string) => <option key={f} value={f}>{f}</option>)}
                          </select>
                        </FormField>
                      )}
                      {v.view_type === "calendar" && (
                        <FormField label="Date Field">
                          <select value={viewConfig.date_field || ""} onChange={(e) => setViewConfig({ ...viewConfig, date_field: e.target.value })} className={selectClass}>
                            <option value="">Select field...</option>
                            {fields.map((f: string) => <option key={f} value={f}>{f}</option>)}
                          </select>
                        </FormField>
                      )}
                      {v.view_type === "gantt" && (
                        <>
                          <FormField label="Start Date Field">
                            <select value={viewConfig.start_field || ""} onChange={(e) => setViewConfig({ ...viewConfig, start_field: e.target.value })} className={selectClass}>
                              <option value="">Select field...</option>
                              {fields.map((f: string) => <option key={f} value={f}>{f}</option>)}
                            </select>
                          </FormField>
                          <FormField label="End Date Field">
                            <select value={viewConfig.end_field || ""} onChange={(e) => setViewConfig({ ...viewConfig, end_field: e.target.value })} className={selectClass}>
                              <option value="">Select field...</option>
                              {fields.map((f: string) => <option key={f} value={f}>{f}</option>)}
                            </select>
                          </FormField>
                        </>
                      )}
                      {v.view_type === "map" && (
                        <>
                          <FormField label="Latitude Field">
                            <select value={viewConfig.lat_field || ""} onChange={(e) => setViewConfig({ ...viewConfig, lat_field: e.target.value })} className={selectClass}>
                              <option value="">Select field...</option>
                              {fields.map((f: string) => <option key={f} value={f}>{f}</option>)}
                            </select>
                          </FormField>
                          <FormField label="Longitude Field">
                            <select value={viewConfig.lng_field || ""} onChange={(e) => setViewConfig({ ...viewConfig, lng_field: e.target.value })} className={selectClass}>
                              <option value="">Select field...</option>
                              {fields.map((f: string) => <option key={f} value={f}>{f}</option>)}
                            </select>
                          </FormField>
                        </>
                      )}
                      {(v.view_type === "table" || v.view_type === "gallery" || v.view_type === "timeline" || v.view_type === "chart") && (
                        <FormField label="Title Field">
                          <select value={viewConfig.title_field || ""} onChange={(e) => setViewConfig({ ...viewConfig, title_field: e.target.value })} className={selectClass}>
                            <option value="">Select field...</option>
                            {fields.map((f: string) => <option key={f} value={f}>{f}</option>)}
                          </select>
                        </FormField>
                      )}
                      <button
                        onClick={() => saveViewConfig(v.id)}
                        disabled={saving}
                        className="flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                      >
                        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        Save Config
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* Add view */}
      {selectedEntity && (
        <SectionCard title="Add View">
          <div className="grid grid-cols-4 gap-2">
            {VIEW_TYPES.map((vt) => {
              const alreadyAdded = entityViews.some((v) => v.view_type === vt.id);
              return (
                <button
                  key={vt.id}
                  onClick={() => !alreadyAdded && addView(vt.id)}
                  disabled={alreadyAdded || saving}
                  className={`flex flex-col items-center gap-1 rounded-lg border p-3 text-center transition ${
                    alreadyAdded
                      ? "border-green-200 bg-green-50 opacity-60"
                      : "border-gray-200 hover:border-pink-300 hover:bg-pink-50"
                  }`}
                >
                  <span className="text-lg">{vt.icon}</span>
                  <span className="text-[11px] font-medium text-black">{vt.label}</span>
                  {alreadyAdded && <Check className="h-3 w-3 text-green-500" />}
                </button>
              );
            })}
          </div>
        </SectionCard>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// 9. ADVANCED
// ═══════════════════════════════════════════════════════════════
function AdvancedSettings({
  projectId,
  spec,
  showToast,
  projectBase,
  appBase,
}: {
  projectId: string;
  spec: any;
  showToast: (type: "success" | "error", msg: string) => void;
  projectBase: string;
  appBase: string;
}) {
  const [subdomain, setSubdomain] = useState("");
  const [subdomainSaving, setSubdomainSaving] = useState(false);
  const [whiteLabelName, setWhiteLabelName] = useState("");
  const [whiteLabelDomain, setWhiteLabelDomain] = useState("");
  const [whiteLabelSaving, setWhiteLabelSaving] = useState(false);
  const [whiteLabelUnavailable, setWhiteLabelUnavailable] = useState(false);
  const [embeds, setEmbeds] = useState<any[]>([]);
  const [embedName, setEmbedName] = useState("");
  const [embedEntity, setEmbedEntity] = useState("");
  const [embedSaving, setEmbedSaving] = useState(false);
  const [versions, setVersions] = useState<any[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  const [loading, setLoading] = useState(true);

  const entities = spec?.entities?.map((e: any) => e.name) || [];

  useEffect(() => {
    (async () => {
      // Subdomain: GET /projects/{projectId}/subdomain
      try { const d = await get<any>(`${projectBase}/subdomain`); setSubdomain(d?.subdomain || ""); } catch {}
      // White-label: GET /projects/{projectId}/white-label
      {
        const { data, unavailable } = await safeFetch(
          () => get<any>(`${projectBase}/white-label`),
          null
        );
        setWhiteLabelUnavailable(unavailable);
        if (data) {
          setWhiteLabelName(data.brand_name || data.name || "");
          setWhiteLabelDomain(data.custom_domain || "");
        }
      }
      // Embeds: GET /projects/{projectId}/embeds
      try { const d = await get<any[]>(`${projectBase}/embeds`); setEmbeds(d || []); } catch {}
      // Versions: GET /projects/{projectId}/versions
      try {
        const d = await get<any[]>(`${projectBase}/versions`);
        setVersions(d || []);
      } catch {}
      setVersionsLoading(false);
      setLoading(false);
    })();
  }, [projectBase]);

  const saveSubdomain = async () => {
    setSubdomainSaving(true);
    try {
      await post(`${projectBase}/subdomain`, { subdomain: subdomain.trim() });
      showToast("success", "Subdomain saved");
    } catch {
      showToast("error", "Failed to save subdomain");
    } finally {
      setSubdomainSaving(false);
    }
  };

  const saveWhiteLabel = async () => {
    setWhiteLabelSaving(true);
    try {
      await put(`${projectBase}/white-label`, {
        brand_name: whiteLabelName.trim(),
        custom_domain: whiteLabelDomain.trim(),
        hide_powered_by: true,
      });
      showToast("success", "White-label settings saved");
    } catch {
      showToast("error", "Failed to save white-label settings");
    } finally {
      setWhiteLabelSaving(false);
    }
  };

  const addEmbed = async () => {
    if (!embedName.trim() || !embedEntity) return;
    setEmbedSaving(true);
    try {
      await post(`${projectBase}/embeds`, { name: embedName.trim(), entity: embedEntity });
      const d = await get<any[]>(`${projectBase}/embeds`);
      setEmbeds(d || []);
      setEmbedName("");
      setEmbedEntity("");
      showToast("success", "Embeddable widget created");
    } catch {
      showToast("error", "Failed to create widget");
    } finally {
      setEmbedSaving(false);
    }
  };

  const deleteEmbed = async (embedId: string) => {
    try {
      await del(`${projectBase}/embeds/${embedId}`);
      const d = await get<any[]>(`${projectBase}/embeds`);
      setEmbeds(d || []);
      showToast("success", "Widget deleted");
    } catch {
      showToast("error", "Failed to delete widget");
    }
  };

  const restoreVersion = async (versionId: string) => {
    setRestoringId(versionId);
    try {
      await post(`${projectBase}/versions/${versionId}/restore`, {});
      showToast("success", "Version restored");
      const d = await get<any[]>(`${projectBase}/versions`);
      setVersions(d || []);
    } catch {
      showToast("error", "Failed to restore version");
    } finally {
      setRestoringId(null);
    }
  };

  const handleRollback = async () => {
    if (!confirm("Are you sure you want to rollback? This will revert to the previous version.")) return;
    setRollingBack(true);
    try {
      await post(`${projectBase}/rollback`, {});
      showToast("success", "Rollback successful");
      // Reload versions
      const d = await get<any[]>(`${projectBase}/versions`);
      setVersions(d || []);
    } catch {
      showToast("error", "Rollback failed");
    } finally {
      setRollingBack(false);
    }
  };

  const selectClass = "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-black focus:border-pink-400 focus:outline-none focus:ring-1 focus:ring-pink-400";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <>
      <div className="mb-2">
        <h2 className="text-lg font-semibold text-black">Advanced</h2>
        <p className="text-xs text-gray-400">Power-user features and configuration</p>
      </div>

      {/* Custom Subdomain */}
      <SectionCard title="Custom Subdomain" saving={subdomainSaving} onSave={saveSubdomain}>
        <FormField label="Subdomain" hint="Your app will be available at {subdomain}.isibi.ai">
          <div className="flex items-center gap-2">
            <TextInput value={subdomain} onChange={setSubdomain} placeholder="my-app" />
            <span className="shrink-0 text-sm text-gray-400">.isibi.ai</span>
          </div>
        </FormField>
      </SectionCard>

      {/* White Label */}
      <SectionCard title="White Label" saving={whiteLabelSaving} onSave={saveWhiteLabel} unavailable={whiteLabelUnavailable}>
        <FormField label="App Brand Name" hint="Replace isibi.ai branding with your own">
          <TextInput value={whiteLabelName} onChange={setWhiteLabelName} placeholder="Your Brand Name" />
        </FormField>
        <FormField label="Custom Domain" hint="Point your domain to this app. Add a CNAME record to isibi-backend.onrender.com, then verify.">
          <TextInput value={whiteLabelDomain} onChange={setWhiteLabelDomain} placeholder="app.yourdomain.com" />
        </FormField>
      </SectionCard>

      {/* Embeddable Widgets */}
      <SectionCard title="Embeddable Widgets">
        {embeds.length > 0 && (
          <div className="mb-3 space-y-2">
            {embeds.map((e, i) => (
              <div key={e.id || i} className="rounded-lg bg-gray-50 px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-black">{e.name}</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`<iframe src="${window.location.origin}/embed/${e.id}" width="100%" height="500"></iframe>`);
                        showToast("success", "Embed code copied");
                      }}
                      className="flex items-center gap-1 text-xs text-pink-500 hover:text-pink-700"
                    >
                      <Copy className="h-3 w-3" /> Copy
                    </button>
                    <button
                      onClick={() => deleteEmbed(e.id)}
                      className="text-red-400 hover:text-red-600"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                <p className="mt-0.5 text-[11px] text-gray-400">Entity: {e.entity}</p>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-2 rounded-lg border border-gray-100 p-3">
          <TextInput value={embedName} onChange={setEmbedName} placeholder="Widget name" />
          <select value={embedEntity} onChange={(e) => setEmbedEntity(e.target.value)} className={selectClass}>
            <option value="">Select entity...</option>
            {entities.map((en: string) => <option key={en} value={en}>{en}</option>)}
          </select>
          <button
            onClick={addEmbed}
            disabled={embedSaving || !embedName.trim() || !embedEntity}
            className="flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {embedSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Create Widget
          </button>
        </div>
      </SectionCard>

      {/* API Docs */}
      <SectionCard title="API Documentation">
        <p className="mb-3 text-xs text-gray-500">
          View the auto-generated API documentation for your app's endpoints.
        </p>
        <a
          href={`${import.meta.env.VITE_API_URL || "/api"}${appBase}/docs/html`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-black transition hover:bg-gray-200"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open API Docs
        </a>
      </SectionCard>

      {/* Rollback */}
      <SectionCard title="Rollback">
        <p className="mb-3 text-xs text-gray-500">Revert your app to the previous version. This action can be undone by restoring a specific version below.</p>
        <button
          onClick={handleRollback}
          disabled={rollingBack}
          className="flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {rollingBack ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {rollingBack ? "Rolling back..." : "Rollback to Previous Version"}
        </button>
      </SectionCard>

      {/* Version History */}
      <SectionCard title="Version History">
        {versionsLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-gray-400" /></div>
        ) : versions.length === 0 ? (
          <p className="py-4 text-center text-xs text-gray-400">No versions yet. Versions are created on each build or refinement.</p>
        ) : (
          <div className="space-y-1">
            {versions.map((v) => (
              <div key={v.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2.5">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-bold text-gray-600">v{v.version_number}</span>
                    <span className="text-xs font-medium text-black">{v.change_description || `Version ${v.version_number}`}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-gray-400">{new Date(v.created_at).toLocaleString()}</p>
                </div>
                <button
                  onClick={() => restoreVersion(v.id)}
                  disabled={restoringId === v.id}
                  className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-pink-600 hover:bg-pink-50 disabled:opacity-50"
                >
                  {restoringId === v.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </>
  );
}
