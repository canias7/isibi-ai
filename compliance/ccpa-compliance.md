# CCPA Compliance Policy

**GoFarther AI — Isibi Technologies**
**Version:** 1.0
**Effective Date:** April 8, 2026
**Last Reviewed:** April 8, 2026
**Next Review:** October 8, 2026
**Owner:** Security Lead

---

## 1. Purpose

This policy documents GoFarther AI's compliance with the California Consumer Privacy Act (CCPA) and the California Privacy Rights Act (CPRA), ensuring California residents' privacy rights are respected and enforceable.

## 2. Scope

This policy applies to all personal information collected from California residents ("consumers") through the GoFarther AI mobile application and associated services.

## 3. Categories of Personal Information Collected

Per CCPA §1798.100, the following categories of personal information are collected:

| CCPA Category | Specific Data Elements | Business Purpose | Source |
|--------------|----------------------|-----------------|--------|
| **A. Identifiers** | Email address, full name, IP address, device name | Account creation, authentication, security monitoring | User-provided, automatically collected |
| **B. Personal records** | Name, email (overlaps with A) | Account management | User-provided |
| **D. Commercial information** | Usage metrics (token counts, request counts) | Service delivery, quota management | Automatically generated |
| **F. Internet/electronic activity** | Chat messages, tool usage history, audit logs, session data | Service delivery, security, compliance | User-generated, automatically collected |
| **G. Geolocation** | IP-derived approximate location (city/region level only) | Login anomaly detection | Automatically collected |

### Categories NOT Collected

| CCPA Category | Collected? |
|--------------|-----------|
| C. Protected classifications | No |
| E. Biometric information | No |
| H. Sensory data (audio, visual) | No |
| I. Professional/employment info | No |
| J. Education information | No |
| K. Inferences/profiling | No |

## 4. Business Purposes for Collection

Per CCPA §1798.100(b), personal information is collected and used for:

| Purpose | Description | Categories Used |
|---------|------------|----------------|
| **Service delivery** | Providing the GoFarther AI chat and tool functionality | A, D, F |
| **Account management** | Creating/maintaining user accounts, authentication | A, B |
| **Security** | Detecting unauthorized access, fraud prevention, audit logging | A, F, G |
| **Compliance** | Meeting SOC 2, GDPR, and legal obligations | A, D, F |
| **Service improvement** | Aggregated usage metrics for reliability and performance | D |

## 5. Sale and Sharing of Personal Information

### 5.1 Do Not Sell My Personal Information

**GoFarther AI does NOT sell personal information.** We have not sold personal information in the preceding 12 months and have no plans to do so.

Per CCPA §1798.120:
- No personal information is sold to third parties for monetary or other valuable consideration
- No personal information is shared for cross-context behavioral advertising

### 5.2 Third-Party Service Providers

Personal information is disclosed to the following service providers strictly for business purposes (not "sales" under CCPA):

| Service Provider | Data Shared | Purpose | DPA in Place |
|-----------------|------------|---------|-------------|
| Render | All application data (encrypted) | Infrastructure hosting | Yes |
| Anthropic | Chat messages (as AI prompts) | AI response generation | Yes |
| Twilio | Recipient phone numbers, message content | SMS/WhatsApp/voice delivery | Yes |
| Resend | Recipient email, email content | Email delivery | Yes |
| Expo | Push notification tokens | App updates, notifications | Yes |

All service providers are contractually prohibited from using disclosed data for any purpose other than performing services for GoFarther AI.

## 6. Consumer Rights

### 6.1 Right to Know (§1798.100, §1798.110)

Consumers have the right to know:
- What personal information is collected (see Section 3)
- Why it is collected (see Section 4)
- Whether it is sold or shared (see Section 5)
- What categories of third parties receive it (see Section 5.2)

**How to exercise:** Use the "Export My Data" button in Settings, or send a request to the contact email below.

**Implementation:** `GET /api/ghost/export` returns a complete JSON export of all user data including account info, chat history (decrypted), audit logs, usage data, and connected app IDs.

### 6.2 Right to Delete (§1798.105)

Consumers have the right to request deletion of their personal information.

**How to exercise:** Use "Delete Account" in Settings, or send a request to the contact email below.

**Implementation:** `DELETE /api/ghost/account` permanently removes:
- User account record
- All chat sessions and messages
- All connected app credentials
- All active sessions

