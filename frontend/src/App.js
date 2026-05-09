import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "./components/ui/sonner";
import { AuthProvider } from "./lib/auth";
import ProtectedRoute from "./components/ProtectedRoute";
import AppShell from "./components/AppShell";
import AuthCallback from "./components/AuthCallback";
import ErrorBoundary from "./components/ErrorBoundary";
import InstallPrompt from "./components/InstallPrompt";
import OfflineBadge from "./components/OfflineBadge";
import Login from "./pages/Login";
import Onboarding from "./pages/Onboarding";
import Today from "./pages/Today";
import ActiveWorkout from "./pages/ActiveWorkout";
import Exercises from "./pages/Exercises";
import ExerciseDetail from "./pages/ExerciseDetail";
import Progress from "./pages/Progress";
import Insights from "./pages/Insights";
import Settings from "./pages/Settings";
import Mesocycle from "./pages/Mesocycle";

function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/onboarding" element={<ProtectedRoute requireOnboarded={false}><Onboarding /></ProtectedRoute>} />
      <Route path="/today" element={<ProtectedRoute><AppShell><Today /></AppShell></ProtectedRoute>} />
      <Route path="/workout/:workoutId" element={<ProtectedRoute><ActiveWorkout /></ProtectedRoute>} />
      <Route path="/exercises" element={<ProtectedRoute><AppShell><Exercises /></AppShell></ProtectedRoute>} />
      <Route path="/exercises/:id" element={<ProtectedRoute><AppShell><ExerciseDetail /></AppShell></ProtectedRoute>} />
      <Route path="/progress" element={<ProtectedRoute><AppShell><Progress /></AppShell></ProtectedRoute>} />
      <Route path="/insights" element={<ProtectedRoute><AppShell><Insights /></AppShell></ProtectedRoute>} />
      <Route path="/mesocycle" element={<ProtectedRoute><AppShell><Mesocycle /></AppShell></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><AppShell><Settings /></AppShell></ProtectedRoute>} />
      <Route path="/" element={<Navigate to="/today" replace />} />
      <Route path="*" element={<Navigate to="/today" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-primary focus:text-primary-foreground focus:px-3 focus:py-2 focus:rounded">Skip to content</a>
          <div id="main-content">
            <AppRouter />
          </div>
          <InstallPrompt />
          <OfflineBadge />
          <Toaster position="top-center" />
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}
