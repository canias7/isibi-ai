# Penetration Testing Guide

**GoFarther AI — Isibi Technologies**
**Version:** 1.0
**Effective Date:** April 8, 2026
**Last Reviewed:** April 8, 2026
**Next Review:** October 8, 2026
**Owner:** Security Lead

---

## 1. Purpose

This guide establishes the requirements and procedures for penetration testing of GoFarther AI systems. Annual penetration testing is a requirement for SOC 2 Type II compliance and is essential for identifying vulnerabilities that automated tools may miss.

## 2. Testing Requirements

- **Full penetration test:** Annually (required for SOC 2 compliance)
- **Vulnerability scanning:** Quarterly
- **Ad hoc testing:** After significant infrastructure changes, major feature releases, or security incidents

## 3. Scope

The following systems and components are in scope for penetration testing:

| Category | Assets |
|----------|--------|
| **API Endpoints** | All REST API endpoints at `isibi-backend.onrender.com`, including authentication, chat, user management, and integrations |
| **Authentication Flows** | User registration, login, JWT token issuance and validation, TOTP-based MFA, password reset, session management |
| **Encryption Implementation** | AES-256-GCM encryption of chat messages and connected app credentials, key derivation (PBKDF2), key storage and rotation |
| **Mobile Application** | GoFarther AI iOS and Android applications, including local data storage, certificate pinning, and API communication |
| **Third-Party Integrations** | OAuth flows for connected services (Google Calendar, Notion, etc.), webhook endpoints, email sending infrastructure |
| **Infrastructure** | Server configuration, TLS/SSL implementation, HTTP security headers, CORS policies |

## 4. Testing Methodology

All penetration testing must follow established industry methodologies:

- **OWASP Testing Guide** — Primary reference for web application and API security testing
- **PTES (Penetration Testing Execution Standard)** — Framework for overall test structure, phases, and reporting
- **OWASP Mobile Security Testing Guide (MSTG)** — Reference for mobile application security testing

### 4.1 Testing Phases

| Phase | Activities |
|-------|-----------|
| **1. Planning and Reconnaissance** | Define scope, gather information, identify attack surface |
| **2. Scanning and Enumeration** | Port scanning, service identification, vulnerability scanning |
| **3. Exploitation** | Attempt to exploit identified vulnerabilities in a controlled manner |
| **4. Post-Exploitation** | Assess the impact of successful exploits, determine data access, lateral movement potential |
| **5. Reporting** | Document all findings with evidence, severity ratings, and remediation recommendations |
| **6. Remediation Verification** | Retest after fixes are applied to confirm vulnerabilities are resolved |

## 5. Types of Testing

| Type | Description | Knowledge Level | Recommendation |
|------|-------------|----------------|----------------|
| **Black Box** | Tester has no prior knowledge of the system architecture, source code, or credentials | External attacker perspective | Useful for simulating real-world attacks but may miss internal vulnerabilities |
| **Gray Box** | Tester has partial knowledge — typically API documentation, test account credentials, and basic architecture overview | Informed attacker perspective | **Recommended for GoFarther AI.** Provides the best balance of coverage and efficiency. |
| **White Box** | Tester has full access to source code, architecture documentation, and admin credentials | Full insider perspective | Most thorough but most time-intensive; consider for critical components like encryption |

**Recommendation:** Gray box testing is recommended as the primary approach for annual penetration tests. This provides testers with sufficient context to test efficiently while still evaluating the application from an attacker's perspective. White box testing should be considered specifically for the encryption implementation review.

## 6. Pre-Test Preparation Checklist

Complete the following before any penetration test engagement:

- [ ] **Staging environment** — Provision a staging environment that mirrors production. Ensure it contains realistic (but non-production) data. Confirm the staging environment is isolated from production.
- [ ] **Test accounts** — Create dedicated test accounts with various permission levels (standard user, admin). Provide credentials to the testing team securely.
- [ ] **Scope document** — Finalize and sign a written scope document specifying exactly which systems, endpoints, and IP ranges are authorized for testing.
- [ ] **Rules of engagement** — Define and agree upon rules of engagement, including:
  - Testing hours and time zone
  - Rate limiting and load restrictions
  - Prohibited actions (e.g., denial of service, social engineering of employees)
  - Data handling requirements (testers must not retain any user data)
- [ ] **Emergency contacts** — Provide the testing team with emergency contact information:
  - Security Lead: direct phone and email
  - Engineering Lead: direct phone and email
  - Escalation path for critical findings discovered during testing
- [ ] **Notification** — Notify the hosting provider (Render) and any relevant third parties that authorized testing will occur during the specified window.
- [ ] **Backup verification** — Confirm that current backups exist and have been tested for restoration.
- [ ] **Monitoring** — Ensure logging and monitoring are active during the test to capture all testing activity for review.

## 7. Vendor Selection Criteria

When selecting a penetration testing firm, evaluate against the following criteria:

