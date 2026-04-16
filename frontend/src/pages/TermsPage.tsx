export function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold text-black mb-2">Terms of Service</h1>
        <p className="text-sm text-gray-500 mb-10">Last updated: March 2026</p>

        <div className="space-y-8 text-gray-800 leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-black mb-3">1. Acceptance of Terms</h2>
            <p>
              By accessing or using the isibi.ai platform ("Service"), you agree to be bound by
              these Terms of Service ("Terms"). If you do not agree to these Terms, you may not
              access or use the Service. These Terms apply to all visitors, users, and others
              who access the Service. By using the Service, you represent that you are at least
              18 years of age and have the legal capacity to enter into a binding agreement.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-black mb-3">2. Description of Services</h2>
            <p>
              isibi.ai provides an AI-powered software development platform that enables users
              to describe, generate, preview, and deploy custom web applications. The Service
              includes, but is not limited to, AI-assisted application generation, code preview,
              database provisioning, deployment infrastructure, and related tools. We reserve
              the right to modify, suspend, or discontinue any aspect of the Service at any
              time without prior notice.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-black mb-3">3. User Accounts</h2>
            <p>
              To access certain features of the Service, you must register for an account. You
              are responsible for maintaining the confidentiality of your account credentials
              and for all activities that occur under your account. You agree to notify us
              immediately of any unauthorized use of your account. We reserve the right to
              suspend or terminate accounts that violate these Terms or that we reasonably
              believe have been compromised.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-black mb-3">4. Intellectual Property</h2>
            <p>
              The Service, including its original content, features, and functionality, is
              owned by isibi.ai and is protected by international copyright, trademark, patent,
              trade secret, and other intellectual property laws. Our trademarks and trade dress
              may not be used in connection with any product or service without our prior
              written consent.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-black mb-3">5. Generated Content and Applications</h2>
            <p>
              Applications and code generated through the Service are provided to you under a
              perpetual, non-exclusive license. You retain ownership of the prompts and
              specifications you provide. However, isibi.ai retains the right to use
              anonymized and aggregated data derived from usage patterns to improve the
              Service. You are solely responsible for reviewing, testing, and validating any
              generated code before deploying it in production environments. isibi.ai does not
              guarantee the correctness, security, or fitness for purpose of generated
              applications.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-black mb-3">6. Payments and Billing</h2>
            <p>
              Certain features of the Service require payment. By subscribing to a paid plan,
              you agree to pay all applicable fees as described on our pricing page. Fees are
              non-refundable except as required by law or as explicitly stated in our refund
              policy. We reserve the right to change our pricing at any time, with at least
              30 days notice for existing subscribers. Failure to pay may result in suspension
              or termination of your access to paid features.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-black mb-3">7. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by applicable law, isibi.ai and its directors,
              employees, partners, agents, suppliers, or affiliates shall not be liable for any
              indirect, incidental, special, consequential, or punitive damages, including
              without limitation loss of profits, data, use, goodwill, or other intangible
              losses, resulting from your access to or use of (or inability to access or use)
              the Service. In no event shall our aggregate liability exceed the amount you paid
              us in the twelve months preceding the claim.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-black mb-3">8. Termination</h2>
            <p>
              We may terminate or suspend your account and access to the Service immediately,
              without prior notice or liability, for any reason, including breach of these
              Terms. Upon termination, your right to use the Service will cease immediately.
              You may export your data prior to termination. After termination, we may delete
              your account data in accordance with our data retention policies, typically
              within 90 days.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-black mb-3">9. Changes to Terms</h2>
            <p>
              We reserve the right to modify or replace these Terms at any time. If a revision
              is material, we will provide at least 30 days notice prior to any new terms
              taking effect. What constitutes a material change will be determined at our sole
              discretion. By continuing to access or use our Service after those revisions
              become effective, you agree to be bound by the revised terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-black mb-3">Contact</h2>
            <p>
              If you have any questions about these Terms, please contact us at{" "}
              <a href="mailto:legal@isibi.ai" className="text-black underline">
                legal@isibi.ai
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

export default TermsPage;
