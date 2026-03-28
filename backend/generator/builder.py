"""
Auto-Builder — takes a generated spec JSON and produces a working FastAPI backend.

Generates:
  - models/{entity}.py        (SQLAlchemy model)
  - schemas/{entity}.py       (Pydantic schemas)
  - routes/{entity}.py        (CRUD endpoints)
  - models/__init__.py         (re-exports)
  - routes/__init__.py         (router registry)
  - main.py                    (app entry point)
  - db.py                      (database config)
  - auth.py                    (JWT auth)
  - requirements.txt

The generated code reuses the same patterns as the existing CRM backend —
cursor-based pagination, soft delete, org_id filtering, optimistic locking.
"""

import logging
import os
import json
from pathlib import Path
from textwrap import dedent

logger = logging.getLogger(__name__)

# ── Type mapping ────────────────────────────────────────────────────

DB_TYPE_TO_SA: dict[str, str] = {
    "UUID": "pg.UUID(as_uuid=True)",
    "VARCHAR(100)": "String(100)",
    "VARCHAR(150)": "String(150)",
    "VARCHAR(200)": "String(200)",
    "VARCHAR(255)": "String(255)",
    "VARCHAR(320)": "String(320)",
    "VARCHAR(50)": "String(50)",
    "VARCHAR(20)": "String(20)",
    "VARCHAR(10)": "String(10)",
    "TEXT": "Text",
    "BOOLEAN": "Boolean",
    "INTEGER": "Integer",
    "SMALLINT": "SmallInteger",
    "NUMERIC(12,2)": "Numeric(12, 2)",
    "NUMERIC(5,2)": "Numeric(5, 2)",
    "TIMESTAMPTZ": "DateTime(timezone=True)",
    "DATE": "Date",
    "JSONB": "JSONB",
}

DB_TYPE_TO_PYDANTIC: dict[str, str] = {
    "UUID": "UUID",
    "TEXT": "str",
    "BOOLEAN": "bool",
    "INTEGER": "int",
    "SMALLINT": "int",
    "NUMERIC(12,2)": "float",
    "NUMERIC(5,2)": "float",
    "TIMESTAMPTZ": "datetime",
    "DATE": "date",
    "JSONB": "dict | list | None",
}


def _sa_type(db_type: str) -> str:
    """Convert spec db_type to SQLAlchemy column type."""
    # Handle ENUM types
    if db_type.startswith("ENUM"):
        return db_type  # Handled specially in model generation
    # Handle VARCHAR with any length
    if db_type.startswith("VARCHAR"):
        import re
        m = re.match(r"VARCHAR\((\d+)\)", db_type)
        if m:
            return f"String({m.group(1)})"
        return "String(255)"
    return DB_TYPE_TO_SA.get(db_type, "String(255)")


def _pydantic_type(field: dict) -> str:
    """Convert spec field to Pydantic type annotation."""
    db_type = field.get("db_type", "TEXT")
    nullable = field.get("nullable", False)

    # Enums → Literal
    if db_type.startswith("ENUM") and field.get("enum_values"):
        values = ", ".join(f'"{v}"' for v in field["enum_values"])
        base = f"Literal[{values}]"
    elif db_type.startswith("VARCHAR"):
        base = "str"
    elif db_type == "JSONB" and field.get("ts_type") == "string[]":
        base = "list[str]"
    else:
        base = DB_TYPE_TO_PYDANTIC.get(db_type, "str")

    if nullable:
        return f"{base} | None"
    return base


def _snake(name: str) -> str:
    """PascalCase → snake_case."""
    import re
    s = re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()
    return s


# ── Code generators ─────────────────────────────────────────────────

