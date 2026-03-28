import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import {
  ChevronRight,
  ChevronDown,
  FileCode2,
  Folder,
  FolderOpen,
  X,
  Loader2,
  Terminal,
  ChevronUp,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────

interface SpecEntity {
  name: string;
  table?: string;
  fields?: SpecField[];
  [key: string]: unknown;
}

interface SpecField {
  name: string;
  type?: string;
  ts_type?: string;
  show_in_table?: boolean;
  enum_values?: string[];
  [key: string]: unknown;
}

interface SpecModule {
  name?: string;
  entity?: string;
  route?: string;
  [key: string]: unknown;
}

interface Spec {
  app_name?: string;
  name?: string;
  entities?: SpecEntity[];
  modules?: SpecModule[];
  [key: string]: unknown;
}

interface CloudIDEProps {
  spec: Spec | null;
  generating: boolean;
  projectId?: string;
  onComplete?: () => void;
}

interface GeneratedFile {
  path: string;
  content: string;
  language: "python" | "typescript" | "tsx" | "json" | "css" | "text";
}

interface FileTreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  children?: FileTreeNode[];
  language?: GeneratedFile["language"];
}

// ── Helpers: syntax highlighting (CSS-based, no external lib) ───────

const KW_PYTHON = new Set([
  "import", "from", "class", "def", "return", "if", "else", "elif", "for",
  "in", "while", "try", "except", "raise", "with", "as", "async", "await",
  "yield", "pass", "break", "continue", "and", "or", "not", "is", "None",
  "True", "False", "self", "lambda", "finally", "assert", "del", "global",
  "nonlocal",
]);

const KW_TS = new Set([
  "import", "from", "export", "default", "const", "let", "var", "function",
  "return", "if", "else", "for", "while", "switch", "case", "break",
  "continue", "class", "extends", "implements", "interface", "type",
  "enum", "new", "this", "super", "try", "catch", "finally", "throw",
  "async", "await", "yield", "of", "in", "typeof", "instanceof", "void",
  "null", "undefined", "true", "false", "as", "readonly", "static",
  "public", "private", "protected", "abstract",
]);

