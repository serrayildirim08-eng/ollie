import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "./theme";
import { Router } from "./navigation";
import { AuthProvider, SignInScreen, useAuth } from "./auth";

function Gate() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Router /> : <SignInScreen />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
