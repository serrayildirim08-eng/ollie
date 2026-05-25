import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "./theme";
import { Router } from "./navigation";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <Router />
    </ThemeProvider>
  </React.StrictMode>,
);