function highlightLine(text: string, language: string): string {
  // SECURITY: Escape all HTML entities FIRST, before adding syntax highlight spans.
  // This prevents XSS even though input is generated code (defense-in-depth).
  // The only HTML injected after escaping are our own <span> tags for colors.
  let line = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  if (language === "json") {
    // JSON keys
    line = line.replace(
      /(&quot;|")([\w\s@./\-:]+?)(&quot;|")\s*:/g,
      '<span style="color:#9cdcfe">$1$2$3</span>:'
    );
    // JSON string values
    line = line.replace(
      /:\s*(&quot;|")(.*?)(&quot;|")/g,
      ': <span style="color:#ce9178">$1$2$3</span>'
    );
    // numbers and booleans
    line = line.replace(
      /:\s*(true|false|null|\d+\.?\d*)/g,
      ': <span style="color:#b5cea8">$1</span>'
    );
    return line;
  }

  const isPython = language === "python";
  const keywords = isPython ? KW_PYTHON : KW_TS;

  // Strings (single and double quoted)
  line = line.replace(
    /(["'`])(?:(?!\1).)*?\1/g,
    '<span style="color:#ce9178">$&</span>'
  );

  // Comments
  if (isPython) {
    line = line.replace(
      /(#.*)$/,
      '<span style="color:#6a9955">$1</span>'
    );
  } else {
    line = line.replace(
      /(\/\/.*)$/,
      '<span style="color:#6a9955">$1</span>'
    );
  }

  // Decorators (Python)
  if (isPython) {
    line = line.replace(
      /(@\w+(\.\w+)*)/g,
      '<span style="color:#dcdcaa">$1</span>'
    );
  }

  // Keywords — only highlight whole words not inside an already-colored span
  keywords.forEach((kw) => {
    const re = new RegExp(`\\b(${kw})\\b`, "g");
    line = line.replace(re, (match, g1, offset) => {
      // crude check: skip if already inside a span
      const before = line.slice(0, offset);
      const openSpans = (before.match(/<span/g) || []).length;
      const closeSpans = (before.match(/<\/span>/g) || []).length;
      if (openSpans > closeSpans) return match;
      return `<span style="color:#569cd6">${g1}</span>`;
    });
  });

  // Types / class names (capitalized words)
  line = line.replace(
    /\b([A-Z][a-zA-Z0-9_]+)\b/g,
    (match, g1, offset) => {
      const before = line.slice(0, offset);
      const openSpans = (before.match(/<span/g) || []).length;
      const closeSpans = (before.match(/<\/span>/g) || []).length;
      if (openSpans > closeSpans) return match;
      return `<span style="color:#4ec9b0">${g1}</span>`;
    }
  );

  return line;
}

// ── File content generators ─────────────────────────────────────────

function snakeCase(s: string): string {
  return s
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "")
    .replace(/\s+/g, "_");
}

function titleCase(s: string): string {
  return s.replace(/(^|_| )(\w)/g, (_, __, c) => c.toUpperCase());
}

function generateModelPy(entity: SpecEntity): string {
  const name = entity.name;
  const tableName = entity.table || snakeCase(name);
  const fields = entity.fields || [];
  const lines: string[] = [
    `from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text`,
    `from sqlalchemy.orm import relationship`,
    `from db import Base`,
    `from datetime import datetime`,
    ``,
    ``,
    `class ${titleCase(name)}(Base):`,
    `    """${entity.description || name + " model"}"""`,
    `    __tablename__ = "${tableName}"`,
    ``,
  ];

  for (const f of fields) {
    const colType = mapDbType(f.db_type);
    const extras: string[] = [];
    if (f.primary_key) extras.push("primary_key=True");
    if (f.nullable === false && !f.primary_key) extras.push("nullable=False");
    if (f.default !== undefined && f.default !== null) {
      if (typeof f.default === "string") {
        extras.push(`default="${f.default}"`);
      } else {
        extras.push(`default=${f.default}`);
      }
    }
    const extrasStr = extras.length ? `, ${extras.join(", ")}` : "";
    lines.push(`    ${snakeCase(f.name)} = Column(${colType}${extrasStr})`);
  }

  lines.push("");
  lines.push(`    created_at = Column(DateTime, default=datetime.utcnow)`);
  lines.push(`    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)`);
  lines.push("");
  lines.push(`    def __repr__(self):`);
  lines.push(`        return f"<${titleCase(name)}(id={self.id})>"`);

  return lines.join("\n");
}

function mapDbType(dbType: string): string {
  const m: Record<string, string> = {
    serial: "Integer",
    integer: "Integer",
    int: "Integer",
    bigint: "Integer",
    varchar: "String(255)",
    text: "Text",
    boolean: "Boolean",
    float: "Float",
    decimal: "Float",
    timestamp: "DateTime",
    datetime: "DateTime",
    date: "DateTime",
    json: "Text",
    jsonb: "Text",
  };
  return m[(dbType || "text").toLowerCase()] || "String(255)";
}

function generateRoutePy(entity: any): string {
  const name = snakeCase(entity.name);
  const cls = titleCase(entity.name);
  return `from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from db import get_db
from models.${name} import ${cls}

router = APIRouter(prefix="/${name}s", tags=["${cls}"])


@router.get("/", response_model=List[dict])
async def list_${name}s(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, le=100),
    db: Session = Depends(get_db),
):
    """List all ${name}s with pagination."""
    items = db.query(${cls}).offset(skip).limit(limit).all()
    return items


@router.get("/{item_id}")
async def get_${name}(item_id: int, db: Session = Depends(get_db)):
    """Get a single ${name} by ID."""
    item = db.query(${cls}).filter(${cls}.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="${cls} not found")
    return item


@router.post("/", status_code=201)
async def create_${name}(data: dict, db: Session = Depends(get_db)):
    """Create a new ${name}."""
    item = ${cls}(**data)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/{item_id}")
async def update_${name}(item_id: int, data: dict, db: Session = Depends(get_db)):
    """Update an existing ${name}."""
    item = db.query(${cls}).filter(${cls}.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="${cls} not found")
    for key, value in data.items():
        setattr(item, key, value)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=204)
async def delete_${name}(item_id: int, db: Session = Depends(get_db)):
    """Delete a ${name}."""
    item = db.query(${cls}).filter(${cls}.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="${cls} not found")
    db.delete(item)
    db.commit()
`;
}

function generatePageTsx(entity: any, modules: any[]): string {
  const cls = titleCase(entity.name);
  const mod = modules.find((m: any) => m.entity === entity.name);
  const fields = (entity.fields || [])
    .filter((f: any) => f.show_in_table !== false)
    .slice(0, 5);
  const columns = fields.map((f: any) => f.name);

  return `import { useState, useEffect } from "react";
import { Plus, Search, MoreHorizontal, Pencil, Trash2, Eye } from "lucide-react";

interface ${cls} {
  id: number;
${fields.map((f: any) => `  ${f.name}: ${f.ts_type || "string"};`).join("\n")}
}

export function ${cls}Page() {
  const [items, setItems] = useState<${cls}[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/${snakeCase(entity.name)}s")
      .then((r) => r.json())
      .then(setItems)
      .finally(() => setLoading(false));
  }, []);

  const filtered = items.filter((item) =>
    Object.values(item).some((v) =>
      String(v).toLowerCase().includes(search.toLowerCase())
    )
  );

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">${mod?.name || cls}</h1>
        <button className="btn btn-primary flex items-center gap-2">
          <Plus size={16} />
          ${mod?.primary_action?.label || `Add ${cls}`}
        </button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 pr-4 py-2 border rounded-lg w-full"
        />
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
${columns.map((c: string) => `              <th className="px-4 py-3 text-left font-medium text-gray-600">${titleCase(c)}</th>`).join("\n")}
              <th className="px-4 py-3 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id} className="border-b hover:bg-gray-50">
${columns.map((c: string) => `                <td className="px-4 py-3">{item.${c}}</td>`).join("\n")}
                <td className="px-4 py-3">
                  <MoreHorizontal size={16} className="text-gray-400" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
`;
}

function generateMainPy(entities: any[]): string {
  const imports = entities
    .map((e: any) => `from routes.${snakeCase(e.name)} import router as ${snakeCase(e.name)}_router`)
    .join("\n");
  const includes = entities
    .map((e: any) => `app.include_router(${snakeCase(e.name)}_router, prefix="/api")`)
    .join("\n");

  return `from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from db import engine, Base
${imports}

# Create database tables
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Generated API",
    version="1.0.0",
    docs_url="/api/docs",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

${includes}


@app.get("/api/health")
async def health():
    return {"status": "ok"}
`;
}

function generateDbPy(): string {
  return `from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./app.db")

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
`;
}

function generateAppTsx(modules: any[]): string {
  const imports = modules
    .filter((m: any) => m.entity)
    .map(
      (m: any) =>
        `import { ${titleCase(m.entity)}Page } from "./pages/${titleCase(m.entity)}Page";`
    )
    .join("\n");
  const routes = modules
    .filter((m: any) => m.entity)
    .map(
      (m: any) =>
        `        <Route path="${m.route}" element={<${titleCase(m.entity)}Page />} />`
    )
    .join("\n");

  return `import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
${imports}

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 overflow-auto bg-gray-50">
          <Routes>
            <Route path="/" element={<Navigate to="${modules[0]?.route || "/dashboard"}" />} />
${routes}
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

function Sidebar() {
  return (
    <aside className="w-56 bg-white border-r flex flex-col">
      <div className="p-4 border-b font-bold text-lg">My App</div>
      <nav className="flex-1 p-2 space-y-1">
${modules.map((m: any) => `        <a href="${m.route}" className="block px-3 py-2 rounded hover:bg-gray-100 text-sm">${m.name}</a>`).join("\n")}
      </nav>
    </aside>
  );
}
`;
}

function generatePackageJson(appName: string): string {
  return JSON.stringify(
    {
      name: snakeCase(appName || "generated-app"),
      version: "0.1.0",
      private: true,
      scripts: {
        dev: "vite",
        build: "tsc && vite build",
        preview: "vite preview",
        lint: "eslint . --ext ts,tsx --report-unused-disable-directives",
      },
      dependencies: {
        react: "^18.3.1",
        "react-dom": "^18.3.1",
        "react-router-dom": "^6.23.1",
        "lucide-react": "^0.395.0",
        axios: "^1.7.2",
      },
      devDependencies: {
        "@types/react": "^18.3.3",
        "@types/react-dom": "^18.3.0",
        "@vitejs/plugin-react": "^4.3.1",
        typescript: "^5.5.2",
        vite: "^5.3.1",
        tailwindcss: "^3.4.4",
        autoprefixer: "^10.4.19",
        postcss: "^8.4.38",
        eslint: "^9.5.0",
      },
    },
    null,
    2
  );
}

function generateRequirementsTxt(): string {
  return `fastapi==0.111.0
uvicorn[standard]==0.30.1
sqlalchemy==2.0.30
python-dotenv==1.0.1
pydantic==2.7.4
alembic==1.13.1
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4
python-multipart==0.0.9
`;
}

// ── Build the file list from a spec ─────────────────────────────────

function buildFilesFromSpec(spec: any): GeneratedFile[] {
  const entities: any[] = spec?.entities || [];
  const modules: any[] = spec?.modules || [];
  const appName = spec?.app_name || spec?.name || "My App";
  const files: GeneratedFile[] = [];

  // Backend files first
  for (const entity of entities) {
    files.push({
      path: `backend/models/${snakeCase(entity.name)}.py`,
      content: generateModelPy(entity),
      language: "python",
    });
  }
  for (const entity of entities) {
    files.push({
      path: `backend/routes/${snakeCase(entity.name)}.py`,
      content: generateRoutePy(entity),
      language: "python",
    });
  }
  files.push({
    path: "backend/main.py",
    content: generateMainPy(entities),
    language: "python",
  });
  files.push({
    path: "backend/db.py",
    content: generateDbPy(),
    language: "python",
  });

  // Frontend files
  for (const entity of entities) {
    files.push({
      path: `frontend/src/pages/${titleCase(entity.name)}Page.tsx`,
      content: generatePageTsx(entity, modules),
      language: "tsx",
    });
  }
  files.push({
    path: "frontend/src/App.tsx",
    content: generateAppTsx(modules),
    language: "tsx",
  });

  // Config files
  files.push({
    path: "frontend/package.json",
    content: generatePackageJson(appName),
    language: "json",
  });
  files.push({
    path: "backend/requirements.txt",
    content: generateRequirementsTxt(),
    language: "text",
  });
  files.push({
    path: "spec.json",
    content: JSON.stringify(spec, null, 2),
    language: "json",
  });

  return files;
}

// ── Build a tree structure from flat paths ──────────────────────────

function buildTree(files: GeneratedFile[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];

  for (const f of files) {
    const parts = f.path.split("/");
    let level = root;
    let pathSoFar = "";
    for (let i = 0; i < parts.length; i++) {
      pathSoFar += (i > 0 ? "/" : "") + parts[i];
      const isLast = i === parts.length - 1;
      let existing = level.find((n) => n.name === parts[i]);
      if (!existing) {
        existing = {
          name: parts[i],
          path: pathSoFar,
          isFolder: !isLast,
          children: isLast ? undefined : [],
          language: isLast ? f.language : undefined,
        };
        level.push(existing);
      }
      if (!isLast) {
        level = existing.children!;
      }
    }
  }

  // Sort: folders first, then alphabetical
  const sortNodes = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1;
      if (!a.isFolder && b.isFolder) return 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) {
      if (n.children) sortNodes(n.children);
    }
  };
  sortNodes(root);
  return root;
}

