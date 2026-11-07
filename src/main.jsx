import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// called by index.html 
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);