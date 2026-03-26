export function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold text-black mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-500 mb-10">Last updated: March 2026</p>

        <div className="space-y-8 text-gray-800 leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-black mb-3">1. Information We Collect</h2>
            <p>
              We collect information you provide directly to us, including your name, email
              address, organization name, and payment information when you register for an
              account or subscribe to a paid plan. We also automatically collect certain
              information when you use the Service, including your IP address, browser type,
              operating system, referring URLs, pages visited, and timestamps of interactions.
              When you use our AI-powered generation features, we collect the prompts,
              specifications, and feedback you provide to generate and refine applications.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-black mb-3">2. How We Use Your Information</h2>
            <p>
              We use the information we collect to provide, maintain, and improve the Service;
              process transactions and send related information; send technical notices, updates,
              security alerts, and administrative messages; respond to your comments, questions,
              and customer service requests; monitor and analyze trends, usage, and activities
              in connection with the Service; and develop new features and services. We may use
              anonymized and aggregated data to train and improve our AI models, but we will
              never use your identifiable data or proprietary application logic for this purpose
              without your explicit consent.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-black mb-3">3. Data Storage and Retention</h2>
            <p>
              Your data is stored on secure servers provided by our infrastructure partners.
              We use industry-standard encryption for data at rest and in transit. Application
              data generated through the Service is stored in isolated database schemas to
              prevent cross-contamination between users. We retain your personal data for as
              long as your account is active or as needed to provide the Service. Upon account
              deletion, we will remove your personal data within 90 days, except where
              retention is required by law or for legitimate business purposes such as fraud
              prevention.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-black mb-3">4. Third-Party Services</h2>
            <p>
              We may share your information with third-party service providers who perform
              services on our behalf, including payment processing (Stripe), email delivery
              (Resend), cloud infrastructure (AWS, Render), and analytics. These service
              providers are contractually obligated to use your information only as necessary
              to provide services to us and are required to maintain the confidentiality and
              security of your information. We do not sell your personal information to third
              parties.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-black mb-3">5. Cookies and Tracking</h2>
            <p>
              We use cookies and similar tracking technologies to collect and track information
              about your use of the Service. Cookies are small data files stored on your device
              that help us improve the Service and your experience. We use essential cookies for
              authentication and session management, and optional analytics cookies to
              understand how the Service is used. You can instruct your browser to refuse all
              cookies or indicate when a cookie is being sent; however, some features of the
              Service may not function properly without cookies.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-black mb-3">6. Your Rights</h2>
            <p>
              Depending on your location, you may have certain rights regarding your personal
              information, including the right to access, correct, or delete your personal data;
              the right to data portability; the right to restrict or object to processing; and
              the right to withdraw consent. If you are a resident of the European Economic
              Area, you have the right to lodge a complaint with a supervisory authority.
              California residents have additional rights under the CCPA, including the right
              to know what personal information is collected and the right to opt out of the
              sale of personal information. To exercise any of these rights, please contact us
              at privacy@isibi.ai.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-black mb-3">7. Security</h2>
            <p>
              We take reasonable measures to help protect your personal information from loss,
              theft, misuse, unauthorized access, disclosure, alteration, and destruction. We
              implement industry-standard security practices including TLS encryption,
              bcrypt password hashing, role-based access controls, and regular security
              audits. However, no method of transmission over the Internet or method of
              electronic storage is completely secure, and we cannot guarantee absolute
              security.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-black mb-3">8. Children's Privacy</h2>
            <p>
              The Service is not directed to individuals under the age of 18. We do not
              knowingly collect personal information from children under 18. If we become aware
              that a child under 18 has provided us with personal information, we will take
              steps to delete such information. If you are a parent or guardian and believe
              your child has provided us with personal information, please contact us at
              privacy@isibi.ai.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-black mb-3">9. Contact Us</h2>
            <p>
              If you have any questions about this Privacy Policy or our data practices,
              please contact us at{" "}
              <a href="mailto:privacy@isibi.ai" className="text-black underline">
                privacy@isibi.ai
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

export default PrivacyPage;