// ── File icon color by extension ────────────────────────────────────

function getFileColor(language?: string): string {
  switch (language) {
    case "tsx":
      return "#61dafb";
    case "typescript":
      return "#3178c6";
    case "python":
      return "#3776ab";
    case "json":
      return "#f5a623";
    case "css":
      return "#563d7c";
    default:
      return "#8b8b8b";
  }
}

// ── Components ──────────────────────────────────────────────────────

const FileTreeItem = memo(function FileTreeItem({
  node,
  depth,
  activeFile,
  generatedPaths,
  generatingPath,
  expandedFolders,
  onSelectFile,
  onToggleFolder,
}: {
  node: FileTreeNode;
  depth: number;
  activeFile: string | null;
  generatedPaths: Set<string>;
  generatingPath: string | null;
  expandedFolders: Set<string>;
  onSelectFile: (path: string) => void;
  onToggleFolder: (path: string) => void;
}) {
  const isExpanded = expandedFolders.has(node.path);
  const isGenerated = generatedPaths.has(node.path);
  const isGenerating = generatingPath === node.path;
  const isActive = activeFile === node.path;
  const isVisible = node.isFolder || isGenerated || isGenerating;

  if (!isVisible) return null;

  return (
    <>
      <div
        onClick={() => {
          if (node.isFolder) {
            onToggleFolder(node.path);
          } else if (isGenerated) {
            onSelectFile(node.path);
          }
        }}
        style={{
          paddingLeft: depth * 16 + 8,
          paddingRight: 8,
          paddingTop: 3,
          paddingBottom: 3,
          display: "flex",
          alignItems: "center",
          gap: 6,
          cursor: node.isFolder || isGenerated ? "pointer" : "default",
          backgroundColor: isActive ? "rgba(236,72,153,0.1)" : "transparent",
          borderRight: isActive ? "2px solid #ec4899" : "2px solid transparent",
          fontSize: 13,
          fontFamily:
            "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          color: isActive ? "#ec4899" : "#333",
          opacity: isGenerating ? 0.6 : 1,
          animation: isGenerating
            ? "ide-fadeIn 0.3s ease"
            : isGenerated
            ? "ide-fadeIn 0.3s ease"
            : undefined,
          transition: "background-color 0.15s, color 0.15s",
        }}
        onMouseEnter={(e) => {
          if (!isActive)
            (e.currentTarget as HTMLElement).style.backgroundColor =
              "rgba(0,0,0,0.04)";
        }}
        onMouseLeave={(e) => {
          if (!isActive)
            (e.currentTarget as HTMLElement).style.backgroundColor =
              "transparent";
        }}
      >
        {node.isFolder ? (
          <>
            {isExpanded ? (
              <ChevronDown size={14} style={{ flexShrink: 0, color: "#999" }} />
            ) : (
              <ChevronRight size={14} style={{ flexShrink: 0, color: "#999" }} />
            )}
            {isExpanded ? (
              <FolderOpen size={14} style={{ flexShrink: 0, color: "#e8a838" }} />
            ) : (
              <Folder size={14} style={{ flexShrink: 0, color: "#e8a838" }} />
            )}
          </>
        ) : (
          <>
            <span style={{ width: 14, flexShrink: 0 }} />
            {isGenerating ? (
              <Loader2
                size={14}
                style={{
                  flexShrink: 0,
                  color: "#ec4899",
                  animation: "ide-spin 1s linear infinite",
                }}
              />
            ) : (
              <FileCode2
                size={14}
                style={{ flexShrink: 0, color: getFileColor(node.language) }}
              />
            )}
          </>
        )}
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {node.name}
        </span>
      </div>
      {node.isFolder && isExpanded && node.children && (
        <>
          {node.children.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              activeFile={activeFile}
              generatedPaths={generatedPaths}
              generatingPath={generatingPath}
              expandedFolders={expandedFolders}
              onSelectFile={onSelectFile}
              onToggleFolder={onToggleFolder}
            />
          ))}
        </>
      )}
    </>
  );
});

