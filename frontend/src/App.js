import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "./components/ui/sonner";
import { AuthProvider } from "./lib/auth";
import ProtectedRoute from "./components/ProtectedRoute";
import AppShell from "./components/AppShell";
import AuthCallback from "./components/AuthCallback";
import Login from "./pages/Login";
import Onboarding from "./pages/Onboarding";
import Today from "./pages/Today";
import ActiveWorkout from "./pages/ActiveWorkout";
import Exercises from "./pages/Exercises";
import ExerciseDetail from "./pages/ExerciseDetail";
import Progress from "./pages/Progress";
import Insights from "./pages/Insights";
import Settings from "./pages/Settings";

function AppRouter() {
  const location = useLocation();
  // Synchronous check for OAuth return
  if (location.hash?.includes("session_id=")) {
    return <AuthCallback />;
  }
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
      <Route path="/settings" element={<ProtectedRoute><AppShell><Settings /></AppShell></ProtectedRoute>} />
      <Route path="/" element={<Navigate to="/today" replace />} />
      <Route path="*" element={<Navigate to="/today" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRouter />
        <Toaster position="top-center" />
      </BrowserRouter>
    </AuthProvider>
  );
}
