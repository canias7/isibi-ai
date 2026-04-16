# Change Management Policy

**GoFarther AI — Isibi Technologies**
**Version:** 1.0
**Effective Date:** April 8, 2026
**Last Reviewed:** April 8, 2026
**Next Review:** October 8, 2026
**Owner:** Security Lead

---

## 1. Purpose

This policy establishes the process for managing changes to GoFarther AI's production systems, ensuring changes are reviewed, tested, approved, and deployed in a controlled manner that minimizes risk and maintains service availability.

## 2. Scope

- Application code changes (backend and mobile)
- Infrastructure configuration changes (Render settings)
- Database schema changes (migrations)
- Third-party service configuration changes
- Environment variable additions or modifications

## 3. Change Categories

### 3.1 Standard Changes

Pre-approved, low-risk changes that follow established procedures.

| Change Type | Examples | Approval Required |
|------------|---------|------------------|
| Bug fixes | UI corrections, logic fixes | PR review by 1 team member |
| Dependency updates (patch) | Security patches, minor versions | PR review by 1 team member |
| Documentation updates | README, inline comments | PR review by 1 team member |
| Feature flags | Enabling/disabling existing features | PR review by 1 team member |

### 3.2 Normal Changes

Changes with moderate risk or impact requiring additional review.

| Change Type | Examples | Approval Required |
|------------|---------|------------------|
| New features | New API endpoints, UI screens | PR review by 1+ team members |
| Database migrations | Schema additions, index changes | PR review + migration tested |
| Dependency updates (major) | Major version upgrades | PR review + compatibility testing |
| API changes | Endpoint modifications, payload changes | PR review + backward compatibility check |

### 3.3 Emergency Changes

Critical changes required to restore service or address active security threats.

| Change Type | Examples | Approval Required |
|------------|---------|------------------|
| Security patches | Active vulnerability exploitation | Post-deployment review within 24 hours |
| Service restoration | Production outage fix | Post-deployment review within 24 hours |
| Key rotation | Compromised credentials | Immediate deployment, documented after |

## 4. Change Process

### 4.1 Development

1. **Branch:** Create feature branch from `main`
2. **Develop:** Implement changes following secure coding practices
3. **Test:** Run local tests and verify functionality
4. **No secrets:** Ensure no credentials, API keys, or sensitive data in code

### 4.2 Code Review (Pull Request)

Every change must go through a pull request:

| Check | Requirement |
|-------|------------|
| Code review | At least 1 reviewer approval |
| No secrets | Verify no credentials in diff |
| Input validation | All user inputs sanitized |
| Error handling | No stack traces exposed to users |
| Logging | Sensitive data not logged |
| Backward compatibility | API changes don't break existing clients |
| Audit logging | New endpoints include audit log calls |

### 4.3 Deployment

**Backend (Render Auto-Deploy):**
1. Merge PR to `main` branch
2. Render automatically builds and deploys
3. Monitor deployment logs for errors
4. Verify health check endpoint responds
5. Check application logs for startup errors

**Mobile App (Expo OTA Update):**
1. Run `npx expo export` for OTA-compatible changes
2. Publish via `eas update` with descriptive message
3. Verify update is available in Expo dashboard
4. For native changes: submit new build via `eas build` + app store review

### 4.4 Post-Deployment Verification

Within 30 minutes of deployment:

- [ ] Application starts without errors
- [ ] Health check endpoint returns 200
- [ ] Authentication flow works (login, signup)
- [ ] Critical API endpoints respond correctly
- [ ] No new error patterns in logs
- [ ] Database migrations applied successfully (if applicable)

## 5. Rollback Procedures

### 5.1 Backend Rollback

| Method | When to Use |
|--------|------------|
| Render rollback | Dashboard → Deploy → select previous deploy → "Rollback" |
| Git revert | `git revert <commit>` → push to main → auto-deploys |

### 5.2 Mobile Rollback

| Method | When to Use |
|--------|------------|
| OTA rollback | Publish previous JS bundle via `eas update` |
| App store rollback | Contact Apple/Google to remove update (last resort) |

### 5.3 Database Rollback

- Schema changes should be backward-compatible (additive only)
- Destructive migrations (column removal) delayed by 1 release cycle
- Data migrations include rollback scripts

## 6. Environment Variable Changes

Environment variable changes require:
1. Documentation of the change and reason
2. Update in Render dashboard
3. Manual redeploy triggered
4. Startup validation confirms new variables are set

## 7. Change Log

All changes are tracked via:
- **Git history:** Full commit log with messages
- **Pull request history:** Discussion, review comments, approval
- **Render deploy log:** Deployment timestamps and status
- **Audit log:** Application-level change events

## 8. Review Schedule

- This policy is reviewed semi-annually
- Post-incident reviews may trigger policy updates
- Process improvements documented and incorporated

---

**Approval:**
- Security Lead: _______________________ Date: ___________
- CEO: _______________________ Date: ___________
