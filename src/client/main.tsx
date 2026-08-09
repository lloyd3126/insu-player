import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "@/app/App"
import { AppProviders } from "@/app/AppProviders"
import "./styles/globals.css"

const root = document.getElementById("root")

if (!root) {
  throw new Error("INSU Player root element is missing")
}

createRoot(root).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
)
