import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// JSX typings for the vscode-elements tags rendered by this app.
import type {} from "vscode-workbench/elements/types";
import type {} from "./vscode-elements.d.ts";

// Register exactly the custom-element tags the app renders. Per-tag entries
// only - never `elements/all` in a selective consumer.
import "vscode-workbench/elements/icon";
import "vscode-workbench/elements/tree";
import "vscode-workbench/elements/button";
import "vscode-workbench/elements/collapsible";

// Form tags rendered by the app that the kit does not wrap: register them
// directly from the @vscode-elements peer package.
import "@vscode-elements/elements/dist/vscode-single-select/index.js";
import "@vscode-elements/elements/dist/vscode-option/index.js";
import "@vscode-elements/elements/dist/vscode-form-container/index.js";
import "@vscode-elements/elements/dist/vscode-form-group/index.js";
import "@vscode-elements/elements/dist/vscode-label/index.js";
import "@vscode-elements/elements/dist/vscode-form-helper/index.js";

// Base styles first, then only the component stylesheets this app renders.
import "vscode-workbench/styles/tokens.css";
import "vscode-workbench/styles/global.css";
import "vscode-workbench/styles/shell.css";
import "vscode-workbench/styles/title-bar.css";
import "vscode-workbench/styles/resizable-pane.css";
import "vscode-workbench/styles/sidebar.css";
import "vscode-workbench/styles/status-bar.css";
import "vscode-workbench/styles/icon-button.css";

import "./app.css";

import { App } from "./App.tsx";

const container = document.getElementById("root");
if (!container) throw new Error("missing #root element");
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