def _gen_model(entity: dict) -> str:
    """Generate SQLAlchemy model file for one entity."""
    name = entity["name"]
    table = entity["table"]
    fields = entity.get("fields", [])

    imports = {
        "import uuid",
        "from datetime import datetime",
        "from sqlalchemy import Column, String, Boolean, Integer, SmallInteger, Text, DateTime, Date, Numeric, ForeignKey",
        "from sqlalchemy.dialects.postgresql import UUID as pgUUID, JSONB",
        "from db import Base",
    }

    # Check if we need Enum
    has_enum = any(f["db_type"].startswith("ENUM") for f in fields)
    if has_enum:
        imports.add("from sqlalchemy import Enum as SAEnum")

    lines: list[str] = []
    lines.append("\n".join(sorted(imports)))
    lines.append("")
    lines.append("")
    lines.append(f"class {name}(Base):")
    lines.append(f'    __tablename__ = "{table}"')
    lines.append("")

    for field in fields:
        col_name = field["name"]
        db_type = field.get("db_type", "TEXT")
        nullable = field.get("nullable", False)
        primary_key = field.get("primary_key", False)
        default = field.get("default")

        # Build column args
        col_args: list[str] = []

        if db_type == "UUID":
            col_args.append("pgUUID(as_uuid=True)")
        elif db_type.startswith("ENUM"):
            enum_vals = field.get("enum_values", [])
            vals_str = ", ".join(f'"{v}"' for v in enum_vals)
            enum_name = f"{table}_{col_name}"
            col_args.append(f'SAEnum({vals_str}, name="{enum_name}")')
        else:
            col_args.append(_sa_type(db_type))

        # FK
        if field.get("fk_entity"):
            fk_table = _snake(field["fk_entity"]) + "s"
            col_args.append(f'ForeignKey("{fk_table}.id")')

        # Kwargs
        kwargs: list[str] = []
        if primary_key:
            kwargs.append("primary_key=True")
            kwargs.append("default=uuid.uuid4")
        if nullable and not primary_key:
            kwargs.append("nullable=True")
        elif not nullable and not primary_key:
            kwargs.append("nullable=False")

        if default is not None and not primary_key:
            if isinstance(default, bool):
                kwargs.append(f"default={default}")
            elif isinstance(default, (int, float)):
                kwargs.append(f"default={default}")
            elif default == "now()":
                kwargs.append("default=datetime.utcnow")
            elif isinstance(default, str):
                kwargs.append(f'default="{default}"')

        # Auto-set fields
        auto_set = field.get("auto_set")
        if auto_set == "on_create":
            kwargs.append("default=datetime.utcnow")
        elif auto_set == "on_update":
            kwargs.append("onupdate=datetime.utcnow")

        args_str = ", ".join(col_args + kwargs)
        lines.append(f"    {col_name} = Column({args_str})")

    return "\n".join(lines) + "\n"


def _gen_schema(entity: dict) -> str:
    """Generate Pydantic schema file for one entity."""
    name = entity["name"]
    fields = entity.get("fields", [])

    imports = {
        "from __future__ import annotations",
        "from uuid import UUID",
        "from datetime import datetime, date",
        "from typing import Literal",
        "from pydantic import BaseModel, Field",
    }

    lines: list[str] = []
    lines.append("\n".join(sorted(imports)))
    lines.append("")
    lines.append("")

    # ── Response schema (all fields)
    lines.append(f"class {name}Response(BaseModel):")
    lines.append("    model_config = {'from_attributes': True}")
    lines.append("")
    for field in fields:
        ftype = _pydantic_type(field)
        nullable = field.get("nullable", False)
        if nullable and "None" not in ftype:
            ftype = f"{ftype} | None"
        default = " = None" if nullable else ""
        lines.append(f"    {field['name']}: {ftype}{default}")
    lines.append("")
    lines.append("")

    # ── Create schema (form fields only)
    create_fields = [f for f in fields if f.get("show_in_form", False)]
    lines.append(f"class {name}Create(BaseModel):")
    if not create_fields:
        lines.append("    pass")
    else:
        for field in create_fields:
            ftype = _pydantic_type(field)
            nullable = field.get("nullable", False)
            validation = field.get("validation", {})
            required = validation.get("required", False) if isinstance(validation, dict) else False
            if nullable or not required:
                ftype = f"{ftype} | None"
                lines.append(f"    {field['name']}: {ftype} = None")
            else:
                lines.append(f"    {field['name']}: {ftype}")
    lines.append("")
    lines.append("")

    # ── Update schema (all optional)
    lines.append(f"class {name}Update(BaseModel):")
    if not create_fields:
        lines.append("    pass")
    else:
        for field in create_fields:
            ftype = _pydantic_type(field)
            if "None" not in ftype:
                ftype = f"{ftype} | None"
            lines.append(f"    {field['name']}: {ftype} = None")

    return "\n".join(lines) + "\n"


