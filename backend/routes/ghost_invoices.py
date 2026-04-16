"""Invoice dashboard API for Bill Catcher and similar agents.

Endpoints:
  GET    /ghost/invoices          — list invoices (filterable by status, searchable)
  GET    /ghost/invoices/stats    — summary counts + totals for the dashboard header
  GET    /ghost/invoices/{id}     — single invoice detail
  PATCH  /ghost/invoices/{id}     — update status (approve / reject / mark paid), add notes
  DELETE /ghost/invoices/{id}     — hard delete an invoice

  GET    /invoices                — serves the web dashboard HTML (no /api prefix)

All endpoints require the same ghost JWT token as ghost_agents.
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Header, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy import text as sql_text
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from fastapi import Depends

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ghost/invoices", tags=["ghost-invoices"])

# Dashboard HTML page router (served without /api prefix)
dashboard_router = APIRouter(tags=["ghost-invoices-dashboard"])

_DASHBOARD_HTML: str | None = None


def _load_dashboard_html() -> str:
    global _DASHBOARD_HTML
    if _DASHBOARD_HTML is None:
        tpl_path = os.path.join(os.path.dirname(__file__), "..", "templates", "invoice_dashboard.html")
        with open(tpl_path, "r") as f:
            _DASHBOARD_HTML = f.read()
    return _DASHBOARD_HTML


@dashboard_router.get("/invoices", response_class=HTMLResponse)
async def invoice_dashboard_page():
    return HTMLResponse(content=_load_dashboard_html())


# ── Auth (same as ghost_agents) ──────────────────────────────────────


def _verify_auth(authorization: str) -> dict:
    from routes.ghost_auth import verify_ghost_token
    token = authorization.replace("Bearer ", "")
    return verify_ghost_token(token)


def _ws(value: Optional[str]) -> str:
    if not value:
        return "personal"
    s = "".join(c for c in str(value) if c.isalnum() or c in ("_", "-"))[:100]
    return s or "personal"


# ── Request models ───────────────────────────────────────────────────


class InvoiceUpdate(BaseModel):
    status: Optional[str] = None
    notes: Optional[str] = None


# ── GET /ghost/invoices — list with filters ──────────────────────────


@router.get("")
async def list_invoices(
    authorization: str = Header(...),
    workspace_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    sort: Optional[str] = Query("newest"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    claims = _verify_auth(authorization)
    uid = claims["user_id"]
    ws = _ws(workspace_id)

    from routes.ghost_agents import ensure_agents_schema
    await ensure_agents_schema(db)

    conditions = ["user_id = :uid", "workspace_id = :ws"]
    params: dict = {"uid": uid, "ws": ws, "lim": limit, "off": offset}

    if status and status in ("pending", "approved", "rejected", "paid"):
        conditions.append("status = :status")
        params["status"] = status

    if search:
        conditions.append(
            "(LOWER(vendor_name) LIKE :q OR LOWER(invoice_number) LIKE :q "
            "OR LOWER(source_email_from) LIKE :q)"
        )
        params["q"] = f"%{search.lower().strip()[:100]}%"

    where = " AND ".join(conditions)

    order = "created_at DESC"
    if sort == "oldest":
        order = "created_at ASC"
    elif sort == "amount_high":
        order = "amount DESC NULLS LAST"
    elif sort == "amount_low":
        order = "amount ASC NULLS LAST"
    elif sort == "due_date":
        order = "due_date ASC NULLS LAST"

    res = await db.execute(sql_text(
        f"SELECT id, vendor_name, invoice_number, amount, currency, "
        f"due_date, status, items, source_email_from, source_email_subject, "
        f"source_email_date, notes, approved_at, paid_at, created_at "
        f"FROM ghost_invoices WHERE {where} "
        f"ORDER BY {order} LIMIT :lim OFFSET :off"
    ), params)
    rows = res.all()

    count_res = await db.execute(sql_text(
        f"SELECT COUNT(*) FROM ghost_invoices WHERE {where}"
    ), params)
    total = count_res.scalar() or 0

    invoices = []
    for r in rows:
        invoices.append({
            "id": str(r[0]),
            "vendor_name": r[1],
            "invoice_number": r[2],
            "amount": float(r[3]) if r[3] is not None else None,
            "currency": r[4],
            "due_date": str(r[5]) if r[5] else None,
            "status": r[6],
            "items": r[7] or [],
            "source_email_from": r[8],
            "source_email_subject": r[9],
            "source_email_date": r[10].isoformat() if r[10] else None,
            "notes": r[11],
            "approved_at": r[12].isoformat() if r[12] else None,
            "paid_at": r[13].isoformat() if r[13] else None,
            "created_at": r[14].isoformat() if r[14] else None,
        })

    return {"invoices": invoices, "total": total}


# ── GET /ghost/invoices/stats — dashboard summary ────────────────────


@router.get("/stats")
async def invoice_stats(
    authorization: str = Header(...),
    workspace_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    claims = _verify_auth(authorization)
    uid = claims["user_id"]
    ws = _ws(workspace_id)

    from routes.ghost_agents import ensure_agents_schema
    await ensure_agents_schema(db)

    res = await db.execute(sql_text("""
        SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'pending')  AS pending,
            COUNT(*) FILTER (WHERE status = 'approved')  AS approved,
            COUNT(*) FILTER (WHERE status = 'rejected')  AS rejected,
            COUNT(*) FILTER (WHERE status = 'paid')      AS paid,
            COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0)  AS pending_amount,
            COALESCE(SUM(amount) FILTER (WHERE status = 'approved'), 0) AS approved_amount,
            COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0)     AS paid_amount,
            COALESCE(SUM(amount), 0)                                     AS total_amount,
            COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND status IN ('pending', 'approved')) AS overdue
        FROM ghost_invoices
        WHERE user_id = :uid AND workspace_id = :ws
    """), {"uid": uid, "ws": ws})
    row = res.first()

    return {
        "total": row[0] or 0,
        "pending": row[1] or 0,
        "approved": row[2] or 0,
        "rejected": row[3] or 0,
        "paid": row[4] or 0,
        "pending_amount": float(row[5] or 0),
        "approved_amount": float(row[6] or 0),
        "paid_amount": float(row[7] or 0),
        "total_amount": float(row[8] or 0),
        "overdue": row[9] or 0,
    }


# ── GET /ghost/invoices/{id} — single invoice ────────────────────────


@router.get("/{invoice_id}")
async def get_invoice(
    invoice_id: str,
    authorization: str = Header(...),
    workspace_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    claims = _verify_auth(authorization)
    uid = claims["user_id"]
    ws = _ws(workspace_id)

    from routes.ghost_agents import ensure_agents_schema
    await ensure_agents_schema(db)

    res = await db.execute(sql_text(
        "SELECT id, vendor_name, invoice_number, amount, currency, "
        "due_date, status, items, source_email_from, source_email_subject, "
        "source_email_date, raw_extraction, notes, agent_client_id, "
        "approved_by, approved_at, paid_at, created_at, updated_at "
        "FROM ghost_invoices "
        "WHERE id = :iid AND user_id = :uid AND workspace_id = :ws"
    ), {"iid": invoice_id, "uid": uid, "ws": ws})
    row = res.first()
    if not row:
        raise HTTPException(status_code=404, detail="Invoice not found")

    return {
        "id": str(row[0]),
        "vendor_name": row[1],
        "invoice_number": row[2],
        "amount": float(row[3]) if row[3] is not None else None,
        "currency": row[4],
        "due_date": str(row[5]) if row[5] else None,
        "status": row[6],
        "items": row[7] or [],
        "source_email_from": row[8],
        "source_email_subject": row[9],
        "source_email_date": row[10].isoformat() if row[10] else None,
        "raw_extraction": row[11] or {},
        "notes": row[12],
        "agent_client_id": row[13],
        "approved_by": str(row[14]) if row[14] else None,
        "approved_at": row[15].isoformat() if row[15] else None,
        "paid_at": row[16].isoformat() if row[16] else None,
        "created_at": row[17].isoformat() if row[17] else None,
        "updated_at": row[18].isoformat() if row[18] else None,
    }


# ── PATCH /ghost/invoices/{id} — update status / notes ───────────────


@router.patch("/{invoice_id}")
async def update_invoice(
    invoice_id: str,
    body: InvoiceUpdate,
    authorization: str = Header(...),
    workspace_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    claims = _verify_auth(authorization)
    uid = claims["user_id"]
    ws = _ws(workspace_id)

    from routes.ghost_agents import ensure_agents_schema
    await ensure_agents_schema(db)

    # Verify invoice exists and belongs to user
    check = await db.execute(sql_text(
        "SELECT id FROM ghost_invoices WHERE id = :iid AND user_id = :uid AND workspace_id = :ws"
    ), {"iid": invoice_id, "uid": uid, "ws": ws})
    if not check.first():
        raise HTTPException(status_code=404, detail="Invoice not found")

    sets = ["updated_at = NOW()"]
    params: dict = {"iid": invoice_id, "uid": uid, "ws": ws}

    if body.status:
        allowed = ("pending", "approved", "rejected", "paid")
        if body.status not in allowed:
            raise HTTPException(status_code=400, detail=f"Status must be one of: {', '.join(allowed)}")
        sets.append("status = :status")
        params["status"] = body.status
        if body.status == "approved":
            sets.append("approved_by = :approver")
            sets.append("approved_at = NOW()")
            params["approver"] = uid
        elif body.status == "paid":
            sets.append("paid_at = NOW()")

    if body.notes is not None:
        sets.append("notes = :notes")
        params["notes"] = body.notes

    await db.execute(sql_text(
        f"UPDATE ghost_invoices SET {', '.join(sets)} "
        f"WHERE id = :iid AND user_id = :uid AND workspace_id = :ws"
    ), params)
    await db.commit()

    return {"ok": True, "invoice_id": invoice_id, "status": body.status}


# ── DELETE /ghost/invoices/{id} ──────────────────────────────────────


@router.delete("/{invoice_id}")
async def delete_invoice(
    invoice_id: str,
    authorization: str = Header(...),
    workspace_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    claims = _verify_auth(authorization)
    uid = claims["user_id"]
    ws = _ws(workspace_id)

    from routes.ghost_agents import ensure_agents_schema
    await ensure_agents_schema(db)

    res = await db.execute(sql_text(
        "DELETE FROM ghost_invoices WHERE id = :iid AND user_id = :uid AND workspace_id = :ws"
    ), {"iid": invoice_id, "uid": uid, "ws": ws})
    await db.commit()

    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Invoice not found")

    return {"ok": True, "deleted": invoice_id}
