# Incident Response Plan

**GoFarther AI — Isibi Technologies**
**Version:** 1.0
**Effective Date:** April 8, 2026
**Last Reviewed:** April 8, 2026
**Next Review:** October 8, 2026
**Owner:** Security Lead

---

## 1. Purpose

This plan defines procedures for detecting, responding to, and recovering from security incidents affecting GoFarther AI systems, data, or users.

## 2. Scope

Covers all security events affecting:
- GoFarther AI backend infrastructure (Render)
- User data (accounts, chat messages, connected app credentials)
- Mobile application (iOS/Android)
- Third-party integrations (Anthropic, Twilio, Resend, etc.)

## 3. Incident Severity Levels

| Severity | Description | Examples | Response Time | Escalation |
|----------|------------|----------|---------------|------------|
| **P1 — Critical** | Active data breach, complete service outage, or active exploitation | Database compromise, encryption key leak, mass unauthorized access | Immediate (< 15 min) | Security Lead + CEO immediately |
| **P2 — High** | Significant security vulnerability, partial outage, or confirmed unauthorized access attempt | JWT secret exposure, single account compromise, API abuse at scale | < 1 hour | Security Lead within 1 hour |
| **P3 — Medium** | Potential vulnerability, anomalous activity, minor service degradation | Unusual login patterns, rate limit bypass, dependency vulnerability (CVSS 7+) | < 4 hours | Security Lead next business day |
| **P4 — Low** | Minor security concern, informational finding | Failed login spikes, low-severity CVE, policy clarification needed | < 24 hours | Logged for review |

## 4. Incident Response Phases

### Phase 1: Detection

**Automated Detection:**
- Login anomaly alerts (new IP address email notifications)
- Rate limiting triggers (429 responses logged)
- Application error monitoring (structured logging)
- Audit log analysis for suspicious patterns

**Manual Detection:**
- User reports via support channels
- Team member observations
- Third-party vulnerability disclosures
- Penetration testing findings

### Phase 2: Triage and Classification

1. **Confirm** the incident is genuine (not a false positive)
2. **Classify** severity level (P1-P4)
3. **Assign** an incident commander
4. **Create** an incident record with:
   - Incident ID (format: `INC-YYYY-MM-DD-NNN`)
   - Detection timestamp
   - Reporter
   - Initial classification
   - Affected systems

### Phase 3: Containment

**Immediate Containment (P1/P2):**

| Scenario | Action |
|----------|--------|
| Compromised user account | Revoke all sessions for user (`DELETE /sessions`) |
| Compromised API key | Rotate key in Render environment variables, redeploy |
| JWT secret compromise | Rotate `JWT_SECRET`, forcing all users to re-authenticate |
| Database breach | Rotate all encryption keys, force password resets |
| Malicious code execution | Disable `/run-code` endpoint via rate limiter (set to 0) |
| Bulk data exfiltration | Enable maintenance mode, block suspicious IPs |

**Short-term Containment:**
- Isolate affected systems/endpoints
- Preserve evidence (database snapshots, log exports)
- Enable enhanced logging if not already active

### Phase 4: Eradication

1. Identify root cause through log analysis
2. Remove malicious artifacts or compromised components
3. Patch vulnerability or configuration issue
4. Verify fix in staging/development environment
5. Deploy fix to production

### Phase 5: Recovery

1. Restore affected services to normal operation
2. Verify system integrity:
   - Database consistency checks
   - Encryption key validation
   - Session table cleanup
3. Monitor for recurrence (enhanced logging for 72 hours)
4. Re-enable any disabled features/endpoints

### Phase 6: Post-Incident Review

Conducted within 5 business days of incident resolution.

## 5. Communication

### Internal Communication
- P1/P2: Real-time updates via team communication channel
- P3/P4: Daily summary during active response

### External Communication (Users)

| Severity | Communication Required | Timeline |
|----------|----------------------|----------|
| P1 with data breach | Email to all affected users + in-app notification | Within 72 hours (GDPR requirement) |
| P2 with potential data exposure | Email to affected users | Within 5 business days |
| P3/P4 | No user communication unless data affected | N/A |

### Regulatory Notification
- GDPR: Supervisory authority notification within 72 hours of confirmed personal data breach
- State breach notification laws: As applicable based on user location

## 6. Post-Incident Review Template

```
## Post-Incident Review: INC-YYYY-MM-DD-NNN

### Summary
- **Incident:** [Brief description]
- **Severity:** P1/P2/P3/P4
- **Duration:** [Detection time] to [Resolution time]
- **Impact:** [Users affected, data exposed, service downtime]

### Timeline
| Time (UTC) | Event |
|------------|-------|
| HH:MM | [Event description] |

### Root Cause
[Detailed root cause analysis]

### What Went Well
- [Item 1]
- [Item 2]

### What Could Be Improved
- [Item 1]
- [Item 2]

### Action Items
| # | Action | Owner | Due Date | Status |
|---|--------|-------|----------|--------|
| 1 | [Action] | [Name] | [Date] | Open |

### Lessons Learned
[Key takeaways for preventing similar incidents]
```

## 7. Contact Information

| Role | Contact | Availability |
|------|---------|-------------|
| Security Lead | [To be filled] | 24/7 for P1 |
| CEO | [To be filled] | Escalation for P1/P2 |
| Render Support | support@render.com | Via dashboard |

## 8. Annual Testing

- Tabletop exercise: Annually (minimum)
- Simulated incident drill: Annually
- Plan review and update: Semi-annually
- Post-incident reviews feed into plan improvements

---

**Approval:**
- Security Lead: _______________________ Date: ___________
- CEO: _______________________ Date: ___________
