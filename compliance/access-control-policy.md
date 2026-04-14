# Access Control Policy

**GoFarther AI — Isibi Technologies**
**Version:** 1.0
**Effective Date:** April 8, 2026
**Last Reviewed:** April 8, 2026
**Next Review:** October 8, 2026
**Owner:** Security Lead

---

## 1. Purpose

This policy defines access control requirements for GoFarther AI systems, ensuring that access to information and systems is granted on a least-privilege basis and properly managed throughout the user/employee lifecycle.

## 2. Scope

- User authentication and authorization in the GoFarther AI application
- Infrastructure access (Render dashboard, databases, third-party services)
- API key and secret management
- Employee/contractor system access

## 3. User Authentication Requirements

### 3.1 Password Policy

| Requirement | Standard |
|------------|----------|
| Minimum length | 8 characters |
| Complexity | Must contain: uppercase letter, lowercase letter, digit, special character |
| Password storage | bcrypt hash (never plaintext) |
| Password reset | Email-based with time-limited code (15 minutes) |
| Failed login handling | Rate limited (5 attempts/minute per IP) |

### 3.2 Multi-Factor Authentication (MFA)

- **Method:** TOTP (Time-based One-Time Password) per RFC 6238
- **Availability:** Optional for all users, configurable in Settings
- **Implementation:** 30-second code window, 6-digit codes
- **Recovery:** Users can disable 2FA with a valid TOTP code
- **Recommendation:** Strongly encouraged for all users; required for team admin accounts

### 3.3 Social Login

- Supported providers: Apple Sign-In, Google Sign-In
- OAuth 2.0 standard flows
- Server-side secure random password generated (meets all password requirements)
- Social login users can set up 2FA like any other user

## 4. Session Management

### 4.1 Session Controls

| Control | Implementation |
|---------|---------------|
| Token type | JWT with unique JTI (JSON Token Identifier) |
| Session tracking | Server-side session records (`ghost_sessions` table) |
| Session visibility | Users can view all active sessions with device/IP info |
| Session revocation | Individual or bulk session revocation via API |
| Inactivity timeout | 30-minute auto-logout (mobile app, SOC 2 requirement) |
| Background detection | App monitors foreground/background state transitions |

### 4.2 Session Lifecycle

1. **Creation:** On successful login (after 2FA if enabled)
2. **Tracking:** Device name and IP address recorded
3. **Validation:** JTI checked against session table on each `/me` request
4. **Timeout:** 30 minutes of inactivity triggers automatic logout
5. **Revocation:** User-initiated or admin-forced session termination
6. **Cleanup:** Revoked sessions purged after 30 days

## 5. Authorization Model

### 5.1 Application-Level Authorization

| Resource | Access Rule |
|----------|------------|
| Chat sessions | Owner only (by user ID) |
| Chat messages | Owner only (via session ownership) |
| File downloads | Owner only (`owner_email` verification) |
| Connected apps | Owner only (by user ID) |
| Account settings | Owner only (authenticated user) |
| Active sessions | Owner only (authenticated user) |
| Data export | Owner only (authenticated user) |
| Audit logs | Owner only (via data export) |

### 5.2 API Authorization

- All API endpoints require `Authorization: Bearer <JWT>` header
- Token verification extracts user identity (email, user ID)
- Expired or revoked tokens return HTTP 401
- Invalid tokens return HTTP 401
- Missing authorization returns HTTP 401

## 6. Infrastructure Access

### 6.1 Render Dashboard

| Control | Requirement |
|---------|------------|
| Access | Limited to authorized team members |
| Authentication | Render account with MFA enabled |
| Access review | Quarterly review of dashboard access |

### 6.2 Database Access

| Control | Requirement |
|---------|------------|
| Direct access | Production database not directly accessible |
| Connection | Via Render internal network only |
| Credentials | `DATABASE_URL` stored as environment variable |
| Query access | Through application ORM (SQLAlchemy) only |

### 6.3 Third-Party Service Access

| Service | Access Control |
|---------|---------------|
| Anthropic API | API key in environment variable |
| Twilio | Account SID + Auth Token in environment variables |
| Resend/SendGrid | API key in environment variable |
| Expo | Team account with role-based access |

## 7. Key and Secret Management

### 7.1 Secrets Inventory

| Secret | Storage | Rotation Schedule |
|--------|---------|------------------|
| `JWT_SECRET` | Render env var | On security incident |
| `SMTP_ENCRYPTION_KEY` | Render env var | Annually or on incident |
| `CONNECTOR_ENCRYPTION_KEY` | Render env var | Annually or on incident |
| `CHAT_ENCRYPTION_KEY` | Render env var | Annually or on incident |
| `ANTHROPIC_API_KEY` | Render env var | Annually |
| `TWILIO_ACCOUNT_SID` | Render env var | On compromise |
| `TWILIO_AUTH_TOKEN` | Render env var | On compromise |

### 7.2 Key Management Rules

- Never commit secrets to source control
- Application validates critical secrets on startup (crashes if missing in production)
- Secrets are never logged or included in error messages
- Key rotation requires coordinated deployment

## 8. Employee Lifecycle

### 8.1 Onboarding
1. Grant access based on role requirements (least privilege)
2. Enable MFA on all infrastructure accounts
3. Complete security training (see Employee Security Training Log)
4. Document access grants

### 8.2 Role Changes
1. Review and adjust access based on new role
2. Revoke access no longer required
3. Document changes

### 8.3 Offboarding
1. Revoke all infrastructure access within 24 hours
2. Rotate any shared secrets the departing person had access to
3. Review and remove from all third-party service accounts
4. Document access revocations

## 9. Access Reviews

| Review Type | Frequency | Scope |
|------------|-----------|-------|
| User access | Quarterly | Active user accounts and permissions |
| Infrastructure access | Quarterly | Render dashboard, third-party services |
| API key inventory | Semi-annually | All API keys and service credentials |
| Privileged access | Monthly | Admin-level access to any system |

---

**Approval:**
- Security Lead: _______________________ Date: ___________
- CEO: _______________________ Date: ___________