**Exceptions:** Audit logs referencing the user's email are retained for 365 days as required for SOC 2 compliance and legal obligations (CCPA §1798.105(d)(8)).

### 6.3 Right to Correct (§1798.106)

Consumers have the right to correct inaccurate personal information.

**How to exercise:** Update name or email in Settings, or contact us.

### 6.4 Right to Opt-Out of Sale (§1798.120)

GoFarther AI does not sell personal information. No opt-out mechanism is needed, but we honor all opt-out requests as a matter of policy.

### 6.5 Right to Limit Use of Sensitive Personal Information (§1798.121)

GoFarther AI does not collect sensitive personal information as defined by CCPA (Social Security numbers, financial account details, precise geolocation, racial/ethnic origin, biometric data, health data, sexual orientation, or private communications where GoFarther AI is not the intended recipient).

### 6.6 Right to Non-Discrimination (§1798.125)

GoFarther AI will not discriminate against consumers who exercise their CCPA rights. Specifically, we will not:
- Deny goods or services
- Charge different prices or rates
- Provide a different level or quality of service
- Suggest any of the above will occur

## 7. Verification of Requests

To protect consumer privacy, we verify the identity of requesters:

| Request Type | Verification Method |
|-------------|-------------------|
| Right to Know | Must be logged in (JWT authentication) |
| Right to Delete | Must be logged in (JWT authentication) |
| Right to Correct | Must be logged in (JWT authentication) |
| Authorized Agent | Written authorization from consumer + agent identity verification |

Requests are processed within **45 calendar days** as required by CCPA. If additional time is needed (up to 45 more days), the consumer will be notified.

## 8. Authorized Agents

Consumers may designate an authorized agent to submit requests on their behalf. The agent must provide:

1. Written authorization signed by the consumer
2. Proof of the agent's identity
3. Proof of authorization to act on the consumer's behalf (power of attorney or signed permission)

Submit authorized agent requests to the contact email below.

## 9. Minors

GoFarther AI does not knowingly collect personal information from consumers under 16 years of age. We do not sell personal information of any consumer, including minors.

## 10. Data Retention

Personal information is retained only as long as necessary for the purposes described in Section 4. See the Data Retention Policy (`data-retention-policy.md`) for specific retention periods.

**Summary:**
| Data | Retention |
|------|-----------|
| User account | Until account deletion |
| Chat messages | Until user deletes session or account |
| Audit logs | 365 days |
| Usage logs | 90 days |
| Login/session logs | 90 days |

## 11. Security Measures

GoFarther AI implements reasonable security measures to protect personal information:

- AES-256 encryption for chat messages, credentials, and SMTP settings at rest
- TLS 1.2+ encryption for all data in transit
- Bcrypt password hashing
- Optional TOTP two-factor authentication
- JWT session management with server-side revocation
- 30-minute inactivity auto-logout
- Rate limiting on all endpoints
- Comprehensive audit logging
- Automated data retention enforcement

Full details in the Information Security Policy (`information-security-policy.md`).

## 12. Notice at Collection

Per CCPA §1798.100(b), at or before the point of collection, GoFarther AI discloses:
- Categories of personal information collected (Section 3)
- Purposes for collection (Section 4)
- Whether information is sold or shared (Section 5 — No)
- Retention periods (Section 10)

This notice is provided via the app's Privacy Policy and this technical document.

## 13. Annual Metrics

Per CCPA §1798.185, GoFarther AI will track and report annually (if required based on revenue thresholds):

| Metric | Count |
|--------|-------|
| Requests to Know received | — |
| Requests to Know completed | — |
| Requests to Delete received | — |
| Requests to Delete completed | — |
| Requests to Opt-Out received | — |
| Median response time (days) | — |

*(To be populated at end of each calendar year)*

## 14. Updates to This Policy

This policy is reviewed semi-annually and updated as needed. Material changes will be communicated to users via email or in-app notification.

## 15. Contact Information

For CCPA-related requests or questions:

- **Email:** [privacy@gofarther.ai — to be configured]
- **Response time:** Within 10 business days for acknowledgment; 45 calendar days for fulfillment
- **In-app:** Settings → Export My Data / Delete Account

---

**Approval:**
- Security Lead: _______________________ Date: ___________
- CEO: _______________________ Date: ___________
