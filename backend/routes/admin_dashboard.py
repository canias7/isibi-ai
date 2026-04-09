"""
GoFarther AI Admin Dashboard — private, password-protected.
Full admin: users, analytics, revenue, system, communications.
Served at /admin, API at /api/admin/*
"""

from __future__ import annotations
import os
import csv
import io
import hashlib
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Request, HTTPException, Cookie, Response
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel
from typing import Optional

from db import async_session
from sqlalchemy import text

router = APIRouter(tags=["admin"])

import secrets as _secrets

ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
if os.getenv("RENDER") and not ADMIN_PASSWORD:
    raise RuntimeError("CRITICAL: ADMIN_PASSWORD must be set in production!")
if not ADMIN_PASSWORD:
    ADMIN_PASSWORD = _secrets.token_urlsafe(32)  # Random per-run in dev (no hardcoded fallback)
ADMIN_TOKEN = _secrets.token_urlsafe(32)  # Cryptographically random, not derived from password


def _check_admin(admin_token: Optional[str] = None):
    if admin_token != ADMIN_TOKEN:
        raise HTTPException(401, "Unauthorized")


# ─── Auth ─────────────────────────────────────────────────────────────────

@router.post("/api/admin/login")
async def admin_login(request: Request):
    body = await request.json()
    import hmac as _hmac
    if not _hmac.compare_digest(body.get("password", ""), ADMIN_PASSWORD):
        return JSONResponse({"error": "Wrong password"}, status_code=401)
    response = JSONResponse({"token": ADMIN_TOKEN})
    response.set_cookie("admin_token", ADMIN_TOKEN, httponly=True, max_age=86400 * 7, samesite="lax", secure=bool(os.getenv("RENDER")))
    return response


# ─── Stats ────────────────────────────────────────────────────────────────

@router.get("/api/admin/stats")
async def admin_stats(admin_token: Optional[str] = Cookie(None)):
    _check_admin(admin_token)
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0).isoformat()
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    month_ago = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()

    async with async_session() as db:
        total_users = (await db.execute(text("SELECT COUNT(*) FROM ghost_users"))).scalar() or 0
        active_today = (await db.execute(text("SELECT COUNT(DISTINCT user_email) FROM ghost_login_logs WHERE timestamp >= :today").bindparams(today=today))).scalar() or 0
        active_week = (await db.execute(text("SELECT COUNT(DISTINCT user_email) FROM ghost_login_logs WHERE timestamp >= :week_ago").bindparams(week_ago=week_ago))).scalar() or 0
        total_credits = (await db.execute(text("SELECT COALESCE(SUM(credits), 0) FROM ghost_users"))).scalar() or 0
        free_users = (await db.execute(text("SELECT COUNT(*) FROM ghost_users WHERE plan = 'free'"))).scalar() or 0
        premium_users = total_users - free_users
        verified = (await db.execute(text("SELECT COUNT(*) FROM ghost_users WHERE email_verified = true"))).scalar() or 0
        new_today = (await db.execute(text("SELECT COUNT(*) FROM ghost_users WHERE created_at >= :today").bindparams(today=today))).scalar() or 0
        new_week = (await db.execute(text("SELECT COUNT(*) FROM ghost_users WHERE created_at >= :week_ago").bindparams(week_ago=week_ago))).scalar() or 0
        new_month = (await db.execute(text("SELECT COUNT(*) FROM ghost_users WHERE created_at >= :month_ago").bindparams(month_ago=month_ago))).scalar() or 0
        total_logins = (await db.execute(text("SELECT COUNT(*) FROM ghost_login_logs WHERE success = true"))).scalar() or 0

    return {
        "total_users": total_users, "active_today": active_today, "active_week": active_week,
        "total_credits": total_credits, "free_users": free_users, "premium_users": premium_users,
        "verified_users": verified, "new_today": new_today, "new_week": new_week,
        "new_month": new_month, "total_logins": total_logins,
    }


# ─── Signups Over Time ───────────────────────────────────────────────────

