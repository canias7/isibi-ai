from __future__ import annotations

"""
Multi-Language Support (i18n) API.

GET    /api/projects/{project_id}/i18n                    — list available locales
GET    /api/projects/{project_id}/i18n/{locale}           — get translations for locale
PUT    /api/projects/{project_id}/i18n/{locale}           — update translations
POST   /api/projects/{project_id}/i18n/auto-translate     — auto-translate from English
DELETE /api/projects/{project_id}/i18n/{locale}           — remove locale
"""

from typing import Optional

from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from auth import get_current_org_id
from models.project import Project
from models.app_translation import AppTranslation

router = APIRouter(tags=["i18n"])


# ── Common Terms Dictionary ────────────────────────────────────────

TRANSLATIONS: dict[str, dict[str, str]] = {
    "es": {
        "dashboard": "Tablero",
        "settings": "Configuracion",
        "users": "Usuarios",
        "leads": "Prospectos",
        "orders": "Pedidos",
        "products": "Productos",
        "name": "Nombre",
        "email": "Correo electronico",
        "phone": "Telefono",
        "status": "Estado",
        "active": "Activo",
        "inactive": "Inactivo",
        "create": "Crear",
        "edit": "Editar",
        "delete": "Eliminar",
        "save": "Guardar",
        "cancel": "Cancelar",
        "search": "Buscar",
        "filter": "Filtrar",
        "home": "Inicio",
        "profile": "Perfil",
        "logout": "Cerrar sesion",
        "login": "Iniciar sesion",
        "password": "Contrasena",
        "description": "Descripcion",
        "title": "Titulo",
        "date": "Fecha",
        "time": "Hora",
        "address": "Direccion",
        "city": "Ciudad",
        "country": "Pais",
        "company": "Empresa",
        "notes": "Notas",
        "comments": "Comentarios",
        "notifications": "Notificaciones",
        "reports": "Reportes",
        "analytics": "Analiticas",
        "tasks": "Tareas",
        "projects": "Proyectos",
        "clients": "Clientes",
        "invoices": "Facturas",
        "payments": "Pagos",
        "total": "Total",
        "price": "Precio",
        "quantity": "Cantidad",
        "category": "Categoria",
        "type": "Tipo",
        "actions": "Acciones",
        "details": "Detalles",
        "overview": "Vista general",
        "history": "Historial",
        "export": "Exportar",
        "import": "Importar",
        "upload": "Subir",
        "download": "Descargar",
        "submit": "Enviar",
        "approve": "Aprobar",
        "reject": "Rechazar",
        "pending": "Pendiente",
        "completed": "Completado",
        "in_progress": "En progreso",
    },
    "pt": {
        "dashboard": "Painel",
        "settings": "Configuracoes",
        "users": "Usuarios",
        "leads": "Leads",
        "orders": "Pedidos",
        "products": "Produtos",
        "name": "Nome",
        "email": "E-mail",
        "phone": "Telefone",
        "status": "Status",
        "active": "Ativo",
        "inactive": "Inativo",
        "create": "Criar",
        "edit": "Editar",
        "delete": "Excluir",
        "save": "Salvar",
        "cancel": "Cancelar",
        "search": "Pesquisar",
        "filter": "Filtrar",
        "home": "Inicio",
        "profile": "Perfil",
        "logout": "Sair",
        "login": "Entrar",
        "password": "Senha",
        "description": "Descricao",
        "title": "Titulo",
        "date": "Data",
        "time": "Hora",
        "address": "Endereco",
        "city": "Cidade",
        "country": "Pais",
        "company": "Empresa",
        "notes": "Notas",
        "comments": "Comentarios",
        "notifications": "Notificacoes",
        "reports": "Relatorios",
        "analytics": "Analiticas",
        "tasks": "Tarefas",
        "projects": "Projetos",
        "clients": "Clientes",
        "invoices": "Faturas",
        "payments": "Pagamentos",
        "total": "Total",
        "price": "Preco",
        "quantity": "Quantidade",
        "category": "Categoria",
        "type": "Tipo",
        "actions": "Acoes",
        "details": "Detalhes",
        "overview": "Visao geral",
        "history": "Historico",
        "export": "Exportar",
        "import": "Importar",
        "upload": "Enviar",
        "download": "Baixar",
        "submit": "Enviar",
        "approve": "Aprovar",
        "reject": "Rejeitar",
        "pending": "Pendente",
        "completed": "Concluido",
        "in_progress": "Em andamento",
    },
    "fr": {
        "dashboard": "Tableau de bord",
        "settings": "Parametres",
        "users": "Utilisateurs",
        "leads": "Prospects",
        "orders": "Commandes",
        "products": "Produits",
        "name": "Nom",
        "email": "E-mail",
        "phone": "Telephone",
        "status": "Statut",
        "active": "Actif",
        "inactive": "Inactif",
        "create": "Creer",
        "edit": "Modifier",
        "delete": "Supprimer",
        "save": "Enregistrer",
        "cancel": "Annuler",
        "search": "Rechercher",
        "filter": "Filtrer",
        "home": "Accueil",
        "profile": "Profil",
        "logout": "Deconnexion",
        "login": "Connexion",
        "password": "Mot de passe",
        "description": "Description",
        "title": "Titre",
        "date": "Date",
        "time": "Heure",
        "address": "Adresse",
        "city": "Ville",
        "country": "Pays",
        "company": "Entreprise",
        "notes": "Notes",
        "comments": "Commentaires",
        "notifications": "Notifications",
        "reports": "Rapports",
        "analytics": "Analytique",
        "tasks": "Taches",
        "projects": "Projets",
        "clients": "Clients",
        "invoices": "Factures",
        "payments": "Paiements",
        "total": "Total",
        "price": "Prix",
        "quantity": "Quantite",
        "category": "Categorie",
        "type": "Type",
        "actions": "Actions",
        "details": "Details",
        "overview": "Apercu",
        "history": "Historique",
        "export": "Exporter",
        "import": "Importer",
        "upload": "Telecharger",
        "download": "Telecharger",
        "submit": "Soumettre",
        "approve": "Approuver",
        "reject": "Rejeter",
        "pending": "En attente",
        "completed": "Termine",
        "in_progress": "En cours",
    },
    "de": {
        "dashboard": "Dashboard",
        "settings": "Einstellungen",
        "users": "Benutzer",
        "leads": "Leads",
        "orders": "Bestellungen",
        "products": "Produkte",
        "name": "Name",
        "email": "E-Mail",
        "phone": "Telefon",
        "status": "Status",
        "active": "Aktiv",
        "inactive": "Inaktiv",
        "create": "Erstellen",
        "edit": "Bearbeiten",
        "delete": "Loschen",
        "save": "Speichern",
        "cancel": "Abbrechen",
        "search": "Suchen",
        "filter": "Filtern",
        "home": "Startseite",
        "profile": "Profil",
        "logout": "Abmelden",
        "login": "Anmelden",
        "password": "Passwort",
        "description": "Beschreibung",
        "title": "Titel",
        "date": "Datum",
        "time": "Zeit",
        "address": "Adresse",
        "city": "Stadt",
        "country": "Land",
        "company": "Unternehmen",
        "notes": "Notizen",
        "comments": "Kommentare",
        "notifications": "Benachrichtigungen",
        "reports": "Berichte",
        "analytics": "Analysen",
        "tasks": "Aufgaben",
        "projects": "Projekte",
        "clients": "Kunden",
        "invoices": "Rechnungen",
        "payments": "Zahlungen",
        "total": "Gesamt",
        "price": "Preis",
        "quantity": "Menge",
        "category": "Kategorie",
        "type": "Typ",
        "actions": "Aktionen",
        "details": "Details",
        "overview": "Ubersicht",
        "history": "Verlauf",
        "export": "Exportieren",
        "import": "Importieren",
        "upload": "Hochladen",
        "download": "Herunterladen",
        "submit": "Absenden",
        "approve": "Genehmigen",
        "reject": "Ablehnen",
        "pending": "Ausstehend",
        "completed": "Abgeschlossen",
        "in_progress": "In Bearbeitung",
    },
}


