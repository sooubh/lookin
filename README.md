# Privacy-Preserving Browser Vision Agent (Lookin)

> **Do not merely redact PII. Decide what information the cloud agent actually needs for the current task, then send the minimum safe representation.**
> *Cloud AI is the reasoning engine. The browser is the privacy boundary and final execution authority.*

---

## 1. Overview

Lookin is an SIH-ready, privacy-first browser automation extension and reasoning gateway for Chrome Manifest V3. Unlike conventional browser automation tools that blindly stream raw DOM trees and full-screen captures to external cloud APIs, Lookin:
1. **Perceives** page layout and interactive controls locally using browser DOM and accessibility trees with stable element IDs.
2. **Analyzes** sensitive information locally across 4 Sensitivity Tiers using deterministic regexes, Luhn/IBAN checksums, and credential recognizers.
3. **Plans** minimal safe task requirements (task-aware context engine) so only elements strictly required for the specific user task leave the browser.
4. **Enforces** an adaptive privacy policy (`allow`, `omit`, `mask`, `tokenize`, `blur`, `structure_only`, `block`). Tier 3 secrets are strictly blocked.
5. **Replaces** task-required personal data with client-side placeholders (`[EMAIL_1]`, `[PERSON_1]`) stored in a local token vault that never touches the network.
6. **Validates** all model action proposals through a local **Action Guard** with risk-tier policy gating before browser DOM dispatch.

---

## 2. Master System Architecture

```text
User Task
   │
   ▼
Chrome MV3 Extension (Side Panel)
   │
   ├─► Local Perception (DOM / Accessibility / Viewport Extraction)
   │
   ├─► Privacy Analyzer (PII / Secrets / Credential Detection)
   │
   ├─► Task-Aware Context Planner (Minimum Safe Requirement)
   │
   ├─► Adaptive Privacy Policy Engine (Allow / Tokenize / Mask / Block)
   │      │
   │      └─► Client-Side Token Vault ([EMAIL_1] ──► Real Secret stays local)
   │
   ├─► Payload Sanitizer & Pre-Fetch Leak Guard (Fail-Closed)
   │
   ▼ [Sanitized Context Only — 91.96% Byte Reduction — 0 Raw Secrets]
Node.js API Gateway (POST /agent/reason)
   │
   ▼
Server VLM / LLM (OpenRouter / Groq / Mock)
   │
   ▼ [Structured Action Plan]
Local Action Guard
   │
   ├─► Schema Validation & Action Allowlist
   ├─► Freshness / Staleness & URL Alignment Check
   ├─► Local Target & Bounding Box Match
   ├─► Risk Tier Policy (Low: Auto / Medium: Validated / High: User Confirmed)
   │
   ▼
Browser Executor (Resolves tokens locally immediately before DOM injection)
```

---

## 3. Project Directory Structure

