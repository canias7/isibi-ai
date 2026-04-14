# Email Authentication Setup Guide (DMARC/SPF/DKIM)

**GoFarther AI — Isibi Technologies**
**Version:** 1.0
**Effective Date:** April 8, 2026
**Last Reviewed:** April 8, 2026
**Next Review:** October 8, 2026
**Owner:** Security Lead

---

## 1. Purpose

This guide establishes the email authentication configuration for the `gofarther.ai` domain to prevent email spoofing, phishing, and unauthorized use of our domain in email communications. Properly configured SPF, DKIM, and DMARC records protect our users, our brand reputation, and our email deliverability.

## 2. Overview

Email authentication relies on three complementary DNS-based mechanisms:

| Mechanism | Purpose |
|-----------|---------|
| **SPF** (Sender Policy Framework) | Specifies which mail servers are authorized to send email on behalf of `gofarther.ai` |
| **DKIM** (DomainKeys Identified Mail) | Adds a cryptographic signature to outgoing emails to verify they have not been altered in transit |
| **DMARC** (Domain-based Message Authentication, Reporting, and Conformance) | Tells receiving mail servers how to handle emails that fail SPF and/or DKIM checks, and provides reporting |

## 3. SPF Configuration

### 3.1 SPF Record

Add the following TXT record to the `gofarther.ai` DNS zone:

| Record Type | Host | Value |
|------------|------|-------|
| TXT | `@` (or `gofarther.ai`) | `v=spf1 include:amazonses.com include:sendgrid.net include:resend.com ~all` |

### 3.2 SPF Record Breakdown

| Directive | Purpose |
|-----------|---------|
| `v=spf1` | Identifies this as an SPF record (version 1) |
| `include:amazonses.com` | Authorizes Amazon SES to send email on our behalf |
| `include:sendgrid.net` | Authorizes SendGrid to send email on our behalf |
| `include:resend.com` | Authorizes Resend to send email on our behalf |
| `~all` | Soft fail for all other senders (emails from unauthorized senders are marked as suspicious but not rejected) |

### 3.3 Important Notes

- Only one SPF record should exist per domain. Multiple SPF records will cause validation failures.
- The SPF specification limits DNS lookups to 10. Each `include:` directive counts as one lookup. Monitor this limit if adding new email services.
- When transitioning to full enforcement, change `~all` (soft fail) to `-all` (hard fail) only after verifying all legitimate senders are included.

## 4. DKIM Configuration

### 4.1 Resend DKIM Setup

