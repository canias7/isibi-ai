import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LandingPage } from "@/pages/LandingPage";
import { LoginPage } from "@/pages/LoginPage";
import { SignupPage } from "@/pages/SignupPage";
import { VerifyEmailPage } from "@/pages/VerifyEmailPage";
import { OnboardingPage } from "@/pages/OnboardingPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { TermsPage } from "@/pages/TermsPage";
import { PrivacyPage } from "@/pages/PrivacyPage";
import { BuildCrmPage } from "@/pages/seo/BuildCrmPage";
import { BuildEcommercePage } from "@/pages/seo/BuildEcommercePage";
import { BuildRestaurantPage } from "@/pages/seo/BuildRestaurantPage";
import { BuildGymPage } from "@/pages/seo/BuildGymPage";
import { useAuthStore } from "@/stores/authStore";
import { useThemeStore } from "@/stores/themeStore";

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
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