def _gen_route(entity: dict) -> str:
    """Generate FastAPI router for one entity with full CRUD."""
    name = entity["name"]
    table = entity["table"]
    snake = _snake(name)

    return dedent(f"""\
        from uuid import UUID
        from fastapi import APIRouter, Depends, Query
        from sqlalchemy.ext.asyncio import AsyncSession

        from db import get_db
        from auth import get_current_org_id
        from models.{snake} import {name}
        from schemas.{snake} import {name}Create, {name}Update, {name}Response
        from routes.crud import paginated_list, get_one, create_one, update_one, soft_delete

        router = APIRouter(prefix="/{table}", tags=["{name}"])


        @router.get("", response_model=dict)
        async def list_{table}(
            limit: int = Query(25, ge=1, le=100),
            cursor: str | None = Query(None),
            db: AsyncSession = Depends(get_db),
            org_id: UUID = Depends(get_current_org_id),
        ):
            return await paginated_list(db, {name}, org_id, limit, cursor)


        @router.get("/{{record_id}}", response_model={name}Response)
        async def get_{snake}(
            record_id: UUID,
            db: AsyncSession = Depends(get_db),
            org_id: UUID = Depends(get_current_org_id),
        ):
            return await get_one(db, {name}, record_id, org_id)


        @router.post("", response_model={name}Response, status_code=201)
        async def create_{snake}(
            body: {name}Create,
            db: AsyncSession = Depends(get_db),
            org_id: UUID = Depends(get_current_org_id),
        ):
            return await create_one(db, {name}, org_id, body.model_dump(exclude_unset=True))


        @router.patch("/{{record_id}}", response_model={name}Response)
        async def update_{snake}(
            record_id: UUID,
            body: {name}Update,
            db: AsyncSession = Depends(get_db),
            org_id: UUID = Depends(get_current_org_id),
        ):
            return await update_one(db, {name}, record_id, org_id, body.model_dump(exclude_unset=True))


        @router.delete("/{{record_id}}", status_code=204)
        async def delete_{snake}(
            record_id: UUID,
            db: AsyncSession = Depends(get_db),
            org_id: UUID = Depends(get_current_org_id),
        ):
            await soft_delete(db, {name}, record_id, org_id)
    """)


def _gen_models_init(entities: list[dict]) -> str:
    """Generate models/__init__.py."""
    lines: list[str] = []
    names: list[str] = []
    for ent in entities:
        name = ent["name"]
        snake = _snake(name)
        lines.append(f"from .{snake} import {name}")
        names.append(name)
    lines.append("")
    all_str = ", ".join(f'"{n}"' for n in names)
    lines.append(f"__all__ = [{all_str}]")
    return "\n".join(lines) + "\n"


def _gen_routes_init(entities: list[dict]) -> str:
    """Generate routes/__init__.py."""
    lines: list[str] = []
    router_names: list[str] = []
    for ent in entities:
        snake = _snake(ent["name"])
        alias = f"{snake}_router"
        lines.append(f"from .{snake} import router as {alias}")
        router_names.append(alias)
    lines.append("")
    items = ",\n    ".join(router_names)
    lines.append(f"all_routers = [\n    {items},\n]")
    return "\n".join(lines) + "\n"


def _gen_main(spec: dict) -> str:
    """Generate main.py."""
    app_name = spec.get("_meta", {}).get("app_name", "Generated App")
    return dedent(f"""\
        import sys
        import os

        sys.path.insert(0, os.path.dirname(__file__))

        from contextlib import asynccontextmanager
        from fastapi import FastAPI
        from fastapi.middleware.cors import CORSMiddleware
        from db import engine, Base
        from routes import all_routers


        @asynccontextmanager
        async def lifespan(app: FastAPI):
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            yield
            await engine.dispose()


        app = FastAPI(
            title="{app_name} API",
            version="1.0.0",
            description="Auto-generated API from spec",
            lifespan=lifespan,
        )

        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

        for router in all_routers:
            app.include_router(router, prefix="/api")


        @app.get("/health")
        async def health():
            return {{"status": "ok"}}


        @app.get("/api/spec")
        async def serve_spec():
            import json
            spec_path = os.path.join(os.path.dirname(__file__), "spec.json")
            with open(spec_path) as f:
                return json.load(f)
    """)


