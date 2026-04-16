# Business Continuity & Disaster Recovery Plan

**GoFarther AI — Isibi Technologies**
**Version:** 1.0
**Effective Date:** April 8, 2026
**Last Reviewed:** April 8, 2026
**Next Review:** October 8, 2026
**Owner:** Security Lead

---

## 1. Purpose

This plan defines GoFarther AI's strategy for maintaining business operations and recovering from disruptions, ensuring continuity of service for users and protection of data assets.

## 2. Objectives

| Objective | Target |
|-----------|--------|
| **Recovery Point Objective (RPO)** | 24 hours — maximum acceptable data loss |
| **Recovery Time Objective (RTO)** | 4 hours — maximum acceptable downtime |
| **Service Level Target** | 99.5% monthly uptime |

## 3. Architecture Overview

```
Users (Mobile App)
    ↓ HTTPS
Render (Application Host)
    ├── FastAPI Backend (Web Service)
    ├── PostgreSQL Database (Managed)
    └── Background Worker (Scheduler)
    ↓ API Calls
Third-Party Services
    ├── Anthropic (AI)
    ├── Twilio (SMS/Voice)
    ├── Resend (Email)
    └── Expo (OTA Updates)
```

## 4. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Render region outage | Low | Critical | Render multi-region failover (managed) |
| Database corruption | Very Low | Critical | Render automated daily backups |
| Application bug causing outage | Medium | High | Rollback via Render deploy history |
| Third-party API outage (Anthropic) | Medium | High | Graceful error handling, user notification |
| Third-party API outage (Twilio) | Low | Medium | Tool-specific errors, core chat unaffected |
| DDoS attack | Low | High | Render's built-in DDoS protection + rate limiting |
| Encryption key compromise | Very Low | Critical | Key rotation procedure, defense-in-depth encryption |
| Developer account compromise | Low | High | MFA on all accounts, access reviews |

## 5. Backup Strategy

### 5.1 Database Backups

| Type | Frequency | Retention | Provider |
|------|-----------|-----------|----------|
| Automated daily backup | Every 24 hours | 7 days | Render (managed PostgreSQL) |
| Continuous WAL archiving | Continuous | Per Render plan | Render |

### 5.2 Application Code

| Type | Location | Recovery |
|------|----------|----------|
| Source code | GitHub repository | Clone and redeploy |
| Deployment history | Render dashboard | One-click rollback |
| Environment variables | Render dashboard | Manual reconfiguration |
| Encryption keys | Documented in secure location (offline) | Manual restore |

### 5.3 User Data

- Chat messages are encrypted at rest (AES-256)
- Users can export their data at any time via `GET /export`
- Data export includes: account info, chat history, audit logs, usage data

## 6. Disaster Recovery Scenarios

### Scenario 1: Application Crash / Deployment Failure

| Step | Action | Owner | Time |
|------|--------|-------|------|
| 1 | Detect via health check failure or error monitoring | Automated | < 5 min |
| 2 | Rollback to last known good deploy via Render dashboard | Engineering | < 15 min |
| 3 | Investigate root cause from deploy logs | Engineering | < 1 hour |
| 4 | Fix and redeploy with proper testing | Engineering | < 4 hours |

**Recovery Time: < 30 minutes (rollback)**

### Scenario 2: Database Failure

| Step | Action | Owner | Time |
|------|--------|-------|------|
| 1 | Detect via application errors (database connection failures) | Automated | < 5 min |
| 2 | Check Render status page for managed database issues | Engineering | < 10 min |
| 3a | If Render issue: wait for Render resolution | Render Support | Varies |
| 3b | If data corruption: restore from latest backup via Render | Engineering | < 2 hours |
| 4 | Verify data integrity and application functionality | Engineering | < 1 hour |
| 5 | Run database migration if needed | Engineering | < 30 min |

**Recovery Time: 2-4 hours (depending on scenario)**

### Scenario 3: Encryption Key Compromise

| Step | Action | Owner | Time |
|------|--------|-------|------|
| 1 | Revoke compromised key immediately | Security Lead | < 15 min |
| 2 | Generate new encryption key | Security Lead | < 5 min |
| 3 | Update Render environment variable | Engineering | < 10 min |
| 4 | Trigger redeployment | Engineering | < 15 min |
| 5 | Re-encrypt affected data with new key (if feasible) | Engineering | < 4 hours |
| 6 | Rotate JWT_SECRET to force re-authentication | Engineering | < 10 min |
| 7 | Notify affected users per Incident Response Plan | Security Lead | < 72 hours |

**Recovery Time: < 1 hour (service restoration); hours-days (full remediation)**

### Scenario 4: Third-Party Service Outage

| Service | Impact | Mitigation |
|---------|--------|------------|
| Anthropic API down | Chat responses unavailable | Display user-friendly error message; core app remains functional |
| Twilio down | SMS/WhatsApp/Call tools fail | Individual tool errors; chat and other tools unaffected |
| Resend down | Email alerts not sent | Queue emails for retry; login/signup still functional |
| Expo down | OTA updates unavailable | App continues working with current version |

**Recovery: Wait for provider restoration; no data loss**

### Scenario 5: Complete Infrastructure Loss

| Step | Action | Owner | Time |
|------|--------|-------|------|
| 1 | Provision new Render services | Engineering | < 1 hour |
| 2 | Restore environment variables from secure backup | Security Lead | < 30 min |
| 3 | Deploy application from GitHub | Engineering | < 30 min |
| 4 | Restore database from latest backup | Engineering | < 2 hours |
| 5 | Verify application functionality | Engineering | < 1 hour |
| 6 | Update DNS if needed | Engineering | < 1 hour |

**Recovery Time: < 4 hours**

## 7. Communication During Outage

| Audience | Channel | Timing |
|----------|---------|--------|
| Engineering team | Team chat | Immediately on detection |
| Users (extended outage > 1 hour) | In-app banner or push notification | After 1 hour |
| Users (data impact) | Email notification | Within 72 hours |

## 8. Testing

### 8.1 Annual DR Test

| Test | Description | Frequency |
|------|------------|-----------|
| Backup restoration | Restore database backup to verify integrity | Annually |
| Rollback test | Practice deployment rollback | Quarterly |
| Failover test | Verify application restarts after crash | Quarterly |
| Tabletop exercise | Walk through disaster scenarios | Annually |

### 8.2 Test Documentation

Each DR test must document:
- Date and participants
- Scenario tested
- Steps performed
- Actual recovery time
- Issues encountered
- Improvements identified

## 9. Maintenance

- Plan reviewed semi-annually
- Updated after any disaster event or DR test
- Contact information verified quarterly
- Backup restoration verified annually

---

**Approval:**
- Security Lead: _______________________ Date: ___________
- CEO: _______________________ Date: ___________