@router.get("/api/admin/signups-chart")
async def admin_signups_chart(admin_token: Optional[str] = Cookie(None)):
    _check_admin(admin_token)
    async with async_session() as db:
        rows = (await db.execute(text(
            "SELECT DATE(created_at) as d, COUNT(*) as c FROM ghost_users WHERE created_at >= NOW() - INTERVAL '30 days' GROUP BY d ORDER BY d"
        ))).fetchall()
    return {"data": [{"date": str(r[0]), "count": r[1]} for r in rows]}


# ─── Most Active Users ───────────────────────────────────────────────────

@router.get("/api/admin/most-active")
async def admin_most_active(admin_token: Optional[str] = Cookie(None)):
    _check_admin(admin_token)
    async with async_session() as db:
        rows = (await db.execute(text(
            "SELECT user_email, COUNT(*) as cnt FROM ghost_login_logs WHERE success = true AND timestamp >= NOW() - INTERVAL '30 days' GROUP BY user_email ORDER BY cnt DESC LIMIT 10"
        ))).fetchall()
    return {"users": [{"email": r[0], "logins": r[1]} for r in rows]}


# ─── Users ────────────────────────────────────────────────────────────────

@router.get("/api/admin/users")
async def admin_users(admin_token: Optional[str] = Cookie(None), search: str = "", plan: str = ""):
    _check_admin(admin_token)
    query = "SELECT id, email, name, credits, plan, created_at, is_active, email_verified FROM ghost_users"
    conditions = []
    params = {}
    if search:
        conditions.append("(LOWER(email) LIKE :search OR LOWER(name) LIKE :search)")
        params["search"] = f"%{search.lower()}%"
    if plan:
        conditions.append("plan = :plan")
        params["plan"] = plan
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY created_at DESC LIMIT 500"

    async with async_session() as db:
        stmt = text(query)
        if params:
            stmt = stmt.bindparams(**params)
        rows = (await db.execute(stmt)).fetchall()
    return {"users": [{"id": str(r[0]), "email": r[1], "name": r[2], "credits": r[3], "plan": r[4], "created_at": r[5].isoformat() if r[5] else None, "is_active": r[6], "email_verified": r[7]} for r in rows]}


class CreditUpdate(BaseModel):
    amount: int

@router.post("/api/admin/users/{user_id}/credits")
async def admin_update_credits(user_id: str, req: CreditUpdate, admin_token: Optional[str] = Cookie(None)):
    _check_admin(admin_token)
    async with async_session() as db:
        await db.execute(text("UPDATE ghost_users SET credits = credits + :amount WHERE id = :user_id").bindparams(amount=req.amount, user_id=user_id))
        await db.commit()
        row = (await db.execute(text("SELECT credits FROM ghost_users WHERE id = :user_id").bindparams(user_id=user_id))).fetchone()
    return {"credits": row[0] if row else 0}


class PlanUpdate(BaseModel):
    plan: str

@router.post("/api/admin/users/{user_id}/plan")
async def admin_update_plan(user_id: str, req: PlanUpdate, admin_token: Optional[str] = Cookie(None)):
    _check_admin(admin_token)
    async with async_session() as db:
        await db.execute(text("UPDATE ghost_users SET plan = :plan WHERE id = :user_id").bindparams(plan=req.plan, user_id=user_id))
        await db.commit()
    return {"plan": req.plan}


@router.post("/api/admin/users/{user_id}/ban")
async def admin_ban_user(user_id: str, admin_token: Optional[str] = Cookie(None)):
    _check_admin(admin_token)
    async with async_session() as db:
        await db.execute(text("UPDATE ghost_users SET is_active = NOT is_active WHERE id = :user_id").bindparams(user_id=user_id))
        await db.commit()
        row = (await db.execute(text("SELECT is_active FROM ghost_users WHERE id = :user_id").bindparams(user_id=user_id))).fetchone()
    return {"is_active": row[0] if row else False}