| Criterion | Requirement |
|-----------|------------|
| **Certifications** | CREST accredited firm, and/or testers holding OSCP, OSCE, GPEN, or equivalent certifications |
| **Experience** | Demonstrated experience testing SaaS applications and mobile apps |
| **SOC 2 reporting** | Ability to produce reports in a format suitable for SOC 2 auditors, including detailed findings, evidence, and remediation verification |
| **Methodology** | Follows OWASP Testing Guide and/or PTES |
| **Insurance** | Professional indemnity and cyber liability insurance |
| **References** | Provide references from clients of similar size and industry |
| **Data handling** | Clear data handling and destruction policies; willingness to sign an NDA |
| **Communication** | Dedicated point of contact, real-time communication channel for critical findings |

## 8. Post-Test Process

### 8.1 Report Receipt and Review

1. Receive the full penetration test report from the vendor.
2. Schedule a report walkthrough meeting with the vendor to discuss findings.
3. Verify that all findings include sufficient evidence and reproduction steps.

### 8.2 Finding Classification

Classify each finding by severity using the table in Section 9.

### 8.3 Remediation

1. Assign each finding to the appropriate team member.
2. Develop remediation plans with target dates based on severity timelines.
3. Track progress in the findings tracker (see Section 10).

### 8.4 Retest

1. After remediation is complete, engage the vendor to retest each finding.
2. Obtain written confirmation that each finding has been resolved.
3. Archive the final report (including retest results) for SOC 2 audit evidence.

## 9. Finding Severity and Remediation Timeline

| Severity | Description | Remediation Timeline |
|----------|-------------|---------------------|
| **Critical** | Vulnerabilities that allow immediate, unauthorized access to sensitive data or systems. Examples: remote code execution, authentication bypass, mass data exposure, encryption key compromise. | **48 hours** — Immediate hotfix. May require emergency deployment. |
| **High** | Vulnerabilities that pose significant risk but require specific conditions or have limited scope. Examples: IDOR with data access, privilege escalation, SQL injection, stored XSS with session hijacking. | **7 calendar days** |
| **Medium** | Vulnerabilities with moderate impact or that require significant user interaction. Examples: reflected XSS, CSRF, information disclosure, insecure session handling. | **30 calendar days** |
| **Low** | Minor issues with minimal direct security impact. Examples: verbose error messages, missing non-critical security headers, minor information leakage. | **90 calendar days** |
| **Informational** | Best practice recommendations and hardening suggestions with no direct exploitability. | **Next scheduled release** — Address during normal development cycles. |

## 10. Finding Tracking Template

Use the following template to track all penetration test findings through remediation:

| ID | Title | Severity | Status | Assigned To | Target Remediation Date | Actual Remediation Date | Retest Result | Notes |
|----|-------|----------|--------|-------------|------------------------|------------------------|---------------|-------|
| PT-2026-001 | *(finding title)* | Critical/High/Medium/Low | Open / In Progress / Remediated / Verified / Accepted Risk | *(team member)* | *(date)* | *(date)* | Pass / Fail / Pending | *(additional context)* |
| PT-2026-002 | | | | | | | | |
| PT-2026-003 | | | | | | | | |

### Status Definitions

| Status | Definition |
|--------|-----------|
| **Open** | Finding has been reviewed and accepted; remediation has not yet started |
| **In Progress** | Remediation work is underway |
| **Remediated** | Fix has been implemented and deployed; awaiting retest |
| **Verified** | Vendor has confirmed the finding is resolved via retest |
| **Accepted Risk** | Finding has been reviewed and accepted as a known risk with documented justification and management approval |

## 11. Recommended Testing Schedule

| Activity | Frequency | Purpose |
|----------|-----------|---------|
| **Full penetration test** | Annually | SOC 2 requirement; comprehensive security assessment by external vendor |
| **Vulnerability scan** | Quarterly | Automated scanning to identify known vulnerabilities and misconfigurations |
| **Mobile app security review** | Annually (with pen test) | Assess mobile-specific risks: local storage, certificate pinning, binary protections |
| **Encryption review** | Annually (with pen test) | Validate encryption implementation, key management, and cryptographic best practices |
| **Retest of findings** | After remediation | Verify that identified vulnerabilities have been properly fixed |

## 12. Budget Planning

When budgeting for penetration testing, account for the following cost categories:

| Item | Estimated Range | Notes |
|------|----------------|-------|
| **Annual full penetration test** | $8,000 - $25,000 | Varies by scope, complexity, and vendor. Gray box testing for a SaaS application with API and mobile components. |
| **Quarterly vulnerability scans** | $1,000 - $5,000/year | Can use a combination of commercial tools (e.g., Qualys, Tenable) and open-source scanners. |
| **Retest engagement** | $2,000 - $5,000 | Vendor retesting after remediation. Some vendors include one retest in the original engagement. |
| **Emergency/ad hoc testing** | $3,000 - $10,000 | Budget for unplanned testing after significant incidents or infrastructure changes. |

**Total estimated annual budget:** $14,000 - $45,000

Notes:
- Obtain quotes from at least three vendors before selecting.
- Multi-year contracts may offer cost savings.
- Consider negotiating retest inclusion in the base engagement.
- First-year costs may be higher due to the broader initial assessment.

## 13. Document Retention

- Penetration test reports must be retained for a minimum of 3 years for SOC 2 audit purposes.
- Store reports securely with access restricted to the Security Lead, Engineering Lead, and CEO.
- Reports must not be shared externally without written authorization from the CEO.

---

**Approval:**
- Security Lead: _______________________ Date: ___________
- CEO: _______________________ Date: ___________