def _gen_static_files() -> dict[str, str]:
    """Generate db.py, auth.py, requirements.txt, routes/crud.py."""
    files: dict[str, str] = {}

    files["db.py"] = dedent("""\
        import os
        from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
        from sqlalchemy.orm import DeclarativeBase

        DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/app")

        engine = create_async_engine(DATABASE_URL, echo=False, pool_size=20, max_overflow=10)
        async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


        class Base(DeclarativeBase):
            pass


        async def get_db() -> AsyncSession:
            async with async_session() as session:
                yield session
    """)

    files["auth.py"] = dedent("""\
        import os
        from uuid import UUID
        from fastapi import Depends, HTTPException, status
        from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
        from jose import JWTError, jwt

        JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production")
        JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")

        security = HTTPBearer()


        async def get_current_org_id(
            credentials: HTTPAuthorizationCredentials = Depends(security),
        ) -> UUID:
            try:
                payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
                org_id = payload.get("org_id")
                if org_id is None:
                    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing org_id")
                return UUID(org_id)
            except JWTError:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


        async def get_current_user_id(
            credentials: HTTPAuthorizationCredentials = Depends(security),
        ) -> UUID:
            try:
                payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
                user_id = payload.get("sub")
                if user_id is None:
                    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing sub")
                return UUID(user_id)
            except JWTError:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    """)

    files["requirements.txt"] = dedent("""\
        fastapi==0.115.0
        uvicorn[standard]==0.30.6
        sqlalchemy[asyncio]==2.0.35
        asyncpg==0.29.0
        alembic==1.13.2
        pydantic==2.9.2
        pydantic-settings==2.5.2
        python-jose[cryptography]==3.3.0
        python-multipart==0.0.9
    """)

    # crud.py is copied from the existing backend
    files["routes/crud.py"] = dedent("""\
        \"\"\"Shared CRUD helpers with cursor-based pagination, soft delete, and org_id filtering.\"\"\"

        import base64
        from datetime import datetime, timezone
        from uuid import UUID

        from fastapi import HTTPException, status
        from sqlalchemy import select, func, and_
        from sqlalchemy.ext.asyncio import AsyncSession


        async def paginated_list(db, model, org_id, limit=25, cursor=None):
            if limit > 100:
                limit = 100
            base_filter = and_(model.org_id == org_id, model.deleted_at.is_(None))
            count_q = select(func.count()).select_from(model).where(base_filter)
            total = (await db.execute(count_q)).scalar_one()
            q = select(model).where(base_filter).order_by(model.created_at.desc(), model.id)
            if cursor:
                try:
                    decoded = base64.urlsafe_b64decode(cursor.encode()).decode()
                    cursor_ts, cursor_id = decoded.rsplit("|", 1)
                    cursor_dt = datetime.fromisoformat(cursor_ts)
                    q = q.where(
                        (model.created_at < cursor_dt)
                        | (and_(model.created_at == cursor_dt, model.id > UUID(cursor_id)))
                    )
                except Exception:
                    raise HTTPException(status_code=400, detail="Invalid cursor")
            q = q.limit(limit + 1)
            result = await db.execute(q)
            rows = list(result.scalars().all())
            has_more = len(rows) > limit
            data = rows[:limit]
            next_cursor = None
            if has_more and data:
                last = data[-1]
                raw = f"{last.created_at.isoformat()}|{last.id}"
                next_cursor = base64.urlsafe_b64encode(raw.encode()).decode()
            return {"data": data, "meta": {"total": total, "limit": limit, "cursor": next_cursor, "has_more": has_more}}


        async def get_one(db, model, record_id, org_id):
            q = select(model).where(and_(model.id == record_id, model.org_id == org_id, model.deleted_at.is_(None)))
            result = await db.execute(q)
            obj = result.scalar_one_or_none()
            if obj is None:
                raise HTTPException(status_code=404, detail="Not found")
            return obj


        async def create_one(db, model, org_id, data):
            obj = model(**data, org_id=org_id)
            db.add(obj)
            await db.commit()
            await db.refresh(obj)
            return obj


        async def update_one(db, model, record_id, org_id, data):
            obj = await get_one(db, model, record_id, org_id)
            incoming_version = data.pop("version", None)
            if incoming_version is not None and obj.version != incoming_version:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Record was modified by another user.")
            for key, value in data.items():
                setattr(obj, key, value)
            obj.version += 1
            obj.updated_at = datetime.now(timezone.utc)
            await db.commit()
            await db.refresh(obj)
            return obj


        async def soft_delete(db, model, record_id, org_id):
            obj = await get_one(db, model, record_id, org_id)
            obj.deleted_at = datetime.now(timezone.utc)
            obj.updated_at = datetime.now(timezone.utc)
            await db.commit()
    """)

    return files


