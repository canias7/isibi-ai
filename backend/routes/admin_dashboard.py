"""
GoFarther AI Admin Dashboard — private, password-protected.
Served at /admin, API at /api/admin/*
"""

from __future__ import annotations
import os
import hashlib
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Request, HTTPException, Cookie, Response
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel
from typing import Optional

from db import async_session
from sqlalchemy import select, func, text

router = APIRouter(tags=["admin"])

ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "gofarther-admin-2026")
ADMIN_TOKEN = hashlib.sha256(ADMIN_PASSWORD.encode()).hexdigest()[:32]


def _check_admin(admin_token: Optional[str] = None):
    if admin_token != ADMIN_TOKEN:
        raise HTTPException(401, "Unauthorized")


# ─── API Endpoints ────────────────────────────────────────────────────────

@router.post("/api/admin/login")
async def admin_login(request: Request):
    body = await request.json()
    password = body.get("password", "")
    if password != ADMIN_PASSWORD:
        return JSONResponse({"error": "Wrong password"}, status_code=401)
    response = JSONResponse({"token": ADMIN_TOKEN})
    response.set_cookie("admin_token", ADMIN_TOKEN, httponly=True, max_age=86400 * 7, samesite="lax")
    return response


@router.get("/api/admin/stats")
async def admin_stats(admin_token: Optional[str] = Cookie(None)):
    _check_admin(admin_token)
    async with async_session() as db:
        total_users = (await db.execute(text("SELECT COUNT(*) FROM ghost_users"))).scalar() or 0
        today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0)
        active_today = (await db.execute(text(f"SELECT COUNT(DISTINCT user_email) FROM ghost_login_logs WHERE timestamp >= '{today.isoformat()}'"))).scalar() or 0
        total_credits = (await db.execute(text("SELECT COALESCE(SUM(credits), 0) FROM ghost_users"))).scalar() or 0
        free_users = (await db.execute(text("SELECT COUNT(*) FROM ghost_users WHERE plan = 'free'"))).scalar() or 0
        premium_users = total_users - free_users
        verified = (await db.execute(text("SELECT COUNT(*) FROM ghost_users WHERE email_verified = true"))).scalar() or 0

    return {
        "total_users": total_users,
        "active_today": active_today,
        "total_credits": total_credits,
        "free_users": free_users,
        "premium_users": premium_users,
        "verified_users": verified,
    }


@router.get("/api/admin/users")
async def admin_users(admin_token: Optional[str] = Cookie(None)):
    _check_admin(admin_token)
    async with async_session() as db:
        rows = (await db.execute(text(
            "SELECT id, email, name, credits, plan, created_at, is_active, email_verified FROM ghost_users ORDER BY created_at DESC LIMIT 500"
        ))).fetchall()

    users = []
    for r in rows:
        users.append({
            "id": str(r[0]),
            "email": r[1],
            "name": r[2],
            "credits": r[3],
            "plan": r[4],
            "created_at": r[5].isoformat() if r[5] else None,
            "is_active": r[6],
            "email_verified": r[7],
        })
    return {"users": users}


class CreditUpdate(BaseModel):
    amount: int  # positive to add, negative to remove

@router.post("/api/admin/users/{user_id}/credits")
async def admin_update_credits(user_id: str, req: CreditUpdate, admin_token: Optional[str] = Cookie(None)):
    _check_admin(admin_token)
    async with async_session() as db:
        await db.execute(text(f"UPDATE ghost_users SET credits = credits + {req.amount} WHERE id = '{user_id}'"))
        await db.commit()
        row = (await db.execute(text(f"SELECT credits FROM ghost_users WHERE id = '{user_id}'"))).fetchone()
    return {"credits": row[0] if row else 0}


class PlanUpdate(BaseModel):
    plan: str

@router.post("/api/admin/users/{user_id}/plan")
async def admin_update_plan(user_id: str, req: PlanUpdate, admin_token: Optional[str] = Cookie(None)):
    _check_admin(admin_token)
    async with async_session() as db:
        await db.execute(text(f"UPDATE ghost_users SET plan = '{req.plan}' WHERE id = '{user_id}'"))
        await db.commit()
    return {"plan": req.plan}