# ── Schemas ────────────────────────────────────────────────────────

class LocaleInfo(BaseModel):
    model_config = {"from_attributes": True}

    locale: str
    is_default: bool


class TranslationRead(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    project_id: UUID
    locale: str
    translations: dict
    is_default: bool


class TranslationUpdate(BaseModel):
    translations: dict
    is_default: Optional[bool] = None


class AutoTranslateRequest(BaseModel):
    target_locale: str


class AutoTranslateResponse(BaseModel):
    locale: str
    translations: dict
    translated_count: int
    untranslated_keys: list[str]


# ── Helpers ────────────────────────────────────────────────────────

async def _get_project_for_org(
    db: AsyncSession, project_id: UUID, org_id: UUID
) -> Project:
    result = await db.execute(
        select(Project).where(
            Project.id == project_id,
            Project.org_id == org_id,
            Project.deleted_at.is_(None),
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _extract_translatable_keys(spec: dict) -> list[str]:
    """Extract translatable terms from the project spec."""
    keys: set[str] = set()
    entities = spec.get("entities", spec.get("modules", []))
    if isinstance(entities, dict):
        entities = list(entities.values())
    for entity in entities:
        name = entity.get("name", "") if isinstance(entity, dict) else str(entity)
        if name:
            keys.add(name.lower())
        fields = entity.get("fields", entity.get("columns", [])) if isinstance(entity, dict) else []
        if isinstance(fields, dict):
            fields = list(fields.values())
        for field in fields:
            fname = field.get("name", "") if isinstance(field, dict) else str(field)
            if fname:
                keys.add(fname.lower())
    # Add common UI terms
    keys.update([
        "dashboard", "settings", "create", "edit", "delete",
        "save", "cancel", "search", "filter", "status",
        "active", "inactive", "name", "email", "actions",
        "details", "overview",
    ])
    return sorted(keys)


# ── Endpoints ──────────────────────────────────────────────────────

@router.get(
    "/projects/{project_id}/i18n",
    response_model=list[LocaleInfo],
)
async def list_locales(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    """List available locales for a project."""
    await _get_project_for_org(db, project_id, org_id)

    result = await db.execute(
        select(AppTranslation).where(AppTranslation.project_id == project_id)
    )
    rows = result.scalars().all()
    return [LocaleInfo(locale=r.locale, is_default=r.is_default) for r in rows]


@router.get(
    "/projects/{project_id}/i18n/{locale}",
    response_model=TranslationRead,
)
async def get_translations(
    project_id: UUID,
    locale: str,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    """Get translations for a specific locale."""
    await _get_project_for_org(db, project_id, org_id)

    result = await db.execute(
        select(AppTranslation).where(
            AppTranslation.project_id == project_id,
            AppTranslation.locale == locale,
        )
    )
    translation = result.scalar_one_or_none()
    if not translation:
        raise HTTPException(status_code=404, detail=f"Locale '{locale}' not found")
    return translation


@router.put(
    "/projects/{project_id}/i18n/{locale}",
    response_model=TranslationRead,
)
async def update_translations(
    project_id: UUID,
    locale: str,
    body: TranslationUpdate,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    """Update translations for a locale (create if not exists)."""
    await _get_project_for_org(db, project_id, org_id)

    result = await db.execute(
        select(AppTranslation).where(
            AppTranslation.project_id == project_id,
            AppTranslation.locale == locale,
        )
    )
    translation = result.scalar_one_or_none()

    if translation is None:
        translation = AppTranslation(
            project_id=project_id,
            locale=locale,
            translations=body.translations,
            is_default=body.is_default if body.is_default is not None else False,
        )
        db.add(translation)
    else:
        merged = {**(translation.translations or {}), **body.translations}
        translation.translations = merged
        if body.is_default is not None:
            translation.is_default = body.is_default

    await db.commit()
    await db.refresh(translation)
    return translation


@router.post(
    "/projects/{project_id}/i18n/auto-translate",
    response_model=AutoTranslateResponse,
)
async def auto_translate(
    project_id: UUID,
    body: AutoTranslateRequest,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    """Auto-translate from English using hardcoded dictionary."""
    project = await _get_project_for_org(db, project_id, org_id)

    target = body.target_locale.lower()
    if target not in TRANSLATIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported locale '{target}'. Supported: {', '.join(sorted(TRANSLATIONS.keys()))}",
        )

    # Extract translatable keys from spec
    keys = _extract_translatable_keys(project.spec or {})
    dictionary = TRANSLATIONS[target]

    translated: dict[str, str] = {}
    untranslated: list[str] = []
    for key in keys:
        if key in dictionary:
            translated[key] = dictionary[key]
        else:
            untranslated.append(key)
            # Keep original as fallback
            translated[key] = key

    # Upsert translation record
    result = await db.execute(
        select(AppTranslation).where(
            AppTranslation.project_id == project_id,
            AppTranslation.locale == target,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        merged = {**(existing.translations or {}), **translated}
        existing.translations = merged
    else:
        existing = AppTranslation(
            project_id=project_id,
            locale=target,
            translations=translated,
            is_default=False,
        )
        db.add(existing)

    await db.commit()

    return AutoTranslateResponse(
        locale=target,
        translations=translated,
        translated_count=len(translated) - len(untranslated),
        untranslated_keys=untranslated,
    )


@router.delete(
    "/projects/{project_id}/i18n/{locale}",
    status_code=204,
)
async def delete_locale(
    project_id: UUID,
    locale: str,
    db: AsyncSession = Depends(get_db),
    org_id: UUID = Depends(get_current_org_id),
):
    """Remove a locale and its translations."""
    await _get_project_for_org(db, project_id, org_id)

    result = await db.execute(
        select(AppTranslation).where(
            AppTranslation.project_id == project_id,
            AppTranslation.locale == locale,
        )
    )
    translation = result.scalar_one_or_none()
    if not translation:
        raise HTTPException(status_code=404, detail=f"Locale '{locale}' not found")

    await db.delete(translation)
    await db.commit()