# ── Main build function ─────────────────────────────────────────────

def build_backend(spec: dict, output_dir: str) -> dict[str, str]:
    """
    Generate a complete FastAPI backend from a spec.

    Args:
        spec: The app spec (generated by AI or loaded from file)
        output_dir: Where to write the generated files

    Returns:
        Dict mapping relative file paths to their content

    Error recovery:
    - Skips entities that aren't valid dicts
    - Auto-fixes malformed field attributes (strings where dicts/lists expected)
    - Auto-generates table names from entity names if missing
    - Ensures every field has required db_type and ts_type defaults
    - Logs warnings for skipped/fixed entities instead of crashing
    """
    entities = spec.get("entities", [])
    if not isinstance(entities, list):
        logger.warning("spec['entities'] is not a list (%s), defaulting to empty", type(entities).__name__)
        entities = []

    clean_entities = []
    for i, ent in enumerate(entities):
        if not isinstance(ent, dict):
            logger.warning("Skipping entity at index %d: not a dict (%s)", i, type(ent).__name__)
            continue

        # Auto-generate table name from entity name if missing
        if "name" not in ent:
            logger.warning("Skipping entity at index %d: missing 'name'", i)
            continue
        if "table" not in ent:
            import re as _re
            ent["table"] = _re.sub(r"(?<!^)(?=[A-Z])", "_", ent["name"]).lower() + "s"
            logger.info("Auto-generated table name '%s' for entity '%s'", ent["table"], ent["name"])

        # Ensure fields is a list
        if "fields" not in ent or not isinstance(ent.get("fields"), list):
            ent["fields"] = []
            logger.warning("Entity '%s' had no valid fields array, set to empty", ent["name"])

        ent["fields"] = [f for f in ent["fields"] if isinstance(f, dict)]
        for f in ent["fields"]:
            # Fix validation if it's a string
            if "validation" in f and not isinstance(f["validation"], dict):
                f["validation"] = {}
            # Fix badge_colors if it's a string
            if "badge_colors" in f and not isinstance(f["badge_colors"], dict):
                f["badge_colors"] = {}
            # Fix enum_values if it's a string
            if "enum_values" in f and not isinstance(f["enum_values"], list):
                if isinstance(f["enum_values"], str):
                    f["enum_values"] = [v.strip() for v in f["enum_values"].split(",")]
                else:
                    f["enum_values"] = []
            # Ensure required field attributes have defaults
            f.setdefault("db_type", "TEXT")
            f.setdefault("ts_type", "string")
            f.setdefault("nullable", True)
            f.setdefault("editable", True)
            f.setdefault("show_in_table", True)
            f.setdefault("show_in_form", True)
            f.setdefault("input_component", "TextInput")
            f.setdefault("display_component", "Text")

        # Ensure description
        ent.setdefault("description", f"{ent['name']} management")

        clean_entities.append(ent)

    if not clean_entities:
        logger.error("No valid entities found in spec — build will produce minimal output")

    entities = clean_entities
    generated: dict[str, str] = {}

    # Ensure directories
    out = Path(output_dir)
    (out / "models").mkdir(parents=True, exist_ok=True)
    (out / "schemas").mkdir(parents=True, exist_ok=True)
    (out / "routes").mkdir(parents=True, exist_ok=True)

    # Per-entity files
    for ent in entities:
        snake = _snake(ent["name"])
        try:
            model_code = _gen_model(ent)
            schema_code = _gen_schema(ent)
            route_code = _gen_route(ent)

            generated[f"models/{snake}.py"] = model_code
            generated[f"schemas/{snake}.py"] = schema_code
            generated[f"routes/{snake}.py"] = route_code
        except Exception as e:
            logger.error("Failed to generate code for entity '%s': %s", ent["name"], e)
            # Continue with other entities rather than crashing
            continue

    # Init files
    generated["models/__init__.py"] = _gen_models_init(entities)
    generated["routes/__init__.py"] = _gen_routes_init(entities)

    # Main + static files
    generated["main.py"] = _gen_main(spec)
    static = _gen_static_files()
    generated.update(static)

    # Save the spec itself
    generated["spec.json"] = json.dumps(spec, indent=2)

    # Write all files
    for rel_path, content in generated.items():
        full_path = out / rel_path
        full_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            full_path.write_text(content)
        except OSError as e:
            logger.error("Failed to write %s: %s", full_path, e)

    return generated
