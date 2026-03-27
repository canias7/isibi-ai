import { lazy, Suspense, useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/authStore";
import { useThemeStore } from "@/stores/themeStore";

// Lazy-loaded page components
const LandingPage = lazy(() => import("@/pages/LandingPage").then(m => ({ default: m.LandingPage })));
const LoginPage = lazy(() => import("@/pages/LoginPage").then(m => ({ default: m.LoginPage })));
const SignupPage = lazy(() => import("@/pages/SignupPage").then(m => ({ default: m.SignupPage })));
const VerifyEmailPage = lazy(() => import("@/pages/VerifyEmailPage").then(m => ({ default: m.VerifyEmailPage })));
const OnboardingPage = lazy(() => import("@/pages/OnboardingPage").then(m => ({ default: m.OnboardingPage })));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage").then(m => ({ default: m.NotFoundPage })));
const TermsPage = lazy(() => import("@/pages/TermsPage").then(m => ({ default: m.TermsPage })));
const PrivacyPage = lazy(() => import("@/pages/PrivacyPage").then(m => ({ default: m.PrivacyPage })));
const BuildCrmPage = lazy(() => import("@/pages/seo/BuildCrmPage").then(m => ({ default: m.BuildCrmPage })));
const BuildEcommercePage = lazy(() => import("@/pages/seo/BuildEcommercePage").then(m => ({ default: m.BuildEcommercePage })));
const BuildRestaurantPage = lazy(() => import("@/pages/seo/BuildRestaurantPage").then(m => ({ default: m.BuildRestaurantPage })));
const BuildGymPage = lazy(() => import("@/pages/seo/BuildGymPage").then(m => ({ default: m.BuildGymPage })));
const MarketplacePage = lazy(() => import("@/pages/MarketplacePage").then(m => ({ default: m.MarketplacePage })));
const ComingSoonPage = lazy(() => import("@/pages/ComingSoonPage").then(m => ({ default: m.ComingSoonPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthStore();
  const { theme } = useThemeStore();
  const [verifyEmail, setVerifyEmail] = useState<string | null>(null);

  // Sync dark mode class on mount
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  if (verifyEmail) {
    return (
      <VerifyEmailPage
        email={verifyEmail}
        onVerified={() => {
          setVerifyEmail(null);
          navigate("/app");
        }}
      />
    );
  }

  return (
    <Routes>
      {/* Landing page */}
      <Route path="/" element={<LandingPage />} />

      {/* Auth */}
      <Route
        path="/signup"
        element={
          isAuthenticated ? (
            <Navigate to="/app" replace />
          ) : (
            <SignupPage onSignup={(email) => setVerifyEmail(email)} />
          )
        }
      />
      <Route
        path="/login"
        element={
          isAuthenticated ? (
            <Navigate to="/app" replace />
          ) : (
            <LoginPage
              onLogin={() => navigate("/app")}
              onNeedVerify={(email) => setVerifyEmail(email)}
            />
          )
        }
      />

      {/* Protected app */}
      <Route
        path="/app/*"
        element={
          <ProtectedRoute>
            <OnboardingPage onSpecCreated={() => {}} />
          </ProtectedRoute>
        }
      />

      {/* Legal */}
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/security" element={<ComingSoonPage title="Security" />} />

      {/* Marketplace & public pages */}
      <Route path="/marketplace" element={<MarketplacePage />} />
      <Route path="/templates" element={<ComingSoonPage title="Templates" />} />
      <Route path="/about" element={<ComingSoonPage title="About" />} />
      <Route path="/blog" element={<ComingSoonPage title="Blog" />} />
      <Route path="/careers" element={<ComingSoonPage title="Careers" />} />
      <Route path="/contact" element={<ComingSoonPage title="Contact" />} />

      {/* SEO landing pages */}
      <Route path="/build-crm" element={<BuildCrmPage />} />
      <Route path="/build-ecommerce" element={<BuildEcommercePage />} />
      <Route path="/build-restaurant-software" element={<BuildRestaurantPage />} />
      <Route path="/build-gym-software" element={<BuildGymPage />} />

      {/* Catch-all */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<div className="flex h-screen items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-pink-500 border-t-transparent" /></div>}>
          <AppRoutes />
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
