# Vendor Risk Assessment

**GoFarther AI — Isibi Technologies**
**Version:** 1.0
**Effective Date:** April 8, 2026
**Last Reviewed:** April 8, 2026
**Next Review:** October 8, 2026
**Owner:** Security Lead

---

## 1. Purpose

This document assesses the security posture and risk level of all third-party vendors and service providers used by GoFarther AI, as required by SOC 2 Trust Service Criteria (CC9.2 — Risk Management of Third Parties).

## 2. Vendor Assessment Criteria

Each vendor is evaluated on:
- **Data Access:** What user data does the vendor process or store?
- **Compliance:** SOC 2, ISO 27001, or equivalent certifications
- **Data Processing Agreement (DPA):** Contractual data protection obligations
- **Data Residency:** Where data is stored and processed
- **Incident History:** Known breaches or security incidents
- **Risk Level:** Overall risk classification (Critical / High / Medium / Low)

---

## 3. Vendor Assessments

### 3.1 Render (Infrastructure)

| Attribute | Detail |
|-----------|--------|
| **Service** | Application hosting, PostgreSQL database, managed TLS |
| **Data Shared** | All application data (encrypted at rest), environment variables, deployment artifacts |
| **Compliance** | SOC 2 Type II certified |
| **DPA** | Available via Render's Terms of Service |
| **Data Residency** | United States (Oregon region) |
| **Encryption** | AES-256 at rest, TLS 1.2+ in transit |
| **Incident History** | No known public breaches |
| **Risk Level** | **Critical** — Hosts all infrastructure and data |
| **Mitigation** | Application-level encryption for sensitive data (chat, credentials, SMTP) provides defense-in-depth beyond Render's infrastructure encryption. Environment variables used for secrets (never in code). |

### 3.2 Anthropic (AI Provider)

| Attribute | Detail |
|-----------|--------|
| **Service** | Claude AI API for chat completions and tool orchestration |
| **Data Shared** | User chat messages (sent as prompts), tool call parameters |
| **Compliance** | SOC 2 Type II certified |
| **DPA** | Available via Anthropic's API Terms |
| **Data Residency** | United States |
| **Data Retention** | API inputs/outputs not used for training; 30-day retention for abuse monitoring |
| **Incident History** | No known data breaches |
| **Risk Level** | **High** — Processes user chat content |
| **Mitigation** | No personally identifiable information (PII) required in prompts. Users are informed that chat messages are processed by AI. System prompts do not contain secrets. |

### 3.3 Twilio (Communications)

| Attribute | Detail |
|-----------|--------|
| **Service** | SMS sending, WhatsApp messaging, voice calls |
| **Data Shared** | Recipient phone numbers, message content, call parameters |
| **Compliance** | SOC 2 Type II certified, ISO 27001 |
| **DPA** | Available via Twilio's Data Protection Addendum |
| **Data Residency** | United States (primary), global edge |
| **Incident History** | August 2022 phishing incident (employee credentials); remediated |
| **Risk Level** | **High** — Processes user communication data |
| **Mitigation** | Rate limiting on SMS/WhatsApp/call endpoints (10/min SMS, 5/min calls). Credentials stored as encrypted environment variables. Audit logging on all communication tool invocations. |

### 3.4 Resend (Email)

| Attribute | Detail |
|-----------|--------|
| **Service** | Transactional email delivery (login alerts, password resets) |
| **Data Shared** | Recipient email addresses, email content |
| **Compliance** | SOC 2 in progress |
| **DPA** | Available via Resend's Terms |
| **Data Residency** | United States |
| **Incident History** | No known breaches |
| **Risk Level** | **Medium** — Sends transactional emails with user email addresses |
| **Mitigation** | Only system-generated emails sent via Resend (login alerts, password resets). No bulk marketing. Rate limiting on email endpoints (15/min). |

### 3.5 Expo (Mobile Development)

| Attribute | Detail |
|-----------|--------|
| **Service** | React Native framework, OTA updates, push notifications, build service |
| **Data Shared** | Application bundles, push notification tokens |
| **Compliance** | SOC 2 not publicly documented |
| **DPA** | Via Expo Terms of Service |
| **Data Residency** | United States |
| **Incident History** | No known breaches |
| **Risk Level** | **Medium** — Delivers application code to users |
| **Mitigation** | No user data stored on Expo servers. OTA updates are code-only. Push notification content is minimal (notification text only, no sensitive data). Sensitive data stored in device Keychain/Keystore, not in app bundle. |

### 3.6 Apple / Google (Authentication & Distribution)

| Attribute | Detail |
|-----------|--------|
| **Service** | Social login (Sign in with Apple, Google Sign-In), App Store / Play Store distribution |
| **Data Shared** | User email, name (on social login); app binaries (distribution) |
| **Compliance** | Both SOC 2 Type II certified, ISO 27001, extensive compliance programs |
| **DPA** | Via platform developer agreements |
| **Data Residency** | Global |
| **Risk Level** | **Low** — Industry-standard authentication providers |
| **Mitigation** | Social login generates a secure random password server-side (users never see it). OAuth tokens are not stored long-term. |

### 3.7 SendGrid (Optional Email)

| Attribute | Detail |
|-----------|--------|
| **Service** | Alternative email delivery provider |
| **Data Shared** | Recipient email addresses, email content |
| **Compliance** | SOC 2 Type II certified (Twilio subsidiary) |
| **DPA** | Via SendGrid/Twilio DPA |
| **Data Residency** | United States |
| **Risk Level** | **Medium** — Alternative email provider |
| **Mitigation** | Same controls as primary email provider. API key stored as environment variable. |

---

## 4. Risk Summary

| Vendor | Risk Level | SOC 2 | DPA | Last Reviewed |
|--------|-----------|-------|-----|--------------|
| Render | Critical | Yes | Yes | April 2026 |
| Anthropic | High | Yes | Yes | April 2026 |
| Twilio | High | Yes | Yes | April 2026 |
| Resend | Medium | In Progress | Yes | April 2026 |
| Expo | Medium | No | Yes | April 2026 |
| Apple/Google | Low | Yes | Yes | April 2026 |
| SendGrid | Medium | Yes | Yes | April 2026 |

## 5. Vendor Management Procedures

### 5.1 New Vendor Onboarding
1. Complete risk assessment using this template
2. Verify compliance certifications
3. Execute DPA if vendor processes user data
4. Document data flows and access scope
5. Security Lead approval required for Critical/High risk vendors

### 5.2 Ongoing Monitoring
- Annual risk reassessment for all vendors
- Quarterly review for Critical/High risk vendors
- Monitor vendor security advisories and breach notifications
- Verify continued compliance certification

### 5.3 Vendor Offboarding
1. Revoke all API keys and access credentials
2. Confirm data deletion per DPA terms
3. Update this assessment document
4. Archive vendor records for 1 year

---

**Approval:**
- Security Lead: _______________________ Date: ___________
- CEO: _______________________ Date: ___________
