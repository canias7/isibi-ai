import { useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LandingPage } from "@/pages/LandingPage";
import { LoginPage } from "@/pages/LoginPage";
import { SignupPage } from "@/pages/SignupPage";
import { VerifyEmailPage } from "@/pages/VerifyEmailPage";
import { OnboardingPage } from "@/pages/OnboardingPage";
import { useAuthStore } from "@/stores/authStore";

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
  const [verifyEmail, setVerifyEmail] = useState<string | null>(null);

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
      {/* Landing page — always accessible at root */}
      <Route path="/" element={<LandingPage />} />

      {/* Auth routes — redirect to /app if already logged in */}
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

      {/* Protected app routes */}
      <Route
        path="/app/*"
        element={
          <ProtectedRoute>
            <OnboardingPage onSpecCreated={() => {}} />
          </ProtectedRoute>
        }
      />

      {/* Catch-all → landing page */}
      <Route path="*" element={<Navigate to="/" replace />} />
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
