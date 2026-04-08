# Information Security Policy

**GoFarther AI — Isibi Technologies**
**Version:** 1.0
**Effective Date:** April 8, 2026
**Last Reviewed:** April 8, 2026
**Next Review:** October 8, 2026
**Owner:** Security Lead

---

## 1. Purpose

This policy establishes the framework for protecting GoFarther AI's information assets, ensuring confidentiality, integrity, and availability of all systems and data in accordance with SOC 2 Trust Service Criteria.

## 2. Scope

This policy applies to:
- All employees, contractors, and third-party service providers
- All information systems, applications, and infrastructure
- All data processed, stored, or transmitted by GoFarther AI
- The GoFarther AI mobile application and backend services

## 3. Roles and Responsibilities

| Role | Responsibility |
|------|---------------|
| **Security Lead** | Policy ownership, risk assessments, incident response coordination |
| **Engineering Team** | Secure development practices, vulnerability remediation, code reviews |
| **All Personnel** | Compliance with this policy, reporting security incidents |

## 4. Data Classification

### 4.1 Classification Levels

| Level | Description | Examples | Controls |
|-------|------------|----------|----------|
| **Confidential** | Highly sensitive data; unauthorized disclosure causes significant harm | User passwords, API keys, encryption keys, JWT secrets, TOTP secrets, SMTP credentials | AES-256 encryption at rest, TLS 1.2+ in transit, access restricted to essential services only |
| **Internal** | Business data not intended for public release | User email addresses, chat messages, audit logs, usage metrics, connected app credentials | Encrypted at rest (AES-256 for chat/connectors), access controlled via JWT authentication |
| **Public** | Information approved for public access | Marketing content, public API documentation | No special controls required |

### 4.2 Data Handling Requirements

- **Confidential** data must never appear in logs, error messages, or stack traces
- **Internal** data must be encrypted at rest and in transit
- All user-generated content (chat messages) is encrypted with AES-256 using per-deployment keys
- Connected app credentials are encrypted with a separate encryption key (`CONNECTOR_ENCRYPTION_KEY`)

## 5. Encryption Standards

### 5.1 Data at Rest
- **Database:** PostgreSQL on Render with managed encryption
- **Chat messages:** AES-256-CBC encryption via `CHAT_ENCRYPTION_KEY`
- **Connected app credentials:** AES-256-CBC encryption via `CONNECTOR_ENCRYPTION_KEY`
- **SMTP credentials:** AES-256-CBC encryption via `SMTP_ENCRYPTION_KEY`
- **Mobile client secrets:** iOS Keychain / Android Keystore via `expo-secure-store`

### 5.2 Data in Transit
- All API communication over HTTPS (TLS 1.2+)
- HSTS headers enforced
- Certificate management via Render's automatic TLS

### 5.3 Key Management
- Encryption keys stored as environment variables on Render (not in source code)
- JWT signing key (`JWT_SECRET`) rotated on security incidents
- Application validates presence of all critical encryption keys on startup

## 6. Access Control

### 6.1 Authentication
- Email/password authentication with password strength requirements:
  - Minimum 8 characters
  - Must contain uppercase, lowercase, digit, and special character
- Optional TOTP-based two-factor authentication (RFC 6238)
- Social login via Apple and Google (OAuth)
- JWT tokens with unique JTI claims for session tracking

### 6.2 Session Management
- JWT tokens expire after configured duration
- Sessions tracked with device name and IP address
- Users can view and revoke active sessions
- Automatic session timeout after 30 minutes of inactivity (SOC 2)
- Revoked session tokens are immediately invalidated

### 6.3 Authorization
- File downloads restricted to file owner (`owner_email` check)
- API endpoints protected by JWT bearer token verification
- Admin operations require authenticated user context

## 7. Network Security

- Application hosted on Render's managed infrastructure
- DDoS protection via Render's built-in mitigation
- Rate limiting enforced per endpoint category:
  - Authentication: 5 requests/minute
  - SMS/WhatsApp: 10 requests/minute
  - Bulk operations: 3 requests/minute
  - Email: 15 requests/minute
  - Code execution: 10 requests/minute
  - General tools: 20 requests/minute

## 8. Logging and Monitoring

### 8.1 Audit Logging
- All authentication events logged (login, signup, logout, 2FA setup/verify)
- All tool endpoint invocations logged with user email, action, and timestamp
- Session creation, revocation, and timeout events logged
- Login anomaly detection (new IP address alerts)
- Audit logs retained for 365 days

### 8.2 Log Protection
- No user content logged at error level
- Stack traces suppressed in production (structured logging only)
- Logs stored in database with application-level access controls

## 9. Vulnerability Management

- Dependencies monitored for known vulnerabilities
- Security patches applied within:
  - **Critical:** 24 hours
  - **High:** 7 days
  - **Medium:** 30 days
  - **Low:** Next release cycle

## 10. Secure Development

- All code changes require pull request review
- No secrets committed to source control
- Environment variables validated on application startup
- Input sanitization and injection prevention on all user inputs
- SQL injection prevention via SQLAlchemy ORM (parameterized queries)
- XSS prevention via React Native's built-in escaping

## 11. Physical Security

GoFarther AI operates as a cloud-native application:
- Infrastructure hosted on Render (SOC 2 Type II certified)
- No on-premises servers or data centers
- Employee devices must use full-disk encryption and screen lock

## 12. Policy Review

- This policy is reviewed semi-annually (every 6 months)
- Reviews triggered by:
  - Scheduled review date
  - Significant security incidents
  - Major infrastructure changes
  - Regulatory or compliance requirement changes

## 13. Policy Violations

Violations of this policy may result in:
- Immediate revocation of access privileges
- Disciplinary action up to and including termination
- Legal action where applicable

---

**Approval:**
- Security Lead: _______________________ Date: ___________
- CEO: _______________________ Date: ___________
