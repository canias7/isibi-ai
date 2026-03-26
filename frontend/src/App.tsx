import { useEffect, useState } from "react";
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

function AuthRouter() {
  const navigate = useNavigate();
  const [verifyEmail, setVerifyEmail] = useState<string | null>(null);

  if (verifyEmail) {
    return (
      <VerifyEmailPage
        email={verifyEmail}
        onVerified={() => {
          setVerifyEmail(null);
          navigate("/");
          window.location.reload();
        }}
      />
    );
  }

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route
        path="/signup"
        element={
          <SignupPage onSignup={(email) => setVerifyEmail(email)} />
        }
      />
      <Route
        path="/login"
        element={
          <LoginPage
            onLogin={() => {
              navigate("/");
              window.location.reload();
            }}
            onNeedVerify={(email) => setVerifyEmail(email)}
          />
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function AppRouter() {
  const attemptLoad = () => {
    // placeholder for spec loading
  };

  return (
    <Routes>
      <Route path="*" element={<OnboardingPage onSpecCreated={attemptLoad} />} />
    </Routes>
  );
}

export default function App() {
  const { isAuthenticated } = useAuthStore();

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {isAuthenticated ? <AppRouter /> : <AuthRouter />}
      </BrowserRouter>
    </QueryClientProvider>
  );
}