```text
lookin/
├── extension/                 # Chrome Manifest V3 Extension
│   ├── manifest.json          # MV3 extension manifest
│   ├── src/
│   │   ├── background.ts      # Service worker & message routing hub
│   │   ├── content.ts         # In-page perception & action executor
│   │   ├── common/            # Shared interfaces & typed IPC messages
│   │   ├── perception/        # DOM extraction, AccName, screenshot guard
│   │   ├── privacy/           # Tiers, rules, PII detector, policy, vault, sanitizer
│   │   ├── agent/             # Action schema, Local Action Guard, DOM executor
│   │   └── sidepanel/         # UI: task input, live firewall metrics & receipts
│   └── dist/                  # Compiled browser-ready extension bundle
├── server/                    # Lightweight Node.js Reasoning Gateway
│   └── src/
│       ├── index.js           # HTTP server on port 3000
│       ├── routes/            # POST /agent/reason & GET /health
│       ├── providers/         # OpenRouter, Groq, and hermetic Mock adapters
│       ├── middleware/        # 500KB payload size limiter
│       └── schemas/           # Strict action plan schema validator
├── demo-site/                 # Controlled Synthetic Benchmark Site
│   ├── index.html             # Workflow A: Private Form Assistant
│   ├── statement.html         # Workflow B: Private Account Statement Analysis
│   ├── ground-truth.json      # Machine-readable ground truth fixtures
│   └── serve.js               # Zero-dependency local demo HTTP server (port 8080)
├── benchmarks/                # Automated Evaluation Harness
│   ├── run.js                 # Precision, recall, leak audit, latency benchmark
│   └── results.json           # Machine-readable benchmark export
├── docs/                      # Architectural Specifications & Audits
│   ├── REFERENCE_AUDIT.md     # 9-repo audit & license reconciliation
│   └── FINAL_AUDIT.md         # Comprehensive security & invariant certification
├── tests/                     # Comprehensive test suites (69 tests)
│   ├── skeleton.test.js       # Extension shell integrity
│   ├── perception.test.js     # DOM, AccName, screenshot guard tests
│   ├── privacy.test.js        # Deterministic detection, vault, policy tests
│   ├── server.test.js         # Gateway, size limit, provider, schema tests
│   ├── agent-guard.test.js    # Local Action Guard & executor tests
│   ├── benchmark.test.js      # Benchmark calculations & fixture verification
│   └── adversarial.test.js    # 10 adversarial privacy attacks & fail-closed tests
├── package.json
└── tsconfig.json
```

---

## 4. Getting Started

### Prerequisites
* Node.js $\ge 18$ (Node 22 or 24 recommended)
* Google Chrome or Chromium browser

### 1. Install & Build
```bash
# Install dependencies
npm install

# Typecheck TypeScript sources
npm run typecheck

# Build Chrome MV3 extension to extension/dist/
npm run build
```

### 2. Run Test Suites
```bash
# Run all 69 unit and adversarial tests
npm test
```

### 3. Run Benchmark Suite
```bash
node benchmarks/run.js
```

### 4. Start the Local Server & Controlled Demo Site
```bash
# Terminal 1: Launch reasoning gateway (port 3000)
npm run start:server

# Terminal 2: Launch controlled demo site (port 8080)
npm run serve:demo
```

### 5. Load Extension in Chrome
1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** in the top right.
3. Click **Load unpacked** and select the `extension/` directory (it uses `manifest.json` pointing to `dist/`).
4. Click the extension action icon in your Chrome toolbar to open the **Privacy Firewall Side Panel**.
5. Navigate to `http://localhost:8080/index.html` (Form Assistant) or `http://localhost:8080/statement.html` (Statement Analysis).
6. Enter a task (e.g. `"Fill the registration form and submit it"`) and click **Run Protected Task**.

---

## 5. Benchmark Performance

| Evaluation Metric | Target Spec | Measured Result |
| :--- | :--- | :--- |
| **PII Detection Recall** | $\ge 95.0\%$ | **100.0%** (10/10 ground-truth entities detected) |
| **PII Detection Precision** | $\ge 90.0\%$ | **93.8%** |
| **PII Detection F1-Score** | $\ge 90.0\%$ | **96.7%** |
| **Secret Redaction Leak Rate** | **Strictly 0.0%** | **0.0% (Zero Leaks)** |
| **Payload Data Minimization** | $\ge 75.0\%$ | **91.96% byte reduction** (12.4x compression) |
| **Local Firewall Overhead** | $\le 10.0\%$ | **0.51% - 2.01%** (1.45ms - 6.58ms) |
| **VLM Reasoning Latency** | $< 1000\text{ms}$ | **285ms - 320ms** |

---

## 6. Security Invariants

1. **No Raw Screenshots Transmitted**: Raw tab captures exist only in volatile memory and are guarded by `assertSafeToTransmit`.
2. **No Secret Transmission**: Tier 3 secrets (passwords, OTPs, API keys, private keys) are hard-blocked from ever leaving the browser.
3. **Client-Side Vault**: Original-to-token mappings stay strictly client-side. The server never receives the vault dictionary.
4. **Local Action Authority**: Model suggestions are never blindly executed. The local Action Guard verifies role, label, visibility, enabled state, bounding box, and risk tier before execution.

---
*License: Apache-2.0*