1. Log in to the [Resend Dashboard](https://resend.com/domains).
2. Navigate to **Domains** and select `gofarther.ai`.
3. Resend will provide three CNAME records for DKIM signing. They will be in the following format:

| Record Type | Host | Value |
|------------|------|-------|
| CNAME | `resend._domainkey.gofarther.ai` | *(provided by Resend dashboard)* |
| CNAME | `resend2._domainkey.gofarther.ai` | *(provided by Resend dashboard)* |
| CNAME | `resend3._domainkey.gofarther.ai` | *(provided by Resend dashboard)* |

4. Add each CNAME record to your DNS configuration.
5. Return to the Resend dashboard and click **Verify** to confirm the records are propagated.

### 4.2 SendGrid DKIM Setup

1. Log in to the [SendGrid Dashboard](https://app.sendgrid.com).
2. Navigate to **Settings > Sender Authentication > Authenticate Your Domain**.
3. Select your DNS host and enter `gofarther.ai`.
4. SendGrid will generate CNAME records for DKIM. They will be in the following format:

| Record Type | Host | Value |
|------------|------|-------|
| CNAME | `s1._domainkey.gofarther.ai` | *(provided by SendGrid dashboard)* |
| CNAME | `s2._domainkey.gofarther.ai` | *(provided by SendGrid dashboard)* |

5. Add each CNAME record to your DNS configuration.
6. Return to SendGrid and click **Verify** to confirm.

### 4.3 Amazon SES DKIM Setup

1. Log in to the [AWS Console](https://console.aws.amazon.com/ses/).
2. Navigate to **SES > Verified Identities > gofarther.ai**.
3. Under the **Authentication** tab, SES provides three CNAME records for Easy DKIM:

| Record Type | Host | Value |
|------------|------|-------|
| CNAME | `*token1*._domainkey.gofarther.ai` | `*token1*.dkim.amazonses.com` |
| CNAME | `*token2*._domainkey.gofarther.ai` | `*token2*.dkim.amazonses.com` |
| CNAME | `*token3*._domainkey.gofarther.ai` | `*token3*.dkim.amazonses.com` |

4. Add each CNAME record to your DNS configuration. The actual token values are unique and provided by AWS.
5. SES will automatically verify the records once they propagate (typically within 72 hours).

## 5. DMARC Configuration

### 5.1 DMARC Record

Add the following TXT record to the `gofarther.ai` DNS zone:

| Record Type | Host | Value |
|------------|------|-------|
| TXT | `_dmarc.gofarther.ai` (or `_dmarc` depending on registrar) | `v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@gofarther.ai; pct=100` |

### 5.2 DMARC Record Breakdown

| Tag | Value | Purpose |
|-----|-------|---------|
| `v=DMARC1` | Version identifier | Identifies this as a DMARC record |
| `p=quarantine` | Policy | Instructs receivers to quarantine (typically move to spam) emails that fail authentication |
| `rua=mailto:dmarc-reports@gofarther.ai` | Aggregate report URI | Where to send daily aggregate DMARC reports |
| `pct=100` | Percentage | Apply the policy to 100% of failing messages |

### 5.3 Gradual Enforcement Strategy

Implement DMARC in stages to avoid accidentally blocking legitimate email:

| Phase | Duration | DMARC Policy | Purpose |
|-------|----------|-------------|---------|
| **Phase 1: Monitor** | 2-4 weeks | `v=DMARC1; p=none; rua=mailto:dmarc-reports@gofarther.ai; pct=100` | Collect reports without affecting email delivery. Identify any legitimate senders not covered by SPF/DKIM. |
| **Phase 2: Quarantine** | 4-8 weeks | `v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@gofarther.ai; pct=100` | Failed emails are sent to spam. Monitor reports for false positives. |
| **Phase 3: Reject** | Ongoing | `v=DMARC1; p=reject; rua=mailto:dmarc-reports@gofarther.ai; pct=100` | Failed emails are outright rejected. Full enforcement. |

## 6. Step-by-Step DNS Setup

### 6.1 General Instructions

The exact steps vary by registrar, but the general process is:

1. Log in to your domain registrar's control panel (e.g., Namecheap, Cloudflare, GoDaddy, Google Domains).
2. Navigate to the DNS management section for `gofarther.ai`.
3. Add each record as described in the sections above:
   - **TXT records** for SPF and DMARC
   - **CNAME records** for DKIM (from Resend, SendGrid, and Amazon SES)
4. Set TTL (Time to Live) to 3600 seconds (1 hour) or the default value.
5. Save changes and wait for DNS propagation (can take up to 48 hours, typically 15 minutes to a few hours).

### 6.2 Common Registrar Notes

- **Cloudflare:** When adding CNAME records for DKIM, ensure the proxy status is set to "DNS only" (gray cloud), not "Proxied" (orange cloud).
- **Namecheap:** For the DMARC record host, enter `_dmarc` (without the domain suffix, as Namecheap appends it automatically).
- **GoDaddy:** For the SPF record host, use `@` to represent the root domain.
- **Google Domains/Squarespace:** Use `@` for root domain TXT records and `_dmarc` for the DMARC record host.

## 7. Verification

### 7.1 DNS Verification Commands

After adding the records, verify them using the following commands:

**Verify SPF record:**
```bash
dig TXT gofarther.ai
```
Look for the `v=spf1` entry in the output.

**Verify DMARC record:**
```bash
dig TXT _dmarc.gofarther.ai
```
Look for the `v=DMARC1` entry in the output.

**Verify DKIM records (example for Resend):**
```bash
dig CNAME resend._domainkey.gofarther.ai
```

### 7.2 Online Testing Tools

| Tool | URL | Purpose |
|------|-----|---------|
| **MXToolbox SPF Checker** | https://mxtoolbox.com/spf.aspx | Validate SPF record syntax and lookup count |
| **MXToolbox DMARC Checker** | https://mxtoolbox.com/dmarc.aspx | Validate DMARC record syntax |
| **MXToolbox DKIM Checker** | https://mxtoolbox.com/dkim.aspx | Validate DKIM record for a specific selector |
| **mail-tester.com** | https://www.mail-tester.com | Send a test email and receive a comprehensive deliverability score |
| **Google Admin Toolbox** | https://toolbox.googleapps.com/apps/checkmx/ | Check MX, SPF, and DMARC records |

### 7.3 Send a Test Email

1. Send a test email from each configured service (Resend, SendGrid, Amazon SES) to an external email address (e.g., a Gmail account).
2. In the received email, click "Show Original" (Gmail) or view the email headers.
3. Verify that SPF, DKIM, and DMARC all show `PASS`.

## 8. Monitoring

### 8.1 DMARC Report Review

- Review DMARC aggregate reports sent to `dmarc-reports@gofarther.ai` on a **monthly** basis at minimum.
- Parse reports using a DMARC report analyzer tool (e.g., DMARC Analyzer, Postmark DMARC, or dmarcian).
- Look for:
  - Unauthorized senders using the `gofarther.ai` domain
  - Legitimate services failing SPF or DKIM (indicating misconfiguration)
  - Changes in email volume patterns that may indicate abuse

### 8.2 Ongoing Maintenance

- Update SPF records whenever a new email sending service is added or removed.
- Rotate DKIM keys annually or when a key compromise is suspected.
- Review and update this guide whenever email infrastructure changes.
- Monitor SPF lookup count to stay within the 10-lookup limit.

## 9. Troubleshooting

| Issue | Possible Cause | Resolution |
|-------|---------------|------------|
| SPF failures for legitimate email | Sending service not included in SPF record | Add the service's `include:` directive to the SPF record |
| DKIM failures | CNAME records not propagated or incorrect | Verify CNAME records match exactly what the provider specified; check propagation |
| DMARC reports show high failure rate | SPF or DKIM misconfigured | Review failures in DMARC reports and fix the underlying SPF/DKIM issue before advancing enforcement |
| Email going to spam | DMARC policy too strict before SPF/DKIM are fully configured | Roll back to `p=none` and fix authentication issues before re-enabling |
| SPF PermError | Too many DNS lookups (exceeds 10) | Consolidate includes or use subdomains for different sending services |

---

**Approval:**
- Security Lead: _______________________ Date: ___________
- CEO: _______________________ Date: ___________