@router.get("/api/admin/users/{user_id}/logins")
async def admin_user_logins(user_id: str, admin_token: Optional[str] = Cookie(None)):
    _check_admin(admin_token)
    async with async_session() as db:
        # Get email first
        user = (await db.execute(text(f"SELECT email FROM ghost_users WHERE id = '{user_id}'"))).fetchone()
        if not user:
            raise HTTPException(404, "User not found")
        logs = (await db.execute(text(f"SELECT ip_address, success, timestamp FROM ghost_login_logs WHERE user_email = '{user[0]}' ORDER BY timestamp DESC LIMIT 20"))).fetchall()
    return {"logins": [{"ip": l[0], "success": l[1], "timestamp": l[2].isoformat() if l[2] else None} for l in logs]}


# ─── Dashboard HTML ───────────────────────────────────────────────────────

DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GoFarther AI — Admin</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #f5f5f7; }
.login-wrap { display: flex; justify-content: center; align-items: center; min-height: 100vh; }
.login-box { background: #1c1c1e; padding: 40px; border-radius: 16px; width: 360px; }
.login-box h1 { font-size: 24px; margin-bottom: 8px; }
.login-box p { color: #636366; margin-bottom: 24px; font-size: 14px; }
.login-box input { width: 100%; padding: 12px 16px; border: 1px solid #2c2c2e; background: #0a0a0a; color: #f5f5f7; border-radius: 10px; font-size: 15px; margin-bottom: 16px; outline: none; }
.login-box input:focus { border-color: #636366; }
.login-box button { width: 100%; padding: 12px; background: #f5f5f7; color: #0a0a0a; border: none; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer; }
.login-box button:hover { background: #e0e0e0; }
.login-error { color: #ff453a; font-size: 13px; margin-bottom: 12px; display: none; }

.dashboard { display: none; max-width: 1200px; margin: 0 auto; padding: 24px; }
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; }
.header h1 { font-size: 28px; font-weight: 700; }
.header .logout { color: #636366; cursor: pointer; font-size: 14px; }
.header .logout:hover { color: #f5f5f7; }

.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 32px; }
.stat-card { background: #1c1c1e; padding: 20px; border-radius: 12px; }
.stat-card .label { color: #636366; font-size: 13px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }
.stat-card .value { font-size: 32px; font-weight: 700; margin-top: 4px; }

.users-section h2 { font-size: 20px; margin-bottom: 16px; }
.users-table { width: 100%; border-collapse: collapse; }
.users-table th { text-align: left; padding: 10px 12px; color: #636366; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #2c2c2e; }
.users-table td { padding: 12px; border-bottom: 1px solid #1c1c1e; font-size: 14px; }
.users-table tr:hover { background: #1c1c1e; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 12px; font-weight: 600; }
.badge-free { background: #2c2c2e; color: #98989f; }
.badge-premium { background: #1a3a2a; color: #30d158; }
.btn-sm { padding: 4px 10px; border-radius: 6px; border: 1px solid #2c2c2e; background: transparent; color: #f5f5f7; font-size: 12px; cursor: pointer; margin-right: 4px; }
.btn-sm:hover { background: #2c2c2e; }

.modal-bg { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); z-index: 100; justify-content: center; align-items: center; }
.modal { background: #1c1c1e; padding: 24px; border-radius: 14px; width: 360px; }
.modal h3 { margin-bottom: 16px; }
.modal input, .modal select { width: 100%; padding: 10px 14px; border: 1px solid #2c2c2e; background: #0a0a0a; color: #f5f5f7; border-radius: 8px; font-size: 14px; margin-bottom: 12px; outline: none; }
.modal .btns { display: flex; gap: 8px; justify-content: flex-end; }
.modal .btns button { padding: 8px 16px; border-radius: 8px; border: none; font-size: 14px; font-weight: 600; cursor: pointer; }
.modal .btn-cancel { background: #2c2c2e; color: #f5f5f7; }
.modal .btn-save { background: #f5f5f7; color: #0a0a0a; }
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
    <span class="logout" onclick="doLogout()">Log out</span>
  </div>

  <div class="stats" id="statsGrid"></div>

  <div class="users-section">
    <h2>Users</h2>
    <table class="users-table">
      <thead>
        <tr><th>Name</th><th>Email</th><th>Plan</th><th>Credits</th><th>Joined</th><th>Verified</th><th>Actions</th></tr>
      </thead>
      <tbody id="usersBody"></tbody>
    </table>
  </div>
</div>

<!-- Credits Modal -->
<div class="modal-bg" id="creditsModal">
  <div class="modal">
    <h3>Update Credits</h3>
    <p style="color:#636366;font-size:13px;margin-bottom:12px" id="creditsUser"></p>
    <input type="number" id="creditsAmount" placeholder="Amount (positive to add, negative to remove)">
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

<script>
let currentUserId = null;

async function doLogin() {
  const pw = document.getElementById('passwordInput').value;
  const res = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
  if (res.ok) {
    document.getElementById('loginWrap').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
    loadStats();
    loadUsers();
  } else {
    document.getElementById('loginError').style.display = 'block';
  }
}

function doLogout() {
  document.cookie = 'admin_token=; Max-Age=0';
  document.getElementById('loginWrap').style.display = 'flex';
  document.getElementById('dashboard').style.display = 'none';
}

async function loadStats() {
  const res = await fetch('/api/admin/stats');
  if (!res.ok) return;
  const d = await res.json();
  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-card"><div class="label">Total Users</div><div class="value">${d.total_users}</div></div>
    <div class="stat-card"><div class="label">Active Today</div><div class="value">${d.active_today}</div></div>
    <div class="stat-card"><div class="label">Total Credits</div><div class="value">${d.total_credits.toLocaleString()}</div></div>
    <div class="stat-card"><div class="label">Free Users</div><div class="value">${d.free_users}</div></div>
    <div class="stat-card"><div class="label">Premium Users</div><div class="value">${d.premium_users}</div></div>
    <div class="stat-card"><div class="label">Verified</div><div class="value">${d.verified_users}</div></div>
  `;
}

async function loadUsers() {
  const res = await fetch('/api/admin/users');
  if (!res.ok) return;
  const d = await res.json();
  const tbody = document.getElementById('usersBody');
  tbody.innerHTML = d.users.map(u => `
    <tr>
      <td>${u.name}</td>
      <td>${u.email}</td>
      <td><span class="badge ${u.plan === 'free' ? 'badge-free' : 'badge-premium'}">${u.plan}</span></td>
      <td>${u.credits}</td>
      <td>${u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}</td>
      <td>${u.email_verified ? 'Yes' : 'No'}</td>
      <td>
        <button class="btn-sm" onclick="openCredits('${u.id}','${u.name}')">Credits</button>
        <button class="btn-sm" onclick="openPlan('${u.id}','${u.name}','${u.plan}')">Plan</button>
      </td>
    </tr>
  `).join('');
}

function openCredits(id, name) {
  currentUserId = id;
  document.getElementById('creditsUser').textContent = name;
  document.getElementById('creditsAmount').value = '';
  document.getElementById('creditsModal').style.display = 'flex';
}

function openPlan(id, name, plan) {
  currentUserId = id;
  document.getElementById('planUser').textContent = name;
  document.getElementById('planSelect').value = plan;
  document.getElementById('planModal').style.display = 'flex';
}

function closeModal(id) { document.getElementById(id).style.display = 'none'; }

async function saveCredits() {
  const amount = parseInt(document.getElementById('creditsAmount').value);
  if (isNaN(amount)) return;
  await fetch(`/api/admin/users/${currentUserId}/credits`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount }) });
  closeModal('creditsModal');
  loadUsers();
  loadStats();
}

async function savePlan() {
  const plan = document.getElementById('planSelect').value;
  await fetch(`/api/admin/users/${currentUserId}/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }) });
  closeModal('planModal');
  loadUsers();
  loadStats();
}

// Check if already logged in
fetch('/api/admin/stats').then(r => {
  if (r.ok) {
    document.getElementById('loginWrap').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
    loadStats();
    loadUsers();
  }
});
</script>
</body>
</html>"""


@router.get("/admin", response_class=HTMLResponse)
async def admin_page():
    return HTMLResponse(content=DASHBOARD_HTML)
