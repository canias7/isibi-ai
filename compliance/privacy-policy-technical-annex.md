# Privacy Policy — Technical Annex

**GoFarther AI — Isibi Technologies**
**Version:** 1.0
**Effective Date:** April 8, 2026
**Last Reviewed:** April 8, 2026
**Next Review:** October 8, 2026
**Owner:** Security Lead

---

## 1. Purpose

This technical annex supplements GoFarther AI's Privacy Policy with detailed information about data processing activities, technical safeguards, and user rights implementation, as required for SOC 2 compliance and GDPR transparency.

## 2. Data Inventory

### 2.1 Personal Data Collected

| Data Element | Source | Purpose | Legal Basis (GDPR) | Retention |
|-------------|--------|---------|-------------------|-----------|
| Email address | User registration | Account identification, communication | Contract performance | Until account deletion |
| Full name | User registration | Personalization, display | Contract performance | Until account deletion |
| Password (bcrypt hash) | User registration | Authentication | Contract performance | Until account deletion |
| IP address | Login requests | Security (anomaly detection), audit logging | Legitimate interest | 90 days (login logs), 365 days (audit logs) |
| Device name | Login requests | Session identification | Legitimate interest | Until session expiry + 30 days |
| TOTP secret | 2FA setup | Two-factor authentication | Contract performance | Until 2FA disabled or account deletion |
| Chat messages | User input | AI chat service delivery | Contract performance | Until user deletion |
| Phone numbers (recipients) | Tool usage (SMS/call) | Service delivery (send SMS, make calls) | Contract performance | Not stored (passed to Twilio) |
| Connected app credentials | App integration | Third-party service access | Consent | Until disconnection |

### 2.2 Data Not Collected

- Location data (GPS)
- Contacts or address book
- Photos or media library
- Biometric data
- Financial information (no payment processing)
- Advertising identifiers

### 2.3 Automatically Generated Data

| Data Element | Purpose | Retention |
|-------------|---------|-----------|
| Audit logs | Security monitoring, SOC 2 compliance | 365 days |
| Usage metrics (token counts) | Service monitoring, quota enforcement | 90 days |
| Session records | Active session management | Until revocation + 30 days |
| Login logs | Anomaly detection | 90 days |

## 3. Data Processing Activities

### 3.1 Processing Map

| Activity | Data Processed | Processor | Purpose |
|----------|---------------|-----------|---------|
| User authentication | Email, password hash | GoFarther AI (Render) | Account access |
| AI chat | Chat messages | Anthropic (Claude API) | Generate AI responses |
| SMS/WhatsApp | Recipient phone, message content | Twilio | Deliver user-requested messages |
| Voice calls | Recipient phone, call script | Twilio | Place user-requested calls |
| Email sending | Recipient email, content | Resend / SendGrid | Deliver user-requested emails |
| Login alerts | User email, IP address | Resend | Security notification |
| Push notifications | Expo push token | Expo | Scheduled task alerts |

### 3.2 Data Flow Diagram

```
User Device
  ├── SecureStore: JWT token, last_active timestamp
  ├── AsyncStorage: Chat sessions (local cache), preferences
  └── HTTPS → Render Backend
              ├── PostgreSQL
              │   ├── User accounts (email, name, password hash)
              │   ├── Chat sessions & messages (AES-256 encrypted)
              │   ├── Connected app credentials (AES-256 encrypted)
              │   ├── SMTP settings (AES-256 encrypted)
              │   ├── Audit logs
              │   ├── Usage logs
              │   ├── Sessions & trusted devices
              │   └── Login logs
              └── Third-Party APIs
                  ├── Anthropic: chat messages (prompt/response)
                  ├── Twilio: phone numbers, message content
                  ├── Resend: email addresses, email content
                  └── Expo: push tokens, notification content
```

## 4. Technical Safeguards

### 4.1 Encryption