// ── Main component ──────────────────────────────────────────────────

export function CloudIDE({ spec, generating, projectId, onComplete }: CloudIDEProps) {
  // Simulated files (shown during generation animation)
  const simulatedFiles = useMemo(() => (spec ? buildFilesFromSpec(spec) : []), [spec]);

  // Real files fetched from backend after generation completes
  const [realFiles, setRealFiles] = useState<GeneratedFile[] | null>(null);
  const [fetchingReal, setFetchingReal] = useState(false);
  const fetchedForProject = useRef<string | null>(null);

  // Fetch real generated files once generation completes
  useEffect(() => {
    if (generating || !projectId || !spec) return;
    // Don't refetch for the same project
    if (fetchedForProject.current === projectId) return;

    let cancelled = false;
    const fetchFiles = async () => {
      setFetchingReal(true);
      try {
        const token = localStorage.getItem("token");
        const base = (import.meta.env.VITE_API_URL as string) || "/api";
        const res = await fetch(`${base}/projects/${projectId}/generated-files`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error("Failed to fetch generated files");
        const data: GeneratedFile[] = await res.json();
        if (!cancelled && data.length > 0) {
          setRealFiles(data);
          fetchedForProject.current = projectId;
        }
      } catch {
        // Silently fall back to simulated files
      } finally {
        if (!cancelled) setFetchingReal(false);
      }
    };
    fetchFiles();
    return () => { cancelled = true; };
  }, [generating, projectId, spec]);

  // Use real files if available, otherwise simulated
  const allFiles = realFiles ?? simulatedFiles;
  const fileTree = useMemo(() => buildTree(allFiles), [allFiles]);

  // State
  const [generatedPaths, setGeneratedPaths] = useState<Set<string>>(new Set());
  const [generatingPath, setGeneratingPath] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [logEntries, setLogEntries] = useState<string[]>([]);
  const [logExpanded, setLogExpanded] = useState(false);
  const [typedLines, setTypedLines] = useState<Record<string, number>>({});
  const [isComplete, setIsComplete] = useState(false);

  const generationRef = useRef(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const hasCompletedRef = useRef(false);

  // Auto-expand parent folders when a file is generated
  const expandParents = useCallback((path: string) => {
    const parts = path.split("/");
    const folders: string[] = [];
    for (let i = 1; i < parts.length; i++) {
      folders.push(parts.slice(0, i).join("/"));
    }
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      folders.forEach((f) => next.add(f));
      return next;
    });
  }, []);

  // Log message helper
  const addLog = useCallback((msg: string) => {
    setLogEntries((prev) => [...prev, msg]);
  }, []);

  // Generation logic
  useEffect(() => {
    if (!generating || !spec || allFiles.length === 0 || generationRef.current) return;
    generationRef.current = true;
    hasCompletedRef.current = false;

    // Reset state for new generation
    setGeneratedPaths(new Set());
    setGeneratingPath(null);
    setActiveFile(null);
    setOpenTabs([]);
    setLogEntries([]);
    setTypedLines({});
    setIsComplete(false);
    setExpandedFolders(new Set());

    let i = 0;

    const generateNext = () => {
      if (i >= allFiles.length) {
        setGeneratingPath(null);
        setIsComplete(true);
        addLog("--- Build complete ---");
        if (!hasCompletedRef.current) {
          hasCompletedRef.current = true;
          onComplete?.();
        }
        generationRef.current = false;
        return;
      }

      const file = allFiles[i];
      expandParents(file.path);
      setGeneratingPath(file.path);
      addLog(`Creating ${file.path}...`);

      // Brief pause to show spinner, then mark as generated
      const delay = 200 + Math.random() * 300;
      setTimeout(() => {
        setGeneratedPaths((prev) => {
          const next = new Set(prev);
          next.add(file.path);
          return next;
        });
        setGeneratingPath(null);

        // Auto-open the first file
        if (i === 0) {
          setActiveFile(file.path);
          setOpenTabs([file.path]);
        }

        i++;
        generateNext();
      }, delay);
    };

    // Kick off after a short initial delay
    addLog("Initializing project structure...");
    setTimeout(() => {
      addLog("Setting up database schema...");
      setTimeout(generateNext, 300);
    }, 400);
  }, [generating, spec, allFiles, expandParents, addLog, onComplete]);

  // Reset ref when generation prop turns off
  useEffect(() => {
    if (!generating) {
      generationRef.current = false;
    }
  }, [generating]);

  // When real files arrive, mark all as generated and open the first one
  useEffect(() => {
    if (!realFiles || realFiles.length === 0) return;
    const paths = new Set(realFiles.map((f) => f.path));
    setGeneratedPaths(paths);
    setGeneratingPath(null);
    setIsComplete(true);
    // Expand all parent folders
    for (const f of realFiles) {
      expandParents(f.path);
    }
    // Open the first file
    const first = realFiles[0];
    if (first) {
      setActiveFile(first.path);
      setOpenTabs([first.path]);
      setTypedLines({});
    }
    addLog("--- Loaded real generated files from server ---");
  }, [realFiles, expandParents, addLog]);

  // Typing effect: when a file becomes active, reveal lines one by one
  useEffect(() => {
    if (!activeFile) return;
    const file = allFiles.find((f) => f.path === activeFile);
    if (!file) return;
    const totalLines = file.content.split("\n").length;

    // If already fully typed, skip
    if ((typedLines[activeFile] || 0) >= totalLines) return;

    // Start from 0
    setTypedLines((prev) => ({ ...prev, [activeFile]: 0 }));
    let line = 0;
    const interval = setInterval(() => {
      line++;
      setTypedLines((prev) => ({ ...prev, [activeFile]: line }));
      if (line >= totalLines) clearInterval(interval);
    }, 18);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile]);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logEntries]);

  // Select a file
  const handleSelectFile = useCallback(
    (path: string) => {
      setActiveFile(path);
      if (!openTabs.includes(path)) {
        setOpenTabs((prev) => [...prev, path]);
      }
    },
    [openTabs]
  );

  // Close a tab
  const handleCloseTab = useCallback(
    (path: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setOpenTabs((prev) => prev.filter((p) => p !== path));
      if (activeFile === path) {
        const remaining = openTabs.filter((p) => p !== path);
        setActiveFile(remaining.length > 0 ? remaining[remaining.length - 1] : null);
      }
    },
    [activeFile, openTabs]
  );

  // Toggle folder
  const handleToggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Current file for editor
  const currentFile = activeFile
    ? allFiles.find((f) => f.path === activeFile)
    : null;
  const currentLines = currentFile ? currentFile.content.split("\n") : [];
  const visibleLineCount = typedLines[activeFile || ""] || 0;

  const fileCount = generatedPaths.size;
  const isGenerating = generating && !isComplete;

  return (
    <>
      {/* Keyframe animations */}
      <style>{`
        @keyframes ide-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes ide-fadeIn {
          from { opacity: 0; transform: translateX(-4px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes ide-blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        @keyframes ide-pulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
        .ide-scrollbar::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .ide-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .ide-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(100,100,100,0.3);
          border-radius: 4px;
        }
        .ide-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(100,100,100,0.5);
        }
      `}</style>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          backgroundColor: "#ffffff",
          borderRadius: 8,
          overflow: "hidden",
          border: "1px solid #e5e7eb",
          fontFamily:
            "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
          fontSize: 13,
        }}
      >
        {/* ── Top: File tree + Editor ── */}
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* ── File Tree (left) ── */}
          <div
            className="ide-scrollbar"
            style={{
              width: 220,
              minWidth: 220,
              borderRight: "1px solid #e5e7eb",
              backgroundColor: "#fafafa",
              overflowY: "auto",
              overflowX: "hidden",
              paddingTop: 8,
              paddingBottom: 8,
            }}
          >
            <div
              style={{
                padding: "4px 12px 8px",
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "#999",
              }}
            >
              Explorer
            </div>
            {fileTree.map((node) => (
              <FileTreeItem
                key={node.path}
                node={node}
                depth={0}
                activeFile={activeFile}
                generatedPaths={generatedPaths}
                generatingPath={generatingPath}
                expandedFolders={expandedFolders}
                onSelectFile={handleSelectFile}
                onToggleFolder={handleToggleFolder}
              />
            ))}
          </div>

          {/* ── Editor (right) ── */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
              backgroundColor: "#1e1e1e",
            }}
          >
            {/* Tab bar */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                backgroundColor: "#252526",
                borderBottom: "1px solid #3c3c3c",
                height: 35,
                minHeight: 35,
                overflowX: "auto",
                overflowY: "hidden",
              }}
            >
              {openTabs.map((tab) => {
                const file = allFiles.find((f) => f.path === tab);
                const name = tab.split("/").pop() || tab;
                const isTabActive = tab === activeFile;
                return (
                  <div
                    key={tab}
                    onClick={() => setActiveFile(tab)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "0 12px",
                      height: "100%",
                      cursor: "pointer",
                      backgroundColor: isTabActive ? "#1e1e1e" : "transparent",
                      borderBottom: isTabActive
                        ? "2px solid #ec4899"
                        : "2px solid transparent",
                      color: isTabActive ? "#fff" : "#888",
                      fontSize: 12,
                      whiteSpace: "nowrap",
                      transition: "background-color 0.1s",
                    }}
                  >
                    <FileCode2
                      size={12}
                      style={{ color: getFileColor(file?.language), flexShrink: 0 }}
                    />
                    <span>{name}</span>
                    <span
                      onClick={(e) => handleCloseTab(tab, e)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 16,
                        height: 16,
                        borderRadius: 3,
                        cursor: "pointer",
                        opacity: 0.5,
                        transition: "opacity 0.1s",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.opacity = "1";
                        (e.currentTarget as HTMLElement).style.backgroundColor =
                          "rgba(255,255,255,0.1)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.opacity = "0.5";
                        (e.currentTarget as HTMLElement).style.backgroundColor =
                          "transparent";
                      }}
                    >
                      <X size={10} />
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Code area */}
            <div
              className="ide-scrollbar"
              style={{
                flex: 1,
                overflowY: "auto",
                overflowX: "auto",
                padding: "12px 0",
              }}
            >
              {currentFile ? (
                <table
                  style={{
                    borderCollapse: "collapse",
                    minWidth: "100%",
                    lineHeight: "20px",
                  }}
                >
                  <tbody>
                    {currentLines.slice(0, visibleLineCount).map((line, idx) => (
                      <tr key={idx}>
                        <td
                          style={{
                            width: 50,
                            minWidth: 50,
                            textAlign: "right",
                            paddingRight: 16,
                            paddingLeft: 16,
                            color: "#5a5a5a",
                            userSelect: "none",
                            fontSize: 12,
                            verticalAlign: "top",
                          }}
                        >
                          {idx + 1}
                        </td>
                        <td
                          style={{
                            color: "#d4d4d4",
                            whiteSpace: "pre",
                            paddingRight: 24,
                          }}
                          dangerouslySetInnerHTML={{
                            __html:
                              highlightLine(
                                line,
                                currentFile.language
                              ) +
                              (idx === visibleLineCount - 1 &&
                              visibleLineCount < currentLines.length
                                ? '<span style="animation:ide-blink 0.8s step-end infinite;color:#ec4899">|</span>'
                                : ""),
                          }}
                        />
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100%",
                    color: "#555",
                    fontSize: 14,
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  {isGenerating ? (
                    <>
                      <Loader2
                        size={24}
                        style={{
                          color: "#ec4899",
                          animation: "ide-spin 1s linear infinite",
                        }}
                      />
                      <span>Generating project files...</span>
                    </>
                  ) : fileCount === 0 ? (
                    <span style={{ color: "#666" }}>
                      No files yet. Start generating to see your project.
                    </span>
                  ) : (
                    <span style={{ color: "#666" }}>
                      Select a file from the explorer to view its contents.
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Status Bar (bottom) ── */}
        <div
          style={{
            borderTop: "1px solid #e5e7eb",
            backgroundColor: "#f8f8f8",
          }}
        >
          {/* Expandable log section */}
          {logExpanded && (
            <div
              className="ide-scrollbar"
              style={{
                maxHeight: 140,
                overflowY: "auto",
                borderBottom: "1px solid #e5e7eb",
                backgroundColor: "#1e1e1e",
                padding: "8px 12px",
                fontSize: 12,
                fontFamily:
                  "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
                color: "#aaa",
              }}
            >
              {logEntries.map((entry, i) => (
                <div
                  key={i}
                  style={{
                    lineHeight: "20px",
                    animation: "ide-fadeIn 0.2s ease",
                    color: entry.startsWith("---")
                      ? "#4ade80"
                      : entry.includes("error")
                      ? "#f87171"
                      : "#aaa",
                  }}
                >
                  <span style={{ color: "#666", marginRight: 8 }}>$</span>
                  {entry}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          )}

          {/* Status bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "6px 12px",
              fontSize: 12,
              color: "#666",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {/* Terminal toggle */}
              <button
                onClick={() => setLogExpanded((p) => !p)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 6px",
                  border: "1px solid #e5e7eb",
                  borderRadius: 4,
                  background: logExpanded ? "rgba(236,72,153,0.08)" : "transparent",
                  cursor: "pointer",
                  color: logExpanded ? "#ec4899" : "#666",
                  fontSize: 12,
                  fontFamily: "inherit",
                  transition: "all 0.15s",
                }}
              >
                <Terminal size={12} />
                <span>Terminal</span>
                {logExpanded ? (
                  <ChevronDown size={10} />
                ) : (
                  <ChevronUp size={10} />
                )}
              </button>

              {/* Current file path */}
              {activeFile && (
                <span style={{ color: "#999" }}>{activeFile}</span>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              {/* Status */}
              {isGenerating && (
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    color: "#ec4899",
                  }}
                >
                  <Loader2
                    size={12}
                    style={{ animation: "ide-spin 1s linear infinite" }}
                  />
                  Generating...
                </span>
              )}
              {isComplete && (
                <span style={{ color: "#4ade80" }}>Build complete</span>
              )}

              {/* File count */}
              <span>
                {fileCount} file{fileCount !== 1 ? "s" : ""} generated
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
