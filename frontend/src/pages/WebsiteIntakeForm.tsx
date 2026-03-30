import { useState } from "react";

const SECTIONS = [
  {
    title: "Business Information",
    fields: [
      { name: "business_name", label: "Business Name", type: "text", required: true },
      { name: "tagline", label: "Tagline / Slogan", type: "text" },
      { name: "business_description", label: "What does your business do?", type: "textarea", required: true },
      { name: "services", label: "What services do you offer?", type: "textarea", required: true },
      { name: "service_area", label: "Service Area (city, state, nationwide, etc.)", type: "text" },
      { name: "phone", label: "Phone Number", type: "tel" },
      { name: "email", label: "Email Address", type: "email", required: true },
      { name: "address", label: "Business Address", type: "text" },
      { name: "social_media", label: "Social Media Links (Instagram, Facebook, LinkedIn, etc.)", type: "textarea" },
    ],
  },
  {
    title: "Website Goal",
    fields: [
      { name: "main_goal", label: "What's the main goal of your website?", type: "select", options: ["Get more calls", "Generate quotes", "Book appointments", "Capture leads", "Sell products/services", "Other"], required: true },
      { name: "visitor_action", label: "What should visitors do first when they land on your site?", type: "text" },
    ],
  },
  {
    title: "Branding",
    fields: [
      { name: "has_logo", label: "Do you have a logo?", type: "select", options: ["Yes", "No", "Need one designed"] },
      { name: "brand_colors", label: "Brand Colors (e.g. navy blue, gold, white)", type: "text" },
      { name: "preferred_style", label: "Preferred Style", type: "select", options: ["Modern & Clean", "Bold & Colorful", "Minimalist", "Professional & Corporate", "Creative & Artistic", "Luxury & Elegant", "Not sure"] },
      { name: "example_websites", label: "Any websites you like the look of? (paste links)", type: "textarea" },
    ],
  },
  {
    title: "Homepage Content",
    fields: [
      { name: "headline", label: "Main Headline (the first thing people see)", type: "text" },
      { name: "short_description", label: "Short Description of your business (2-3 sentences)", type: "textarea" },
      { name: "top_services", label: "Your Top 3 Services", type: "textarea" },
      { name: "why_choose_us", label: "Why should someone choose your business over competitors?", type: "textarea" },
      { name: "benefits", label: "Key Benefits or Features you offer", type: "textarea" },
      { name: "testimonials", label: "Customer Testimonials or Reviews (paste any you have)", type: "textarea" },
      { name: "faq", label: "Frequently Asked Questions (list common ones)", type: "textarea" },
    ],
  },
  {
    title: "Pages & Structure",
    fields: [
      { name: "pages_needed", label: "What pages do you need?", type: "multiselect", options: ["Home", "About", "Services", "Contact", "Blog", "Portfolio", "Pricing", "FAQ", "Testimonials", "Other"] },
    ],
  },
  {
    title: "Service Details",
    fields: [
      { name: "main_service_name", label: "Your #1 Service Name", type: "text" },
      { name: "service_description", label: "Describe this service", type: "textarea" },
      { name: "who_its_for", label: "Who is this service for?", type: "text" },
      { name: "main_benefit", label: "The main benefit of this service", type: "text" },
      { name: "cta_text", label: "What should the button say? (e.g. 'Get a Free Quote', 'Book Now')", type: "text" },
    ],
  },
  {
    title: "Images & Content",
    fields: [
      { name: "has_photos", label: "Do you have business photos ready to use?", type: "select", options: ["Yes", "No, I need stock images", "Some, but need more"] },
      { name: "need_writing", label: "Do you need us to write the content for you?", type: "select", options: ["Yes, write everything", "I'll provide the text", "Some help needed"] },
    ],
  },
  {
    title: "Trust & Credibility",
    fields: [
      { name: "licenses", label: "Any Licenses or Certifications to display?", type: "text" },
      { name: "awards", label: "Awards or Recognitions?", type: "text" },
      { name: "partnerships", label: "Partnerships or Affiliations?", type: "text" },
      { name: "reviews", label: "Where can we find your reviews? (Google, Yelp, etc.)", type: "text" },
    ],
  },
  {
    title: "Call to Action",
    fields: [
      { name: "main_button_text", label: "What should the main button say?", type: "text", placeholder: "e.g. Get Started, Call Now, Book a Consultation" },
      { name: "click_to_call", label: "Do you want a click-to-call button?", type: "select", options: ["Yes", "No"] },
    ],
  },
  {
    title: "Extra Features",
    fields: [
      { name: "extra_features", label: "Any extra features you want?", type: "multiselect", options: ["Live Chat", "AI Chatbot", "Online Booking", "SMS Notifications", "Email Newsletter", "Blog", "E-commerce/Shop", "Customer Portal", "None"] },
    ],
  },
  {
    title: "Final Notes",
    fields: [
      { name: "unique_selling_point", label: "What makes your business different from everyone else?", type: "textarea" },
      { name: "must_include", label: "Anything specific you want included on the website?", type: "textarea" },
      { name: "must_exclude", label: "Anything you do NOT want on the website?", type: "textarea" },
      { name: "client_name", label: "Your Full Name", type: "text", required: true },
      { name: "client_date", label: "Today's Date", type: "date" },
    ],
  },
];