| Layer | Method | Key Management |
|-------|--------|---------------|
| In transit | TLS 1.2+ (HTTPS) | Render-managed certificates |
| Chat messages at rest | AES-256-CBC | `CHAT_ENCRYPTION_KEY` (env var) |
| Connected app credentials | AES-256-CBC | `CONNECTOR_ENCRYPTION_KEY` (env var) |
| SMTP credentials | AES-256-CBC | `SMTP_ENCRYPTION_KEY` (env var) |
| Passwords | bcrypt (one-way hash) | N/A (irreversible) |
| Mobile secrets | iOS Keychain / Android Keystore | OS-managed |

### 4.2 Access Controls

- JWT-based authentication with session tracking
- Optional TOTP two-factor authentication
- 30-minute inactivity timeout
- File download restricted to owner
- Rate limiting on all endpoints

### 4.3 Input Validation

- SQL injection prevention via ORM parameterized queries
- Input sanitization on all user-provided data
- Password strength enforcement (8+ chars, complexity requirements)
- Content truncation in audit logs (100 chars max)

## 5. User Rights Implementation

### 5.1 Rights Matrix

| Right (GDPR) | Implementation | Endpoint / Feature |
|-------------|---------------|-------------------|
| **Right of Access** | User can view all their data | `GET /export` → JSON download |
| **Right to Rectification** | User can update their profile | Settings screen (name, email) |
| **Right to Erasure** | User can delete their account and all data | `DELETE /account` |
| **Right to Data Portability** | Machine-readable data export | `GET /export` → JSON format |
| **Right to Restrict Processing** | User can disconnect integrations, delete sessions | App integration management |
| **Right to Object** | User can stop using AI features | N/A (service is opt-in) |
| **Right to Withdraw Consent** | User can disconnect apps, delete account | Settings screen |

### 5.2 Data Export Format

The `GET /export` endpoint returns a JSON file containing:

```json
{
  "account": {
    "email": "user@example.com",
    "name": "User Name",
    "created_at": "2026-01-01T00:00:00Z",
    "is_2fa_enabled": false
  },
  "chat_sessions": [
    {
      "id": "...",
      "title": "...",
      "messages": [
        {
          "role": "user",
          "content": "decrypted message content",
          "timestamp": 1234567890
        }
      ]
    }
  ],
  "audit_logs": [...],
  "usage_logs": [...],
  "connected_apps": ["app_id_1", "app_id_2"]
}
```

### 5.3 Account Deletion Process

When a user requests account deletion (`DELETE /account`):
1. All chat sessions and messages are permanently deleted
2. All connected app credentials are permanently deleted
3. All active sessions are revoked
4. User account record is permanently deleted
5. Audit logs referencing the user email are retained for 365 days (SOC 2 requirement)
6. This action is irreversible

## 6. Breach Notification

### 6.1 Detection
- Automated: Login anomaly alerts, audit log monitoring
- Manual: User reports, team observations

### 6.2 Notification Timeline

| Audience | Timeline | Channel |
|----------|----------|---------|
| Supervisory authority (GDPR) | Within 72 hours of confirmed breach | Official notification |
| Affected users | Without undue delay | Email |
| All users (if systemic) | Within 72 hours | Email + in-app |

### 6.3 Notification Content
- Nature of the breach
- Categories of data affected
- Approximate number of users affected
- Likely consequences
- Measures taken to mitigate
- Contact information for questions

## 7. International Data Transfers

| Transfer | From → To | Safeguard |
|----------|-----------|-----------|
| User data to Render | User's country → US (Oregon) | Standard Contractual Clauses (Render DPA) |
| Chat data to Anthropic | US (Render) → US (Anthropic) | US-to-US (no international transfer) |
| Communication data to Twilio | US (Render) → US/Global (Twilio) | Standard Contractual Clauses (Twilio DPA) |

## 8. Cookies and Tracking

GoFarther AI (mobile application) does **not** use:
- Cookies
- Advertising trackers
- Analytics SDKs that collect PII
- Cross-app tracking identifiers

## 9. Children's Privacy

GoFarther AI is not directed at children under 16. We do not knowingly collect personal data from children. If we become aware of such collection, the data will be promptly deleted.

---

**Approval:**
- Security Lead: _______________________ Date: ___________
- CEO: _______________________ Date: ___________