@router.post("/api/admin/users/{user_id}/reset-password")
async def admin_reset_password(user_id: str, request: Request, admin_token: Optional[str] = Cookie(None)):
    _check_admin(admin_token)
    body = await request.json()
    new_password = body.get("password", "")
    if not new_password or len(new_password) < 12:
        raise HTTPException(400, "Password must be at least 12 characters")
    import bcrypt
    hashed = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt()).decode()
    async with async_session() as db:
        await db.execute(text("UPDATE ghost_users SET password_hash = :hashed WHERE id = :user_id").bindparams(hashed=hashed, user_id=user_id))
        await db.commit()
    return {"message": "Password reset successfully"}


@router.get("/api/admin/users/{user_id}/logins")
async def admin_user_logins(user_id: str, admin_token: Optional[str] = Cookie(None)):
    _check_admin(admin_token)
    async with async_session() as db:
        user = (await db.execute(text("SELECT email FROM ghost_users WHERE id = :user_id").bindparams(user_id=user_id))).fetchone()
        if not user:
            raise HTTPException(404, "User not found")
        logs = (await db.execute(text("SELECT ip_address, success, timestamp FROM ghost_login_logs WHERE user_email = :email ORDER BY timestamp DESC LIMIT 20").bindparams(email=user[0]))).fetchall()
    return {"logins": [{"ip": l[0], "success": l[1], "timestamp": l[2].isoformat() if l[2] else None} for l in logs]}


# ─── Export CSV ───────────────────────────────────────────────────────────

@router.get("/api/admin/export-users")
async def admin_export_csv(admin_token: Optional[str] = Cookie(None)):
    _check_admin(admin_token)
    async with async_session() as db:
        rows = (await db.execute(text("SELECT email, name, credits, plan, created_at, is_active, email_verified FROM ghost_users ORDER BY created_at DESC"))).fetchall()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Email", "Name", "Credits", "Plan", "Created", "Active", "Verified"])
    for r in rows:
        writer.writerow([r[0], r[1], r[2], r[3], str(r[4]) if r[4] else "", r[5], r[6]])
    output.seek(0)
    return StreamingResponse(output, media_type="text/csv", headers={"Content-Disposition": "attachment; filename=gofarther_users.csv"})


# ─── System Health ────────────────────────────────────────────────────────

@router.get("/api/admin/health")
async def admin_health(admin_token: Optional[str] = Cookie(None)):
    _check_admin(admin_token)
    import httpx
    checks = {}

    # Database
    try:
        async with async_session() as db:
            await db.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as e:
        checks["database"] = "error"

    # Backend API
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get("https://api.isibi.ai/health")
            checks["api"] = "ok" if r.status_code == 200 else "error"
    except Exception:
        checks["api"] = "error"

    # Service status — only show ok/missing, never reveal key values or names
    checks["ai_service"] = "ok" if os.getenv("ANTHROPIC_API_KEY") else "missing"
    checks["email_service"] = "ok" if os.getenv("RESEND_API_KEY") else "missing"

    return checks


# ─── Dashboard HTML ───────────────────────────────────────────────────────

DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GoFarther AI — Admin</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #f5f5f7; min-height: 100vh; }
a { color: #0a84ff; text-decoration: none; }

/* Login */
.login-wrap { display: flex; justify-content: center; align-items: center; min-height: 100vh; }
.login-box { background: #1c1c1e; padding: 40px; border-radius: 16px; width: 360px; }
.login-box h1 { font-size: 24px; margin-bottom: 8px; }
.login-box p { color: #636366; margin-bottom: 24px; font-size: 14px; }
.login-box input { width: 100%; padding: 12px 16px; border: 1px solid #2c2c2e; background: #0a0a0a; color: #f5f5f7; border-radius: 10px; font-size: 15px; margin-bottom: 16px; outline: none; }
.login-box input:focus { border-color: #636366; }
.login-box button { width: 100%; padding: 12px; background: #f5f5f7; color: #0a0a0a; border: none; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer; }
.login-box button:hover { background: #e0e0e0; }
.login-error { color: #ff453a; font-size: 13px; margin-bottom: 12px; display: none; }

/* Dashboard */
.dashboard { display: none; max-width: 1280px; margin: 0 auto; padding: 24px; }
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; }
.header h1 { font-size: 28px; font-weight: 700; }
.header-actions { display: flex; gap: 12px; align-items: center; }
.header .logout { color: #636366; cursor: pointer; font-size: 14px; }
.header .logout:hover { color: #f5f5f7; }

/* Tabs */
.tabs { display: flex; gap: 4px; margin-bottom: 24px; background: #1c1c1e; padding: 4px; border-radius: 10px; width: fit-content; }
.tab { padding: 8px 16px; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; color: #98989f; border: none; background: none; }
.tab.active { background: #2c2c2e; color: #f5f5f7; }

/* Stats */
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 28px; }
.stat-card { background: #1c1c1e; padding: 18px; border-radius: 12px; }
.stat-card .label { color: #636366; font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }
.stat-card .value { font-size: 28px; font-weight: 700; margin-top: 4px; }
.stat-card .sub { color: #636366; font-size: 12px; margin-top: 2px; }

/* Search */
.search-row { display: flex; gap: 10px; margin-bottom: 16px; }
.search-row input, .search-row select { padding: 10px 14px; border: 1px solid #2c2c2e; background: #1c1c1e; color: #f5f5f7; border-radius: 8px; font-size: 14px; outline: none; }
.search-row input { flex: 1; }
.search-row select { min-width: 120px; }
.btn { padding: 10px 16px; border-radius: 8px; border: none; font-size: 14px; font-weight: 600; cursor: pointer; }
.btn-primary { background: #0a84ff; color: #fff; }
.btn-outline { background: transparent; border: 1px solid #2c2c2e; color: #f5f5f7; }
.btn:hover { opacity: 0.9; }

/* Table */
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; padding: 10px 12px; color: #636366; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #2c2c2e; }
td { padding: 12px; border-bottom: 1px solid #1c1c1e; font-size: 14px; }
tr:hover { background: #1c1c1e; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 12px; font-weight: 600; }
.badge-free { background: #2c2c2e; color: #98989f; }
.badge-premium { background: #1a3a2a; color: #30d158; }
.badge-pro { background: #1a2a3a; color: #0a84ff; }
.badge-active { background: #1a3a2a; color: #30d158; }
.badge-banned { background: #3a1a1a; color: #ff453a; }
.btn-sm { padding: 4px 10px; border-radius: 6px; border: 1px solid #2c2c2e; background: transparent; color: #f5f5f7; font-size: 12px; cursor: pointer; margin-right: 4px; }
.btn-sm:hover { background: #2c2c2e; }
.btn-sm.danger { border-color: #ff453a; color: #ff453a; }

/* Chart */
.chart-wrap { background: #1c1c1e; padding: 20px; border-radius: 12px; margin-bottom: 24px; }
.chart-title { font-size: 16px; font-weight: 600; margin-bottom: 16px; }
.chart-bars { display: flex; align-items: flex-end; gap: 4px; height: 120px; }
.chart-bar { background: #0a84ff; border-radius: 4px 4px 0 0; min-width: 12px; flex: 1; position: relative; }
.chart-bar:hover { background: #3ba0ff; }
.chart-labels { display: flex; gap: 4px; margin-top: 6px; }
.chart-labels span { flex: 1; text-align: center; font-size: 10px; color: #636366; }

/* System */
.health-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
.health-item { background: #1c1c1e; padding: 16px; border-radius: 10px; display: flex; justify-content: space-between; align-items: center; }
.health-item .name { font-size: 14px; font-weight: 500; }
.health-item .status { font-size: 13px; font-weight: 600; }
.health-item .status.ok { color: #30d158; }
.health-item .status.error { color: #ff453a; }
.health-item .status.warn { color: #ff9f0a; }

/* Active users */
.active-list { list-style: none; }
.active-list li { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #1c1c1e; font-size: 14px; }
.active-list .count { color: #0a84ff; font-weight: 600; }

/* Section */
.section { display: none; }
.section.active { display: block; }

/* Modal */
.modal-bg { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); z-index: 100; justify-content: center; align-items: center; }
.modal { background: #1c1c1e; padding: 24px; border-radius: 14px; width: 380px; }
.modal h3 { margin-bottom: 16px; }
.modal input, .modal select { width: 100%; padding: 10px 14px; border: 1px solid #2c2c2e; background: #0a0a0a; color: #f5f5f7; border-radius: 8px; font-size: 14px; margin-bottom: 12px; outline: none; }
.modal .btns { display: flex; gap: 8px; justify-content: flex-end; }
.modal .btns button { padding: 8px 16px; border-radius: 8px; border: none; font-size: 14px; font-weight: 600; cursor: pointer; }
.btn-cancel { background: #2c2c2e; color: #f5f5f7; }
.btn-save { background: #f5f5f7; color: #0a0a0a; }
.btn-danger { background: #ff453a; color: #fff; }
</style>
</head>
<body>

<!-- Login -->
<div class="login-wrap" id="loginWrap">
  <div class="login-box">
    <h1>GoFarther Admin</h1>
    <p>Enter the admin password to continue.</p>
    <div class="login-error" id="loginError">Wrong password</div>
    <input type="password" id="passwordInput" placeholder="Password" onkeydown="if(event.key==='Enter')doLogin()">
    <button onclick="doLogin()">Sign in</button>
  </div>
</div>

<!-- Dashboard -->
<div class="dashboard" id="dashboard">
  <div class="header">
    <h1>GoFarther Admin</h1>
    <div class="header-actions">
      <button class="btn btn-outline" onclick="exportCSV()">Export CSV</button>
      <span class="logout" onclick="doLogout()">Log out</span>
    </div>
  </div>

  <!-- Tabs -->
  <div class="tabs">
    <button class="tab active" onclick="showTab('overview')">Overview</button>
    <button class="tab" onclick="showTab('users')">Users</button>
    <button class="tab" onclick="showTab('system')">System</button>
  </div>

  <!-- Overview Tab -->
  <div class="section active" id="tab-overview">
    <div class="stats" id="statsGrid"></div>
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;">
      <div class="chart-wrap">
        <div class="chart-title">New Signups (30 days)</div>
        <div class="chart-bars" id="signupChart"></div>
        <div class="chart-labels" id="signupLabels"></div>
      </div>
      <div class="chart-wrap">
        <div class="chart-title">Most Active Users</div>
        <ul class="active-list" id="activeList"></ul>
      </div>
    </div>
  </div>

  <!-- Users Tab -->
  <div class="section" id="tab-users">
    <div class="search-row">
      <input type="text" id="searchInput" placeholder="Search by name or email..." onkeydown="if(event.key==='Enter')searchUsers()">
      <select id="planFilter" onchange="searchUsers()">
        <option value="">All plans</option>
        <option value="free">Free</option>
        <option value="premium">Premium</option>
        <option value="pro">Pro</option>
      </select>
      <button class="btn btn-primary" onclick="searchUsers()">Search</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Plan</th><th>Credits</th><th>Joined</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody id="usersBody"></tbody>
      </table>
    </div>
  </div>

  <!-- System Tab -->
  <div class="section" id="tab-system">
    <h2 style="margin-bottom:16px">System Health</h2>
    <div class="health-grid" id="healthGrid"></div>
  </div>
</div>

<!-- Credits Modal -->
<div class="modal-bg" id="creditsModal">
  <div class="modal">
    <h3>Update Credits</h3>
    <p style="color:#636366;font-size:13px;margin-bottom:12px" id="creditsUser"></p>
    <input type="number" id="creditsAmount" placeholder="Amount (+100 to add, -50 to remove)">
    <div class="btns">
      <button class="btn-cancel" onclick="closeModal('creditsModal')">Cancel</button>
      <button class="btn-save" onclick="saveCredits()">Save</button>
    </div>
  </div>
</div>

<!-- Plan Modal -->
<div class="modal-bg" id="planModal">
  <div class="modal">
    <h3>Change Plan</h3>
    <p style="color:#636366;font-size:13px;margin-bottom:12px" id="planUser"></p>
    <select id="planSelect">
      <option value="free">Free</option>
      <option value="premium">Premium</option>
      <option value="pro">Pro</option>
    </select>
    <div class="btns">
      <button class="btn-cancel" onclick="closeModal('planModal')">Cancel</button>
      <button class="btn-save" onclick="savePlan()">Save</button>
    </div>
  </div>
</div>

<!-- Reset Password Modal -->
<div class="modal-bg" id="resetModal">
  <div class="modal">
    <h3>Reset Password</h3>
    <p style="color:#636366;font-size:13px;margin-bottom:12px" id="resetUser"></p>
    <input type="text" id="newPassword" placeholder="New password" value="TempPass123">
    <div class="btns">
      <button class="btn-cancel" onclick="closeModal('resetModal')">Cancel</button>
      <button class="btn-danger" onclick="doResetPassword()">Reset</button>
    </div>
  </div>
</div>

<!-- Login History Modal -->
<div class="modal-bg" id="loginsModal">
  <div class="modal" style="width:480px">
    <h3>Login History</h3>
    <div id="loginsContent" style="max-height:300px;overflow-y:auto"></div>
    <div class="btns" style="margin-top:16px">
      <button class="btn-cancel" onclick="closeModal('loginsModal')">Close</button>
    </div>
  </div>
</div>

<script>
let currentUserId = null;

// Auth
async function doLogin() {
  const pw = document.getElementById('passwordInput').value;
  const res = await fetch('/api/admin/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({password: pw}) });
  if (res.ok) { showDashboard(); } else { document.getElementById('loginError').style.display = 'block'; }
}
function doLogout() { document.cookie = 'admin_token=; Max-Age=0'; location.reload(); }
function showDashboard() {
  document.getElementById('loginWrap').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  loadStats(); loadSignupChart(); loadActiveUsers(); loadUsers();
}

// Tabs
function showTab(name) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  event.target.classList.add('active');
  if (name === 'system') loadHealth();
}

// Stats
async function loadStats() {
  const d = await (await fetch('/api/admin/stats')).json();
  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-card"><div class="label">Total Users</div><div class="value">${d.total_users}</div></div>
    <div class="stat-card"><div class="label">Active Today</div><div class="value">${d.active_today}</div></div>
    <div class="stat-card"><div class="label">Active This Week</div><div class="value">${d.active_week}</div></div>
    <div class="stat-card"><div class="label">New Today</div><div class="value">${d.new_today}</div></div>
    <div class="stat-card"><div class="label">New This Week</div><div class="value">${d.new_week}</div></div>
    <div class="stat-card"><div class="label">New This Month</div><div class="value">${d.new_month}</div></div>
    <div class="stat-card"><div class="label">Total Credits</div><div class="value">${d.total_credits.toLocaleString()}</div></div>
    <div class="stat-card"><div class="label">Free / Premium</div><div class="value">${d.free_users} / ${d.premium_users}</div></div>
    <div class="stat-card"><div class="label">Verified</div><div class="value">${d.verified_users}</div></div>
    <div class="stat-card"><div class="label">Total Logins</div><div class="value">${d.total_logins.toLocaleString()}</div></div>
  `;
}

// Signup Chart
async function loadSignupChart() {
  const d = await (await fetch('/api/admin/signups-chart')).json();
  const max = Math.max(...d.data.map(x => x.count), 1);
  document.getElementById('signupChart').innerHTML = d.data.map(x =>
    '<div class="chart-bar" style="height:' + (x.count / max * 100) + '%" title="' + x.date + ': ' + x.count + '"></div>'
  ).join('');
  document.getElementById('signupLabels').innerHTML = d.data.filter((_, i) => i % 5 === 0).map(x =>
    '<span>' + x.date.slice(5) + '</span>'
  ).join('');
}

// Active Users
async function loadActiveUsers() {
  const d = await (await fetch('/api/admin/most-active')).json();
  document.getElementById('activeList').innerHTML = d.users.map(u =>
    '<li><span>' + u.email + '</span><span class="count">' + u.logins + ' logins</span></li>'
  ).join('');
}

// Users
async function loadUsers() { searchUsers(); }
async function searchUsers() {
  const search = document.getElementById('searchInput').value;
  const plan = document.getElementById('planFilter').value;
  const d = await (await fetch('/api/admin/users?search=' + encodeURIComponent(search) + '&plan=' + plan)).json();
  document.getElementById('usersBody').innerHTML = d.users.map(u => `
    <tr>
      <td>${u.name}</td>
      <td>${u.email}</td>
      <td><span class="badge badge-${u.plan}">${u.plan}</span></td>
      <td>${u.credits}</td>
      <td>${u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}</td>
      <td><span class="badge ${u.is_active ? 'badge-active' : 'badge-banned'}">${u.is_active ? 'Active' : 'Banned'}</span></td>
      <td>
        <button class="btn-sm" onclick="openCredits('${u.id}','${u.name}')">Credits</button>
        <button class="btn-sm" onclick="openPlan('${u.id}','${u.name}','${u.plan}')">Plan</button>
        <button class="btn-sm" onclick="openReset('${u.id}','${u.name}')">Reset PW</button>
        <button class="btn-sm" onclick="viewLogins('${u.id}')">Logins</button>
        <button class="btn-sm danger" onclick="toggleBan('${u.id}')">${u.is_active ? 'Ban' : 'Unban'}</button>
      </td>
    </tr>
  `).join('');
}

// Modals
function openCredits(id, name) { currentUserId = id; document.getElementById('creditsUser').textContent = name; document.getElementById('creditsAmount').value = ''; document.getElementById('creditsModal').style.display = 'flex'; }
function openPlan(id, name, plan) { currentUserId = id; document.getElementById('planUser').textContent = name; document.getElementById('planSelect').value = plan; document.getElementById('planModal').style.display = 'flex'; }
function openReset(id, name) { currentUserId = id; document.getElementById('resetUser').textContent = name; document.getElementById('newPassword').value = 'TempPass123'; document.getElementById('resetModal').style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

async function saveCredits() {
  await fetch('/api/admin/users/' + currentUserId + '/credits', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({amount: parseInt(document.getElementById('creditsAmount').value) || 0}) });
  closeModal('creditsModal'); searchUsers(); loadStats();
}
async function savePlan() {
  await fetch('/api/admin/users/' + currentUserId + '/plan', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({plan: document.getElementById('planSelect').value}) });
  closeModal('planModal'); searchUsers(); loadStats();
}
async function doResetPassword() {
  const r = await (await fetch('/api/admin/users/' + currentUserId + '/reset-password', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({password: document.getElementById('newPassword').value}) })).json();
  closeModal('resetModal'); alert('Password reset to: ' + r.new_password);
}
async function toggleBan(id) {
  if (!confirm('Toggle ban for this user?')) return;
  await fetch('/api/admin/users/' + id + '/ban', { method: 'POST' });
  searchUsers();
}
async function viewLogins(id) {
  const d = await (await fetch('/api/admin/users/' + id + '/logins')).json();
  document.getElementById('loginsContent').innerHTML = d.logins.length ? d.logins.map(l =>
    '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #2c2c2e;font-size:13px"><span>' + (l.ip || 'Unknown IP') + '</span><span style="color:' + (l.success ? '#30d158' : '#ff453a') + '">' + (l.success ? 'Success' : 'Failed') + '</span><span style="color:#636366">' + new Date(l.timestamp).toLocaleString() + '</span></div>'
  ).join('') : '<p style="color:#636366">No login history</p>';
  document.getElementById('loginsModal').style.display = 'flex';
}

// Export
function exportCSV() { window.open('/api/admin/export-users', '_blank'); }

// Health
async function loadHealth() {
  const d = await (await fetch('/api/admin/health')).json();
  document.getElementById('healthGrid').innerHTML = Object.entries(d).map(([k, v]) => {
    const cls = v === 'ok' || v === 'configured' ? 'ok' : v.startsWith('error') || v === 'missing' ? 'error' : 'warn';
    return '<div class="health-item"><span class="name">' + k.replace(/_/g, ' ') + '</span><span class="status ' + cls + '">' + v + '</span></div>';
  }).join('');
}

// Auto-login check
fetch('/api/admin/stats').then(r => { if (r.ok) showDashboard(); });
</script>
</body>
</html>"""


@router.get("/admin", response_class=HTMLResponse)
async def admin_page():
    return HTMLResponse(content=DASHBOARD_HTML)
