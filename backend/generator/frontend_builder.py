"""
Generate a complete React + Vite + Tailwind frontend project from a spec.

Produces a real, runnable React project — not a monolithic HTML file.
Each entity gets its own page, table, and form components.
The generated project works with `npm install && npm run dev`.
"""
import os
import re
import json
import logging

logger = logging.getLogger(__name__)


# ── Helpers ──────────────────────────────────────────────────────────

def _write(base_dir: str, rel_path: str, content: str):
    """Write a file, creating parent dirs as needed."""
    full = os.path.join(base_dir, rel_path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        f.write(content)


def _snake(name: str) -> str:
    """PascalCase -> snake_case."""
    if not name:
        return "unknown"
    return re.sub(r"(?<!^)(?=[A-Z])", "_", str(name)).lower()


def _field_input_type(field: dict) -> str:
    """Map a spec field to an HTML input type."""
    # Check input_component hint first
    ic = field.get("input_component", "")
    if ic == "checkbox":
        return "checkbox"
    if ic == "textarea":
        return "textarea"
    if ic in ("select", "relation_select"):
        return "select"
    if ic == "number_input":
        return "number"
    if ic == "date_input":
        return "date"

    db = field.get("db_type", "TEXT")
    if db in ("INTEGER", "SMALLINT") or db.startswith("NUMERIC"):
        return "number"
    if db == "DATE":
        return "date"
    if db == "TIMESTAMPTZ":
        return "datetime-local"
    if db.startswith("BOOLEAN"):
        return "checkbox"
    if db == "TEXT":
        return "textarea"
    if db.startswith("ENUM"):
        return "select"
    if field.get("enum_values"):
        return "select"
    return "text"


def _is_boolean_field(field: dict) -> bool:
    """Check if a field is boolean regardless of DEFAULT clause."""
    return field.get("db_type", "").startswith("BOOLEAN") or field.get("input_component") == "checkbox"


def _is_numeric_field(field: dict) -> bool:
    """Check if a field is numeric regardless of precision."""
    db = field.get("db_type", "")
    return db.startswith("NUMERIC") or db in ("INTEGER", "SMALLINT") or field.get("input_component") == "number_input"


def _is_enum_field(field: dict) -> bool:
    """Check if a field should render as an enum badge."""
    return bool(field.get("enum_values")) or field.get("db_type", "").startswith("ENUM")


def _is_date_field(field: dict) -> bool:
    """Check if a field is a date type."""
    return field.get("db_type", "") in ("DATE",) or field.get("input_component") == "date_input"


def _is_fk_field(field: dict) -> bool:
    """Check if a field is a foreign key relation."""
    return field.get("input_component") == "relation_select" or bool(field.get("fk_entity"))


def _visible_fields(entity: dict, context: str = "table") -> list[dict]:
    """Return fields that should appear in a given context."""
    fields = entity.get("fields", [])
    # System fields that are hidden unless explicitly shown
    auto_hidden = {"id", "org_id", "updated_at", "deleted_at"}
    out = []
    for f in fields:
        fname = f.get("name", "")
        if f.get("primary_key"):
            continue
        # Skip auto-hidden fields unless explicitly shown
        if fname in auto_hidden:
            continue
        # created_at is hidden by default but can be explicitly shown
        if fname == "created_at":
            if context == "table" and f.get("show_in_table") is not True:
                continue
            if context == "form" and f.get("show_in_form") is not True:
                continue
        if context == "table" and f.get("show_in_table") is False:
            continue
        if context == "form" and f.get("show_in_form") is False:
            continue
        out.append(f)
    return out


# ── Main entry point ─────────────────────────────────────────────────

def build_frontend(spec: dict, output_dir: str):
    """Generate a complete React + Vite + Tailwind frontend."""
    os.makedirs(output_dir, exist_ok=True)

    app_name = spec.get("app_name", spec.get("name", "My App"))
    entities = spec.get("entities", [])
    modules = spec.get("modules", [])
    design = spec.get("design_system", {})
    primary = design.get("colors", {}).get("primary", "#ec4899")

    # Root config files
    _write(output_dir, "package.json", _gen_package_json(app_name))
    _write(output_dir, "vite.config.ts", _gen_vite_config())
    _write(output_dir, "tailwind.config.js", _gen_tailwind_config(primary))
    _write(output_dir, "tsconfig.json", _gen_tsconfig())
    _write(output_dir, "index.html", _gen_index_html(app_name))
    _write(output_dir, "postcss.config.js",
           "export default { plugins: { tailwindcss: {}, autoprefixer: {} } };\n")

    # Source files
    src = os.path.join(output_dir, "src")
    _write(src, "main.tsx", _gen_main_tsx())
    _write(src, "index.css", _gen_index_css())
    _write(src, "App.tsx", _gen_app_tsx(entities, modules, app_name))
    _write(src, "api.ts", _gen_api_client())

    # Layout
    _write(src, "components/Layout.tsx", _gen_layout(app_name, modules, primary))

    # Dashboard
    _write(src, "pages/Dashboard.tsx", _gen_dashboard(entities))

    # Per-entity pages + components
    for entity in entities:
        name = entity.get("name", "Entity")
        _write(src, f"pages/{name}Page.tsx", _gen_entity_page(entity))
        _write(src, f"components/{name}Form.tsx", _gen_entity_form(entity))
        _write(src, f"components/{name}Table.tsx", _gen_entity_table(entity))

    total_files = 2 + len(entities) * 3  # dashboard + layout + 3 per entity
    logger.info("Frontend generated: %d entities, %d component files", len(entities), total_files)


# ── Config file generators ───────────────────────────────────────────

def _gen_package_json(app_name: str) -> str:
    pkg = {
        "name": _snake(app_name).replace(" ", "-").replace("_", "-"),
        "private": True,
        "version": "0.1.0",
        "type": "module",
        "scripts": {
            "dev": "vite",
            "build": "tsc && vite build",
            "preview": "vite preview",
        },
        "dependencies": {
            "react": "^18.3.1",
            "react-dom": "^18.3.1",
            "react-router-dom": "^6.26.2",
        },
        "devDependencies": {
            "@types/react": "^18.3.11",
            "@types/react-dom": "^18.3.1",
            "@vitejs/plugin-react": "^4.3.2",
            "autoprefixer": "^10.4.20",
            "postcss": "^8.4.47",
            "tailwindcss": "^3.4.13",
            "typescript": "^5.6.3",
            "vite": "^5.4.9",
        },
    }
    return json.dumps(pkg, indent=2) + "\n"


def _gen_vite_config() -> str:
    return """\
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
"""


def _gen_tailwind_config(primary: str) -> str:
    return f"""\
/** @type {{import('tailwindcss').Config}} */
export default {{
  content: ['./index.html', './src/**/*.{{js,ts,jsx,tsx}}'],
  theme: {{
    extend: {{
      colors: {{
        primary: {{
          DEFAULT: '{primary}',
          50: '{primary}0d',
          100: '{primary}1a',
          200: '{primary}33',
          500: '{primary}',
          600: '{primary}e6',
          700: '{primary}cc',
        }},
      }},
    }},
  }},
  plugins: [],
}};
"""


def _gen_tsconfig() -> str:
    cfg = {
        "compilerOptions": {
            "target": "ES2020",
            "useDefineForClassFields": True,
            "lib": ["ES2020", "DOM", "DOM.Iterable"],
            "module": "ESNext",
            "skipLibCheck": True,
            "moduleResolution": "bundler",
            "allowImportingTsExtensions": True,
            "isolatedModules": True,
            "moduleDetection": "force",
            "noEmit": True,
            "jsx": "react-jsx",
            "strict": True,
            "noUnusedLocals": False,
            "noUnusedParameters": False,
            "noFallthroughCasesInSwitch": True,
        },
        "include": ["src"],
    }
    return json.dumps(cfg, indent=2) + "\n"


def _gen_index_html(app_name: str) -> str:
    return f"""\
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{app_name}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
"""


# ── Source file generators ───────────────────────────────────────────

def _gen_main_tsx() -> str:
    return """\
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
"""


def _gen_index_css() -> str:
    return """\
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  @apply bg-gray-50 text-gray-900 antialiased;
}
"""


def _gen_app_tsx(entities: list, modules: list, app_name: str) -> str:
    imports = ["import { Routes, Route, Navigate } from 'react-router-dom';"]
    imports.append("import { Layout } from './components/Layout';")
    imports.append("import { Dashboard } from './pages/Dashboard';")

    routes = ['        <Route path="/" element={<Dashboard />} />']

    for entity in entities:
        name = entity.get("name", "Entity")
        slug = _snake(name).replace("_", "-")
        imports.append(f"import {{ {name}Page }} from './pages/{name}Page';")
        routes.append(f'        <Route path="/{slug}" element={{<{name}Page />}} />')

    return (
        "\n".join(imports)
        + "\n\n"
        + "export default function App() {\n"
        + "  return (\n"
        + "    <Layout>\n"
        + "      <Routes>\n"
        + "\n".join(routes) + "\n"
        + '        <Route path="*" element={<Navigate to="/" replace />} />\n'
        + "      </Routes>\n"
        + "    </Layout>\n"
        + "  );\n"
        + "}\n"
    )


def _gen_api_client() -> str:
    return """\
const API_BASE = import.meta.env.VITE_API_URL || '/api';

async function request(method: string, path: string, data?: any) {
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (data) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(err);
  }

  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get: (path: string) => request('GET', path),
  post: (path: string, data: any) => request('POST', path, data),
  patch: (path: string, data: any) => request('PATCH', path, data),
  del: (path: string) => request('DELETE', path),
};
"""


# ── Layout ───────────────────────────────────────────────────────────

def _gen_layout(app_name: str, modules: list, primary: str) -> str:
    # Build nav items from modules
    nav_items = []
    breadcrumb_entries = [{"path": "/", "label": "Dashboard"}]
    for mod in modules:
        label = mod.get("label", mod.get("name", "Module"))
        entity = mod.get("entity") or mod.get("name") or label
        slug = _snake(entity).replace("_", "-")
        icon = mod.get("icon", "")
        nav_items.append({"label": label, "href": f"/{slug}", "icon": icon})
        breadcrumb_entries.append({"path": f"/{slug}", "label": label})

    nav_json = json.dumps(nav_items)
    breadcrumb_json = json.dumps({e["path"]: e["label"] for e in breadcrumb_entries})

    return f"""\
import {{ useState, useMemo }} from 'react';
import {{ Link, useLocation }} from 'react-router-dom';

const NAV_ITEMS: {{ label: string; href: string; icon: string }}[] = {nav_json};

const PAGE_NAMES: Record<string, string> = {breadcrumb_json};

export function Layout({{ children }}: {{ children: React.ReactNode }}) {{
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const currentPageName = useMemo(() => {{
    return PAGE_NAMES[location.pathname] || location.pathname.replace('/', '').replace(/-/g, ' ').replace(/\\b\\w/g, (c: string) => c.toUpperCase()) || 'Dashboard';
  }}, [location.pathname]);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {{/* Mobile overlay */}}
      {{sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={{() => setSidebarOpen(false)}}
        />
      )}}

      {{/* Sidebar */}}
      <aside
        className={{`fixed inset-y-0 left-0 z-40 w-64 transform bg-white border-r border-gray-200
          transition-transform duration-200 lg:relative lg:translate-x-0 ${{
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }}`}}
      >
        <div className="flex h-16 items-center gap-2 border-b px-6">
          <div className="h-8 w-8 rounded-lg flex items-center justify-center text-white text-sm font-bold"
               style={{{{ backgroundColor: '{primary}' }}}}>
            {{{repr(app_name[0].upper())}}}
          </div>
          <span className="text-lg font-semibold text-gray-900">{app_name}</span>
        </div>

        <nav className="mt-4 flex flex-col gap-1 px-3">
          <Link
            to="/"
            className={{`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${{
              location.pathname === '/'
                ? 'bg-primary-100 text-primary-700'
                : 'text-gray-600 hover:bg-gray-100'
            }}`}}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round"
                    d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
            </svg>
            Dashboard
          </Link>

          {{NAV_ITEMS.map((item) => (
            <Link
              key={{item.href}}
              to={{item.href}}
              className={{`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${{
                location.pathname === item.href
                  ? 'bg-primary-100 text-primary-700'
                  : 'text-gray-600 hover:bg-gray-100'
              }}`}}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round"
                      d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6z" />
              </svg>
              {{item.label}}
            </Link>
          ))}}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 border-t p-4">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600">
              U
            </div>
            <div className="text-sm">
              <p className="font-medium text-gray-900">User</p>
              <p className="text-gray-500 text-xs">user@example.com</p>
            </div>
          </div>
        </div>
      </aside>

      {{/* Main content */}}
      <div className="flex flex-1 flex-col overflow-hidden">
        {{/* Top bar with breadcrumb */}}
        <header className="flex h-16 items-center gap-4 border-b bg-white px-6">
          <button
            className="lg:hidden"
            onClick={{() => setSidebarOpen(true)}}
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <nav className="flex items-center gap-2 text-sm">
            <Link to="/" className="text-gray-400 hover:text-gray-600 transition">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round"
                      d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
              </svg>
            </Link>
            {{location.pathname !== '/' && (
              <>
                <span className="text-gray-300">/</span>
                <span className="font-medium text-gray-700">{{currentPageName}}</span>
              </>
            )}}
          </nav>
          <div className="flex-1" />
        </header>

        <main className="flex-1 overflow-auto p-6">
          {{children}}
        </main>
      </div>
    </div>
  );
}}
"""


# ── Dashboard ────────────────────────────────────────────────────────

def _gen_dashboard(entities: list) -> str:
    cards = []
    recent_section = ""

    for entity in entities:
        name = entity.get("name", "Entity")
        table = entity.get("table", _snake(name) + "s")
        label = name.replace("_", " ")
        slug = _snake(name).replace("_", "-")
        cards.append(f"""\
      <Link to="/{slug}" className="rounded-xl border bg-white p-6 hover:shadow-lg hover:-translate-y-1 transition-all duration-200 cursor-pointer group">
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500 group-hover:text-primary transition">{label}s</p>
          <svg className="h-5 w-5 text-gray-300 group-hover:text-primary transition" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </div>
        <p className="mt-2 text-3xl font-semibold">{{counts['{table}'] ?? '...'}}</p>
      </Link>""")

    if entities:
        first = entities[0]
        first_name = first.get("name", "Entity")
        first_table = first.get("table", _snake(first_name) + "s")
        visible = _visible_fields(first, "table")[:5]
        th_cells = "\n              ".join(
            f'<th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{f.get("label", f["name"])}</th>'
            for f in visible
        )
        td_cells = "\n                  ".join(
            f'<td className="px-4 py-3 text-sm text-gray-700">{{String(row[\'{f["name"]}\'] ?? \'\')}}</td>'
            for f in visible
        )
        recent_section = f"""
      <div className="rounded-xl border bg-white">
        <div className="border-b px-6 py-4">
          <h2 className="text-lg font-semibold">Recent {first_name}s</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                {th_cells}
              </tr>
            </thead>
            <tbody className="divide-y">
              {{recentItems.map((row: any, i: number) => (
                <tr key={{i}} className="hover:bg-gray-50">
                  {td_cells}
                </tr>
              ))}}
              {{recentItems.length === 0 && (
                <tr>
                  <td colSpan={{{len(visible)}}} className="px-6 py-8 text-center text-sm text-gray-400">
                    No data yet
                  </td>
                </tr>
              )}}
            </tbody>
          </table>
        </div>
      </div>"""

    # Build fetch calls for counts
    count_fetches = []
    for entity in entities:
        name = entity.get("name", "Entity")
        table = entity.get("table", _snake(name) + "s")
        count_fetches.append(
            f"      api.get('/{table}').then((d: any) => ({{ '{table}': Array.isArray(d) ? d.length : d?.total ?? 0 }})).catch(() => ({{ '{table}': 0 }}))"
        )

    fetches_str = ",\n".join(count_fetches) if count_fetches else ""
    first_table_fetch = ""
    if entities:
        first_table = entities[0].get("table", _snake(entities[0].get("name", "Entity")) + "s")
        first_table_fetch = f"""
    api.get('/{first_table}?limit=5')
      .then((d: any) => setRecentItems(Array.isArray(d) ? d.slice(0, 5) : d?.items?.slice(0, 5) ?? []))
      .catch(() => {{}});"""

    return f"""\
import {{ useState, useEffect }} from 'react';
import {{ Link }} from 'react-router-dom';
import {{ api }} from '../api';

export function Dashboard() {{
  const [counts, setCounts] = useState<Record<string, number>({{}});
  const [recentItems, setRecentItems] = useState<any[]>([]);

  useEffect(() => {{
    // Fetch counts for each entity
    Promise.all([
{fetches_str}
    ]).then((results) => {{
      const merged = Object.assign({{}}, ...results);
      setCounts(merged);
    }});
{first_table_fetch}
  }}, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-{min(len(entities), 4)} gap-4">
{"".join(cards)}
      </div>
{recent_section}
    </div>
  );
}}
"""


# ── Entity page ──────────────────────────────────────────────────────

def _gen_entity_page(entity: dict) -> str:
    name = entity.get("name", "Entity")
    table = entity.get("table", _snake(name) + "s")
    label = name.replace("_", " ")

    return f"""\
import {{ useState, useEffect }} from 'react';
import {{ api }} from '../api';
import {{ {name}Table }} from '../components/{name}Table';
import {{ {name}Form }} from '../components/{name}Form';

export function {name}Page() {{
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {{
    loadData();
  }}, []);

  const loadData = async () => {{
    setLoading(true);
    try {{
      const result = await api.get('/{table}');
      setData(Array.isArray(result) ? result : result?.items ?? []);
    }} catch (err) {{
      console.error('Failed to load {label}s:', err);
    }}
    setLoading(false);
  }};

  const handleCreate = async (values: any) => {{
    await api.post('/{table}', values);
    setShowForm(false);
    loadData();
  }};

  const handleUpdate = async (values: any) => {{
    if (!editItem?.id) return;
    await api.patch('/{table}/' + editItem.id, values);
    setEditItem(null);
    setShowForm(false);
    loadData();
  }};

  const handleDelete = async (id: string) => {{
    if (!confirm('Delete this {label}?')) return;
    await api.del('/{table}/' + id);
    loadData();
  }};

  const handleEdit = (item: any) => {{
    setEditItem(item);
    setShowForm(true);
  }};

  const filteredData = search
    ? data.filter((item) =>
        Object.values(item).some((v) =>
          String(v).toLowerCase().includes(search.toLowerCase())
        )
      )
    : data;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">{label}s</h1>
        <button
          onClick={{() => {{ setEditItem(null); setShowForm(true); }}}}
          className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-600 transition"
        >
          + Add {label}
        </button>
      </div>

      {{/* Search */}}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search {label.lower()}s..."
          value={{search}}
          onChange={{(e) => setSearch(e.target.value)}}
          className="w-full max-w-sm rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
        />
      </div>

      <{name}Table
        data={{filteredData}}
        loading={{loading}}
        onEdit={{handleEdit}}
        onDelete={{handleDelete}}
      />

      {{showForm && (
        <{name}Form
          initialValues={{editItem}}
          onSubmit={{editItem ? handleUpdate : handleCreate}}
          onClose={{() => {{ setShowForm(false); setEditItem(null); }}}}
        />
      )}}
    </div>
  );
}}
"""


# ── Entity table ─────────────────────────────────────────────────────

def _gen_entity_table(entity: dict) -> str:
    name = entity.get("name", "Entity")
    fields = _visible_fields(entity, "table")

    # Build header cells — right-align numeric columns
    headers = []
    for f in fields:
        label = f.get("label", f["name"].replace("_", " ").title())
        fname = f["name"]
        align = "text-right" if _is_numeric_field(f) else "text-left"
        headers.append(
            f'        <th\n'
            f'          className="px-4 py-3 {align} text-xs font-medium text-gray-500 uppercase cursor-pointer select-none hover:text-gray-700"\n'
            f'          onClick={{() => handleSort(\'{fname}\')}}\n'
            f'        >\n'
            f'          <span className="flex items-center gap-1">\n'
            f'            {label}\n'
            f'            {{sortKey === \'{fname}\' && <span>{{sortDir === \'asc\' ? \'\\u2191\' : \'\\u2193\'}}</span>}}\n'
            f'          </span>\n'
            f'        </th>'
        )

    # Build body cells using helper predicates
    cells = []
    for f in fields:
        fname = f["name"]

        if _is_enum_field(f):
            # Render as coloured badge
            badge_colors = f.get("badge_colors", {})
            color_entries = []
            for val in f.get("enum_values", []):
                color = badge_colors.get(val, "gray")
                color_entries.append(f"'{val}': '{color}'")
            color_map = "{" + ", ".join(color_entries) + "}" if color_entries else "{}"
            cells.append(
                f'          <td className="px-4 py-3 text-sm">\n'
                f'            {{row[\'{fname}\'] && (\n'
                f'              <span className={{`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium\n'
                f'                ${{({{ {color_map} }} as Record<string, string>)[String(row[\'{fname}\'])] === \'green\' ? \'bg-green-100 text-green-700\'\n'
                f'                : ({{ {color_map} }} as Record<string, string>)[String(row[\'{fname}\'])] === \'red\' ? \'bg-red-100 text-red-700\'\n'
                f'                : ({{ {color_map} }} as Record<string, string>)[String(row[\'{fname}\'])] === \'amber\' ? \'bg-amber-100 text-amber-700\'\n'
                f'                : ({{ {color_map} }} as Record<string, string>)[String(row[\'{fname}\'])] === \'blue\' ? \'bg-blue-100 text-blue-700\'\n'
                f'                : ({{ {color_map} }} as Record<string, string>)[String(row[\'{fname}\'])] === \'purple\' ? \'bg-purple-100 text-purple-700\'\n'
                f'                : ({{ {color_map} }} as Record<string, string>)[String(row[\'{fname}\'])] === \'slate\' ? \'bg-slate-100 text-slate-700\'\n'
                f'                : \'bg-gray-100 text-gray-700\'}}`}}\n'
                f'              >\n'
                f'                {{String(row[\'{fname}\'])}}\n'
                f'              </span>\n'
                f'            )}}\n'
                f'          </td>'
            )
        elif _is_boolean_field(f):
            cells.append(
                f'          <td className="px-4 py-3 text-sm">\n'
                f'            {{row[\'{fname}\'] ? (\n'
                f'              <span className="inline-flex items-center text-green-600" title="Yes">\n'
                f'                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">\n'
                f'                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />\n'
                f'                </svg>\n'
                f'              </span>\n'
                f'            ) : (\n'
                f'              <span className="inline-flex items-center text-gray-300" title="No">\n'
                f'                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">\n'
                f'                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />\n'
                f'                </svg>\n'
                f'              </span>\n'
                f'            )}}\n'
                f'          </td>'
            )
        elif _is_numeric_field(f):
            cells.append(
                f'          <td className="px-4 py-3 text-sm text-right tabular-nums">\n'
                f'            {{row[\'{fname}\'] != null ? Number(row[\'{fname}\']).toLocaleString(undefined, {{ minimumFractionDigits: 2 }}) : \'\'}}\n'
                f'          </td>'
            )
        elif _is_date_field(f):
            cells.append(
                f'          <td className="px-4 py-3 text-sm text-gray-600">\n'
                f'            {{row[\'{fname}\'] ? new Date(row[\'{fname}\']).toLocaleDateString(undefined, {{ year: \'numeric\', month: \'short\', day: \'numeric\' }}) : \'\'}}\n'
                f'          </td>'
            )
        elif f.get("db_type", "") == "TIMESTAMPTZ":
            cells.append(
                f'          <td className="px-4 py-3 text-sm text-gray-600">\n'
                f'            {{row[\'{fname}\'] ? new Date(row[\'{fname}\']).toLocaleDateString(undefined, {{ year: \'numeric\', month: \'short\', day: \'numeric\', hour: \'2-digit\', minute: \'2-digit\' }}) : \'\'}}\n'
                f'          </td>'
            )
        else:
            cells.append(
                f'          <td className="px-4 py-3 text-sm text-gray-700">\n'
                f'            {{String(row[\'{fname}\'] ?? \'\')}}\n'
                f'          </td>'
            )

    headers_str = "\n".join(headers)
    cells_str = "\n".join(cells)
    col_count = len(fields) + 1  # +1 for actions column

    return f"""\
import {{ useState, useMemo }} from 'react';

interface Props {{
  data: any[];
  loading: boolean;
  onEdit: (item: any) => void;
  onDelete: (id: string) => void;
}}

export function {name}Table({{ data, loading, onEdit, onDelete }}: Props) {{
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const handleSort = (key: string) => {{
    if (sortKey === key) {{
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    }} else {{
      setSortKey(key);
      setSortDir('asc');
    }}
  }};

  const sortedData = useMemo(() => {{
    if (!sortKey) return data;
    return [...data].sort((a, b) => {{
      const aVal = a[sortKey] ?? '';
      const bVal = b[sortKey] ?? '';
      const cmp = String(aVal).localeCompare(String(bVal), undefined, {{ numeric: true }});
      return sortDir === 'asc' ? cmp : -cmp;
    }});
  }}, [data, sortKey, sortDir]);

  if (loading) {{
    return (
      <div className="rounded-xl border bg-white">
        <div className="animate-pulse p-6 space-y-3">
          {{Array.from({{ length: 5 }}).map((_, i) => (
            <div key={{i}} className="h-10 bg-gray-100 rounded" />
          ))}}
        </div>
      </div>
    );
  }}

  if (data.length === 0) {{
    return (
      <div className="rounded-xl border bg-white p-12 text-center">
        <svg className="mx-auto h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth="1" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round"
                d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
        </svg>
        <p className="mt-4 text-sm text-gray-500">No records yet</p>
        <p className="mt-1 text-xs text-gray-400">Create your first record to get started</p>
      </div>
    );
  }}

  return (
    <div className="rounded-xl border bg-white overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
{headers_str}
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {{sortedData.map((row: any, i: number) => (
              <tr key={{row.id ?? i}} className={{`hover:bg-primary-50 transition ${{i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}}`}}>
{cells_str}
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={{() => onEdit(row)}}
                      className="text-gray-400 hover:text-primary transition"
                      title="Edit"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round"
                              d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                      </svg>
                    </button>
                    <button
                      onClick={{() => onDelete(row.id)}}
                      className="text-gray-400 hover:text-red-500 transition"
                      title="Delete"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round"
                              d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}}
          </tbody>
        </table>
      </div>
    </div>
  );
}}
"""


# ── Entity form ──────────────────────────────────────────────────────

def _gen_entity_form(entity: dict) -> str:
    name = entity.get("name", "Entity")
    label = name.replace("_", " ")
    fields = _visible_fields(entity, "form")

    # Collect FK entities that need option loading
    fk_entities: list[dict] = []
    for f in fields:
        if _is_fk_field(f):
            fk_name = f.get("fk_entity", f["name"].replace("_id", "").title())
            fk_table = _snake(fk_name) + "s"
            fk_entities.append({"field": f["name"], "entity": fk_name, "table": fk_table})

    # Build FK state declarations and fetch calls
    fk_state_lines = []
    fk_fetch_lines = []
    for fk in fk_entities:
        safe = fk["entity"].lower() + "Options"
        fk_state_lines.append(f"  const [{safe}, set{fk['entity']}Options] = useState<any[]>([]);")
        fk_fetch_lines.append(
            f"    api.get('/{fk['table']}').then((d: any) => set{fk['entity']}Options(Array.isArray(d) ? d : d?.items ?? [])).catch(() => {{}});"
        )

    fk_state_str = "\n".join(fk_state_lines)
    fk_fetch_str = "\n".join(fk_fetch_lines)

    # Need api import if we have FK fields
    api_import = "\nimport { api } from '../api';" if fk_entities else ""

    # Build form field components
    field_components = []
    for f in fields:
        fname = f["name"]
        flabel = f.get("label", fname.replace("_", " ").title())
        required = "NOT NULL" in f.get("db_type", "") or not f.get("nullable", True)
        input_type = _field_input_type(f)
        required_attr = ' required' if required else ''
        required_star = ' <span className="text-red-500">*</span>' if required else ''

        if _is_fk_field(f):
            # FK relation select — renders a dropdown of related entity records
            fk_name = f.get("fk_entity", fname.replace("_id", "").title())
            safe = fk_name.lower() + "Options"
            field_components.append(f"""\
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {flabel.replace(' Id', '')}{required_star}
            </label>
            <select
              name="{fname}"
              value={{values['{fname}'] ?? ''}}
              onChange={{handleChange}}{required_attr}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
            >
              <option value="">Select {fk_name}...</option>
              {{{safe}.map((opt: any) => (
                <option key={{opt.id}} value={{opt.id}}>
                  {{opt.name || opt.title || opt.label || opt.id}}
                </option>
              ))}}
            </select>
          </div>""")
        elif input_type == "select" and f.get("enum_values"):
            options = "\n".join(
                f'              <option value="{v}">{v.replace("_", " ").title()}</option>'
                for v in f["enum_values"]
            )
            field_components.append(f"""\
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {flabel}{required_star}
            </label>
            <select
              name="{fname}"
              value={{values['{fname}'] ?? ''}}
              onChange={{handleChange}}{required_attr}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
            >
              <option value="">Select...</option>
{options}
            </select>
          </div>""")
        elif input_type == "textarea":
            field_components.append(f"""\
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {flabel}{required_star}
            </label>
            <textarea
              name="{fname}"
              value={{values['{fname}'] ?? ''}}
              onChange={{handleChange}}{required_attr}
              rows={{3}}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
              placeholder="Enter {flabel.lower()}..."
            />
          </div>""")
        elif input_type == "checkbox":
            field_components.append(f"""\
          <div className="flex items-center gap-3 py-1">
            <input
              type="checkbox"
              id="{fname}"
              name="{fname}"
              checked={{!!values['{fname}']}}
              onChange={{(e) => setValues({{ ...values, '{fname}': e.target.checked }})}}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <label htmlFor="{fname}" className="text-sm font-medium text-gray-700 cursor-pointer">{flabel}</label>
          </div>""")
        else:
            step_attr = ' step="0.01"' if input_type == "number" and f.get("db_type", "").startswith("NUMERIC") else ''
            placeholder = f' placeholder="Enter {flabel.lower()}..."' if input_type == "text" else ''
            field_components.append(f"""\
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {flabel}{required_star}
            </label>
            <input
              type="{input_type}"
              name="{fname}"
              value={{values['{fname}'] ?? ''}}
              onChange={{handleChange}}{required_attr}{step_attr}{placeholder}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
            />
          </div>""")

    fields_str = "\n\n".join(field_components)

    return f"""\
import {{ useState, useEffect, useCallback }} from 'react';{api_import}

interface Props {{
  initialValues?: any;
  onSubmit: (values: any) => void;
  onClose: () => void;
}}

export function {name}Form({{ initialValues, onSubmit, onClose }}: Props) {{
  const [values, setValues] = useState<Record<string, any>>(initialValues ?? {{}});
  const [submitting, setSubmitting] = useState(false);
{fk_state_str}

  useEffect(() => {{
    setValues(initialValues ?? {{}});
  }}, [initialValues]);

  // Close on Escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {{
    if (e.key === 'Escape') onClose();
  }}, [onClose]);

  useEffect(() => {{
    document.addEventListener('keydown', handleKeyDown);
{fk_fetch_str}
    return () => document.removeEventListener('keydown', handleKeyDown);
  }}, [handleKeyDown]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {{
    const {{ name, value }} = e.target;
    setValues({{ ...values, [name]: value }});
  }};

  const handleSubmit = async (e: React.FormEvent) => {{
    e.preventDefault();
    setSubmitting(true);
    try {{
      await onSubmit(values);
    }} catch (err) {{
      console.error('Submit failed:', err);
    }}
    setSubmitting(false);
  }};

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {{/* Backdrop */}}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={{onClose}} />

      {{/* Slide-over panel */}}
      <div className="relative w-full max-w-lg bg-white shadow-xl animate-[slideIn_0.2s_ease-out]">
        <div className="flex h-full flex-col">
          {{/* Header */}}
          <div className="flex items-center justify-between border-b px-6 py-4">
            <h2 className="text-lg font-semibold">
              {{initialValues ? 'Edit' : 'New'}} {label}
            </h2>
            <button onClick={{onClose}} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {{/* Form body */}}
          <form onSubmit={{handleSubmit}} className="flex-1 overflow-auto p-6">
            <div className="space-y-5">
{fields_str}
            </div>

            {{/* Actions */}}
            <div className="mt-8 flex items-center gap-3 border-t pt-6">
              <button
                type="submit"
                disabled={{submitting}}
                className="bg-primary text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-primary-600 transition disabled:opacity-50"
              >
                {{submitting ? 'Saving...' : initialValues ? 'Update' : 'Create'}}
              </button>
              <button
                type="button"
                onClick={{onClose}}
                className="px-6 py-2.5 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 transition"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}}
"""