export function WebsiteIntakeForm() {
  const [formData, setFormData] = useState<Record<string, string | string[]>>({});
  const [currentSection, setCurrentSection] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const updateField = (name: string, value: string | string[]) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const toggleMultiSelect = (name: string, option: string) => {
    const current = (formData[name] as string[]) || [];
    if (current.includes(option)) {
      updateField(name, current.filter((o) => o !== option));
    } else {
      updateField(name, [...current, option]);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError("");
    try {
      const BASE_URL = import.meta.env.VITE_API_URL || "/api";
      const res = await fetch(`${BASE_URL}/intake-form/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Submission failed" }));
        throw new Error(err.detail || "Submission failed");
      }
      setSubmitted(true);
    } catch (e: any) {
      setError(e.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const section = SECTIONS[currentSection];
  const isLast = currentSection === SECTIONS.length - 1;
  const progress = ((currentSection + 1) / SECTIONS.length) * 100;

  if (submitted) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0f172a 0%, #1e1045 50%, #0f172a 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif" }}>
        <div style={{ textAlign: "center", padding: 40, maxWidth: 500 }}>
          <div style={{ width: 80, height: 80, borderRadius: 20, background: "linear-gradient(135deg, #22c55e, #10b981)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px", fontSize: 36 }}>
            &#10003;
          </div>
          <h1 style={{ color: "#f0e6ff", fontSize: 28, fontWeight: 800, marginBottom: 12 }}>Thank You!</h1>
          <p style={{ color: "rgba(240,230,255,.6)", fontSize: 16, lineHeight: 1.6 }}>
            Your website intake form has been submitted successfully. We'll review your information and get back to you soon!
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0f172a 0%, #1e1045 50%, #0f172a 100%)", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ padding: "24px 24px 0", maxWidth: 700, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #ec4899, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 18, color: "white" }}>I</div>
          <div>
            <div style={{ color: "#f0e6ff", fontWeight: 700, fontSize: 18 }}>Website Intake Form</div>
            <div style={{ color: "rgba(240,230,255,.4)", fontSize: 12 }}>Fill out all sections to get started</div>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ color: "rgba(240,230,255,.5)", fontSize: 12, fontWeight: 600 }}>Step {currentSection + 1} of {SECTIONS.length}</span>
            <span style={{ color: "rgba(240,230,255,.5)", fontSize: 12 }}>{Math.round(progress)}%</span>
          </div>
          <div style={{ width: "100%", height: 4, background: "rgba(255,255,255,.08)", borderRadius: 2 }}>
            <div style={{ width: `${progress}%`, height: "100%", background: "linear-gradient(90deg, #ec4899, #8b5cf6)", borderRadius: 2, transition: "width .3s ease" }} />
          </div>
        </div>
      </div>

      {/* Form card */}
      <div style={{ maxWidth: 700, margin: "0 auto", padding: "0 24px 40px" }}>
        <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(236,72,153,.15)", borderRadius: 20, padding: "32px 28px", backdropFilter: "blur(16px)" }}>
          <h2 style={{ color: "#f0e6ff", fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{section.title}</h2>
          <div style={{ width: 40, height: 3, background: "linear-gradient(90deg, #ec4899, #8b5cf6)", borderRadius: 2, marginBottom: 28 }} />

          {section.fields.map((field) => (
            <div key={field.name} style={{ marginBottom: 22 }}>
              <label style={{ display: "block", color: "rgba(240,230,255,.7)", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                {field.label} {field.required && <span style={{ color: "#ec4899" }}>*</span>}
              </label>

              {field.type === "textarea" ? (
                <textarea
                  value={(formData[field.name] as string) || ""}
                  onChange={(e) => updateField(field.name, e.target.value)}
                  placeholder={field.placeholder || "Type your answer..."}
                  rows={3}
                  style={{
                    width: "100%", padding: "12px 14px", background: "rgba(255,255,255,.03)",
                    border: "1px solid rgba(236,72,153,.15)", borderRadius: 10, color: "#f0e6ff",
                    fontSize: 14, outline: "none", resize: "vertical", fontFamily: "inherit",
                  }}
                />
              ) : field.type === "select" ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {field.options?.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => updateField(field.name, option)}
                      style={{
                        padding: "8px 16px", borderRadius: 8, border: "1px solid",
                        borderColor: formData[field.name] === option ? "#ec4899" : "rgba(255,255,255,.1)",
                        background: formData[field.name] === option ? "rgba(236,72,153,.15)" : "rgba(255,255,255,.03)",
                        color: formData[field.name] === option ? "#ec4899" : "rgba(240,230,255,.6)",
                        fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
                        transition: "all .15s",
                      }}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ) : field.type === "multiselect" ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {field.options?.map((option) => {
                    const selected = ((formData[field.name] as string[]) || []).includes(option);
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => toggleMultiSelect(field.name, option)}
                        style={{
                          padding: "8px 16px", borderRadius: 8, border: "1px solid",
                          borderColor: selected ? "#8b5cf6" : "rgba(255,255,255,.1)",
                          background: selected ? "rgba(139,92,246,.15)" : "rgba(255,255,255,.03)",
                          color: selected ? "#8b5cf6" : "rgba(240,230,255,.6)",
                          fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
                        }}
                      >
                        {selected ? "\u2713 " : ""}{option}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <input
                  type={field.type || "text"}
                  value={(formData[field.name] as string) || ""}
                  onChange={(e) => updateField(field.name, e.target.value)}
                  placeholder={field.placeholder || ""}
                  style={{
                    width: "100%", padding: "12px 14px", background: "rgba(255,255,255,.03)",
                    border: "1px solid rgba(236,72,153,.15)", borderRadius: 10, color: "#f0e6ff",
                    fontSize: 14, outline: "none", fontFamily: "inherit",
                  }}
                />
              )}
            </div>
          ))}

          {error && (
            <div style={{ background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", borderRadius: 10, padding: "10px 14px", color: "#ef4444", fontSize: 13, marginBottom: 16 }}>
              {error}
            </div>
          )}

          {/* Navigation */}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 24 }}>
            <button
              onClick={() => setCurrentSection((p) => Math.max(0, p - 1))}
              disabled={currentSection === 0}
              style={{
                padding: "10px 24px", borderRadius: 10, border: "1px solid rgba(255,255,255,.1)",
                background: "transparent", color: "rgba(240,230,255,.5)", fontSize: 14,
                fontWeight: 600, cursor: currentSection === 0 ? "not-allowed" : "pointer",
                opacity: currentSection === 0 ? 0.3 : 1, fontFamily: "inherit",
              }}
            >
              Back
            </button>

            {isLast ? (
              <button
                onClick={handleSubmit}
                disabled={submitting}
                style={{
                  padding: "12px 32px", borderRadius: 10, border: "none",
                  background: "linear-gradient(135deg, #ec4899, #8b5cf6)", color: "white",
                  fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  boxShadow: "0 0 20px rgba(236,72,153,.25)", opacity: submitting ? 0.6 : 1,
                }}
              >
                {submitting ? "Submitting..." : "Submit Form"}
              </button>
            ) : (
              <button
                onClick={() => setCurrentSection((p) => Math.min(SECTIONS.length - 1, p + 1))}
                style={{
                  padding: "12px 32px", borderRadius: 10, border: "none",
                  background: "linear-gradient(135deg, #ec4899, #8b5cf6)", color: "white",
                  fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  boxShadow: "0 0 20px rgba(236,72,153,.25)",
                }}
              >
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
