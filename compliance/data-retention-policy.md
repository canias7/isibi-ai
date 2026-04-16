# Data Retention Policy

**GoFarther AI — Isibi Technologies**
**Version:** 1.0
**Effective Date:** April 8, 2026
**Last Reviewed:** April 8, 2026
**Next Review:** October 8, 2026
**Owner:** Security Lead

---

## 1. Purpose

This policy defines data retention periods and destruction procedures for all data categories in GoFarther AI, ensuring compliance with SOC 2 criteria and GDPR requirements.

## 2. Scope

All data stored, processed, or transmitted by GoFarther AI systems, including:
- User account data
- Chat messages and session history
- Audit and security logs
- Usage metrics
- Connected app credentials
- Temporary files

## 3. Retention Schedule

| Data Category | Retention Period | Storage Location | Destruction Method | Justification |
|--------------|-----------------|-----------------|-------------------|---------------|
| **Audit Logs** | 365 days | PostgreSQL (`ghost_audit_log`) | Automated deletion via scheduler | SOC 2 requires 1-year audit trail |
| **Usage Logs** | 90 days | PostgreSQL (`ghost_usage`) | Automated deletion via scheduler | Sufficient for billing disputes and trend analysis |
| **Chat Sessions & Messages** | Until user deletion | PostgreSQL (encrypted) | User-initiated or account deletion | User data ownership; GDPR right to erasure |
| **User Accounts** | Until user deletion | PostgreSQL | `DELETE /account` endpoint | GDPR right to erasure |
| **Revoked Sessions** | 30 days post-revocation | PostgreSQL (`ghost_sessions`) | Automated deletion via scheduler | Needed for security audit trail |
| **Trusted Devices** | 90 days of inactivity | PostgreSQL (`ghost_trusted_devices`) | Automated deletion via scheduler | Inactive devices are no longer relevant |
| **Login Logs** | 90 days | PostgreSQL (`ghost_login_logs`) | Automated deletion via scheduler | Sufficient for anomaly detection lookback |
| **Temporary Files** | 24 hours | In-memory (`FILE_STORE`) | Application-level TTL cleanup | Temporary by design |
| **Connected App Credentials** | Until disconnection | PostgreSQL (encrypted) | User-initiated disconnection | Required while integration is active |
| **JWT Tokens** | Per token expiry | Stateless (client-side) | Natural expiration + server-side JTI revocation | Standard token lifecycle |
| **Password Reset Codes** | 15 minutes | PostgreSQL | Consumed on use or expired | Short-lived by design |

## 4. Automated Enforcement

Data retention is enforced by an automated scheduler (`backend/worker/scheduler.py`) that runs daily:

```
Cleanup Schedule:
- Audit logs older than 365 days → DELETE
- Usage logs older than 90 days → DELETE
- Revoked sessions older than 30 days → DELETE
- Trusted devices inactive > 90 days → DELETE
- Login logs older than 90 days → DELETE
```

The scheduler logs each cleanup operation for verification.

## 5. User-Initiated Data Deletion

### 5.1 Individual Data
- Users can delete individual chat sessions via the app
- Users can disconnect integrated apps (credentials are destroyed)
- Users can revoke active sessions

### 5.2 Account Deletion
- `DELETE /account` endpoint removes:
  - User account record
  - All chat sessions and messages
  - All connected app credentials
  - All active sessions
- Audit logs referencing the user are retained for the full 365-day period (anonymized by email reference only)

### 5.3 Data Export Before Deletion
- Users can export all their data via `GET /export` before account deletion
- Export includes: account info, chat history (decrypted), audit logs, usage data, connected app IDs

## 6. Legal Holds

In the event of litigation, regulatory investigation, or legal obligation:
1. Security Lead will issue a **litigation hold notice**
2. Automated deletion for affected data categories is suspended
3. Hold is documented with:
   - Reason for hold
   - Data categories affected
   - Date imposed
   - Expected duration
4. Normal retention resumes when hold is lifted

## 7. Destruction Methods

| Method | Used For | Verification |
|--------|---------|-------------|
| **Database DELETE** | All PostgreSQL records | Scheduler logs confirm row counts |
| **In-memory eviction** | Temporary files | TTL-based automatic cleanup |
| **Key destruction** | Encryption keys (on rotation) | Environment variable replacement on Render |
| **Secure overwrite** | N/A (cloud-managed storage) | Render's infrastructure handles disk sanitization |

## 8. Exceptions

- Data subject to an active legal hold
- Data required by law enforcement with valid legal process
- Anonymized/aggregated data used for analytics (no retention limit)

## 9. Review and Updates

- Policy reviewed semi-annually
- Retention periods adjusted based on:
  - Regulatory changes
  - Business requirements
  - Storage cost considerations
  - Security incident findings

---

**Approval:**
- Security Lead: _______________________ Date: ___________
- CEO: _______________________ Date: ___________
