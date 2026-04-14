# Bug Bounty and Responsible Disclosure Policy

**GoFarther AI — Isibi Technologies**
**Version:** 1.0
**Effective Date:** April 8, 2026
**Last Reviewed:** April 8, 2026
**Next Review:** October 8, 2026
**Owner:** Security Lead

---

## 1. Program Overview

GoFarther AI is committed to the security of our users and systems. We welcome responsible security research and encourage the community to help us identify and fix vulnerabilities. This program is currently recognition-based; while we do not offer monetary rewards at this time, we are deeply appreciative of the security research community and provide public recognition for valid findings.

## 2. Scope

The following assets are in scope for this program:

| Asset | Description |
|-------|-------------|
| **GoFarther AI Mobile App (iOS)** | The iOS application distributed via the Apple App Store |
| **GoFarther AI Mobile App (Android)** | The Android application distributed via the Google Play Store |
| **API** | Backend API hosted at `isibi-backend.onrender.com` |

## 3. In-Scope Vulnerabilities

We are interested in reports covering the following vulnerability classes:

- **Authentication bypass** — Circumventing login, session management, or multi-factor authentication mechanisms
- **Injection attacks** — SQL injection, NoSQL injection, command injection, or other injection flaws
- **Sensitive data exposure** — Unintended disclosure of user data, credentials, API keys, or encryption keys
- **Insecure Direct Object References (IDOR)** — Accessing or modifying resources belonging to other users by manipulating identifiers
- **Privilege escalation** — Gaining elevated access beyond what is authorized for a given role or account
- **Encryption flaws** — Weaknesses in cryptographic implementations, insecure key storage, or use of deprecated algorithms
- **Broken access control** — Unauthorized access to API endpoints or application features
- **Cross-site scripting (XSS)** — Injection of malicious scripts (where applicable in web views)
- **Server-side request forgery (SSRF)** — Inducing the server to make requests to unintended locations

## 4. Out-of-Scope

The following are explicitly out of scope and should not be tested or reported:

- **Social engineering** — Phishing, vishing, or pretexting attacks against employees or users
- **Denial of Service (DoS/DDoS)** — Volumetric attacks or resource exhaustion against production systems
- **Spam** — Sending unsolicited messages through the platform
- **Rate limiting bypasses** — For rate limits that have already been mitigated or are by design
- **Third-party services** — Vulnerabilities in services not owned or operated by Isibi Technologies (e.g., Render, Resend, Stripe, OpenAI)
- **Self-XSS** — Attacks that require the victim to paste code into their own browser console
- **Missing security headers** — Unless directly exploitable
- **Software version disclosure** — Unless directly exploitable
- **Issues in pre-release or staging environments** — Unless they reflect production vulnerabilities

## 5. Rules of Engagement

Researchers must adhere to the following rules:

1. **No data destruction** — Do not delete, modify, or corrupt any data in production systems.
2. **No accessing other users' data** — If you discover a vulnerability that exposes user data, stop immediately and report it. Do not access, download, or store any data belonging to other users.
3. **No automated scanning without permission** — Do not run automated vulnerability scanners (e.g., Burp Suite active scan, Nessus, OWASP ZAP) against production systems without prior written approval. Manual testing is permitted.
4. **Minimal impact** — Conduct testing in a way that minimizes disruption to our services and users.
5. **No physical attacks** — Do not attempt physical access to offices, data centers, or employee devices.
6. **No public disclosure** — Do not publicly disclose any vulnerability before it has been fixed and you have received written authorization from our security team.
7. **Use test accounts** — Where possible, create your own test accounts rather than targeting existing user accounts.
8. **One vulnerability per report** — Submit separate reports for each distinct vulnerability discovered.

## 6. Reporting Process

### 6.1 How to Report

Send vulnerability reports via email to: **security@gofarther.ai**

### 6.2 Report Contents

Each report should include:

- **Description** — A clear and concise description of the vulnerability
- **Steps to reproduce** — Detailed, step-by-step instructions to reproduce the issue, including any tools, payloads, or configurations used
- **Impact assessment** — Your assessment of the potential impact and severity of the vulnerability
- **Affected asset** — Which in-scope asset is affected (mobile app, API, etc.)
- **Screenshots or proof of concept** — Visual evidence or working proof-of-concept code (non-destructive)
- **Suggested remediation** — Optional but appreciated: your recommendation for how to fix the issue
- **Your contact information** — Name (or alias) and preferred contact method for follow-up

### 6.3 Encryption

If you need to send sensitive information, please request our PGP public key by emailing security@gofarther.ai with the subject line "PGP Key Request."

## 7. Response Timeline

| Stage | Timeline |
|-------|----------|
| **Acknowledgment** | Within 3 business days of receiving the report |
| **Triage and initial assessment** | Within 10 business days of acknowledgment |
| **Status update** | At least every 15 business days until resolution |
| **Fix deployment** | Based on severity classification (see Section 8) |
| **Researcher notification** | Within 2 business days of fix deployment |

## 8. Severity Classification and Fix Timelines

| Severity | Description | Examples | Fix Timeline |
|----------|-------------|----------|-------------|
| **Critical** | Immediate risk of widespread data breach or system compromise | Authentication bypass affecting all users, remote code execution, encryption key exposure, mass data exfiltration | **24-48 hours** |
| **High** | Significant risk to user data or system integrity | IDOR allowing access to other users' data, privilege escalation to admin, SQL injection, stored XSS with session hijacking | **7 calendar days** |
| **Medium** | Moderate risk with limited scope or requiring specific conditions | Reflected XSS, information disclosure of internal system details, CSRF on sensitive actions, insecure direct object references with limited data exposure | **30 calendar days** |
| **Low** | Minimal risk or theoretical impact | Missing security headers (non-exploitable), verbose error messages, minor information disclosure | **90 calendar days** |

## 9. Safe Harbor

Isibi Technologies will not pursue legal action against researchers who:

- Act in good faith and in accordance with this policy
- Avoid privacy violations, data destruction, and service disruption
- Do not access, store, or exfiltrate data belonging to other users
- Report vulnerabilities promptly and provide reasonable time for remediation
- Do not publicly disclose vulnerabilities before authorization

We consider security research conducted in compliance with this policy to be authorized and will not initiate legal action under the Computer Fraud and Abuse Act (CFAA) or equivalent laws. If legal action is initiated by a third party, we will take steps to make it known that your actions were conducted in compliance with this policy.

## 10. Recognition

### 10.1 Security Hall of Fame

Researchers who submit valid, in-scope vulnerability reports will be recognized in our Security Hall of Fame (published on our website) unless they prefer to remain anonymous.

### 10.2 Release Notes

With the researcher's permission, we will acknowledge their contribution in the release notes of the version that includes the fix.

### 10.3 Future Rewards

While this program is currently recognition-based, we are evaluating the introduction of monetary rewards as the program matures. Researchers who participate early will be given priority consideration for any future paid program.

## 11. Policy Updates

This policy may be updated at any time. Material changes will be communicated via our website and security mailing list. The latest version of this policy is always available at our compliance documentation.

## 12. Contact

- **Security reports:** security@gofarther.ai
- **General security questions:** security@gofarther.ai
- **Policy questions:** compliance@gofarther.ai

---

**Approval:**
- Security Lead: _______________________ Date: ___________
- CEO: _______________________ Date: ___________
