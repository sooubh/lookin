# Comprehensive Implementation Audit Report: Lookin — Privacy-Preserving Browser Vision Agent

**Audit Date:** September 2026  
**Auditor:** Antigravity Autonomous Security & Architecture Review  
**Target Repository:** Lookin (`privacy-browser-agent`)  
**Scope:** Complete repository inspection (`extension/`, `server/`, `demo-site/`, `benchmarks/`, `tests/`, `docs/`, configuration)

---

## 1. Executive Summary & Reality Check

The **Lookin** project aims to build a privacy-preserving browser automation agent under Chrome Manifest V3. The overarching principle is:
> *"Do not merely redact PII. Determine what information the cloud reasoning model actually needs for the current task, then send the minimum safe representation."*

While the project possesses a sophisticated deterministic privacy firewall, strict schema validation, and 70 passing Node.js unit tests, **the README claims significantly overstate the live, real-world capabilities and benchmark authenticity**:

1. **Benchmark Results Are Synthetic & Hardcoded:** The published metrics in `README.md` and `docs/FINAL_AUDIT.md` (e.g., *VLM Latency 285ms–320ms*, *Firewall Overhead 0.51%–2.01%*, *100% PII Recall*) do not derive from live browser telemetry or real VLM runs. They are produced by `benchmarks/run.js` using a standalone simulator function (`simulatePrivacyDetector`) and hardcoded latency numbers (`320.0ms`, `285.0ms`, `0.85ms`).
2. **Vision / Screenshot Redaction is Incomplete:** Despite being titled a "Browser Vision Agent", **no canvas-based screenshot capture or image redaction is performed in the extension**. The sidepanel hardcodes `sanitizedImage: null`. Raw screenshot transmission is indeed blocked (satisfying the safety invariant), but multimodal reasoning over sanitized screenshots does not actually execute.
3. **Execution Loop is Single-Step Only:** The sidepanel orchestrator only extracts the very first action (`actions[0]`) from the returned action plan and terminates. There is no multi-step autonomous execution loop.
4. **Perception ID Execution Bug:** `BrowserExecutor.findDomElement()` attempts `doc.getElementById(matchedId)` where `matchedId` is a synthetic perception ID (e.g., `"e1"`), which fails against real DOM elements whose HTML `id` is descriptive (e.g., `"full-name"`), unless saved in `ElementRegistry`. The helper `getElementByPerceptionId` was written in `dom.ts` but never imported or called in `executor.ts`. This was masked in tests because tests mocked `document.getElementById` to return any requested ID.

---

## 2. Current Architecture

```text
                                 CHROME MV3 BROWSER EXTENSION
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                             │
│  Side Panel UI (`sidepanel/app.ts`)                                                         │
│    │                                                                                        │
│    ├── 1. Requests Perception via IPC ──────────► Content Script (`content.ts`)             │
│    │                                                │                                       │
│    │                                                ├─► DOM Extraction (`dom.ts`)           │
│    │                                                ├─► AccName Engine (`accessibility.ts`) │
│    │                                                └─► Stable ElementRegistry (`e1`, `e2`) │
│    │                                                                                        │
│    ├── 2. Receives `PagePerception`                                                         │
│    ├── 3. Task Context Planning (`task-context.ts`) ── [Determines minimum required fields] │
│    ├── 4. Deterministic PII & Secret Scan (`pii-detector.ts`, `rules.ts`)                   │
│    ├── 5. Policy Engine Decision (`policy-engine.ts`) ── [Allow / Tokenize / Mask / Block] │
│    ├── 6. Local Token Vault (`privacy/token-vault.ts`) ── [Stores secret -> [TOKEN_1]]      │
│    ├── 7. Element Redaction (`redactor.ts`)                                                 │
│    ├── 8. Pre-Fetch Leak Guard (`payload-sanitizer.ts`) ── [assertSafeToTransmit: FAIL-CLOSE]│
│    │                                                                                        │
│    ▼ [Sanitized Context Only — No Raw Secrets — No Token Vault Mappings]                   │
└────┼────────────────────────────────────────────────────────────────────────────────────────┘
     │ HTTP POST /agent/reason (Port 3000)
     ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ NODE.JS REASONING GATEWAY (`server/src/index.js`)                                           │
│    │                                                                                        │
│    ├── Middleware: Size Limit (500KB max, rejects oversized bodies)                         │
│    ├── Route Handler (`routes/agent.js`):                                                   │
│    │     ├─► Inbound Sanitized Payload Validator (Strictly rejects tokenVault / secrets)     │
│    │     ├─► Provider Adapter (`mock`, `openrouter`, `groq`)                                │
│    │     └─► Outbound Action Plan Schema Validator (Blocks eval, scripts, unknown actions)  │
│    │                                                                                        │
│    ▼ Returns `{ actions: [...] }`                                                           │
└────┼────────────────────────────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ LOCAL ACTION GUARD & EXECUTOR (`extension/src/agent/`)                                      │
│    │                                                                                        │
│    ├── Action Guard (`action-guard.ts`):                                                    │
│    │     ├─► Staleness check (< 30s)                                                        │
│    │     ├─► URL alignment check                                                            │
│    │     ├─► Viewport boundary check                                                        │
│    │     ├─► Target verification (role, enabled, visible)                                   │
│    │     └─► Risk Tier gating (low: auto, high: user confirmation modal)                    │
│    │                                                                                        │
│    └── Browser Executor (`executor.ts` in Content Script):                                  │
│          ├─► Receives vetted action + token mappings from side panel                        │
│          ├─► Resolves token placeholders locally immediately before typing                  │
│          └─► Dispatches DOM events (`input`, `change`, `click`)                             │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Component Audit

### 3.1 Extension Manifest & Configuration
* **Status:** Working (with build caveat).
* **Manifest Validity:** `extension/manifest.json` is a valid Chrome Manifest V3 configuration. Uses permissions: `activeTab`, `sidePanel`, `storage`, `tabs`, `scripting`.
* **Issue:** `extension/manifest.json` specifies `"dist/background.js"`, `"dist/content.js"`, and `"dist/sidepanel/index.html"`. `build.js` copies this file into `extension/dist/manifest.json`. If a user selects `extension/dist` when loading unpacked, paths become invalid (`dist/dist/...`). Loading `extension/` works as documented.

### 3.2 Service Worker (`extension/src/background.ts`)
* **Status:** Partially Working / Buggy error handling.
* **Functionality:** Correctly sets `openPanelOnActionClick: true` for the side panel. Routes `GET_PAGE_METADATA`, `RUN_PERCEPTION`, and `EXECUTE_ACTION` to the active tab.
* **Defect:** In message handling, if `!activeTab?.id` or `chrome.runtime.lastError` occurs during an `EXECUTE_ACTION` request, the background worker sends a `PERCEPTION_RESPONSE` instead of an action error response (lines 43–54 and 71–82).

### 3.3 Content Script (`extension/src/content.ts`)
* **Status:** Working.
* **Functionality:** Handles `GET_PAGE_METADATA`, `RUN_PERCEPTION`, `EXECUTE_ACTION`, and `PING`. Invokes `fusePerception` and `BrowserExecutor`.

### 3.4 Side Panel UI & App (`extension/src/sidepanel/`)
* **Status:** Partially Working.
* **Functionality:** Displays connection status, active tab metadata, firewall metrics (PII detected, blocked, tokenized, allowed, payload size), user confirmation dialog for high-risk actions, and status updates.
* **Deficiencies:**
  1. Hardcoded gateway endpoint: `http://127.0.0.1:3000/agent/reason`. No settings or options page to configure the gateway URL, provider, or model.
  2. Single-action limitation: lines 248–251 only handle `actions[0]`. If a workflow requires 4 inputs and a button click, only the first action executes.
  3. Image transmission: sets `sanitizedImage: null`. Visual features are dormant.

### 3.5 Perception Engine (`extension/src/perception/`)
* **DOM Extraction (`dom.ts`):** Implemented. Correctly queries interactive and semantic elements, skips ignored tags, evaluates visibility, checks enabled state, and computes bounding boxes.
* **Accessibility Name Computation (`accessibility.ts`):** Implemented. Adheres to W3C AccName: checks `aria-labelledby`, `aria-label`, `<label for>`, enclosing labels, button/input values, alt text, text content, placeholders, and titles.
* **Element Registry (`dom.ts`):** Implemented using `WeakMap` and sequential IDs (`e1`, `e2`, ...). Stable across queries on the same DOM objects.
* **Screenshot Module (`screenshot.ts`):** **STUBBED**. Provides types, `createInMemoryScreenshot`, `captureVisibleTab`, and security assertion `assertSafeToTransmit`. However, no bounding-box canvas redaction or image generation exists.

### 3.6 Privacy Firewall (`extension/src/privacy/`)
* **Categories & Tiers (`categories.ts`):** Implemented. 4 tiers (0: Public, 1: Personal, 2: Sensitive, 3: Secret).
* **Deterministic Rules (`rules.ts`):** Implemented. Contains regexes and checksum validators:
  - `validateLuhn`: Implemented & verified for credit cards (MOD 10).
  - `validateIBAN`: Implemented & verified for IBAN (ISO 7064 MOD 97-10).
  - `validateSSN`: Implemented & verified for US SSN structure.
  - Secret recognizers: AWS keys, GitHub tokens, Stripe keys, generic API tokens, JWTs, PEM private keys, OTPs, passwords.
* **PII Detector (`pii-detector.ts`):** Implemented. Scans raw text and DOM attributes (`type="password"`, `autocomplete`, name/id/placeholder keywords).
* **Policy Engine (`policy-engine.ts`):** Implemented. Enforces invariants: Tier 3 secrets are strictly `block`ed; task-required Tier 1/2 are `tokenize`d or `mask`ed; unnecessary fields are `omit`ted.
* **Token Vault Discrepancy:**
  - `extension/src/privacy/token-vault.ts` is the primary vault with category indexing (`[EMAIL_1]`) and fail-closed leak guards.
  - `extension/src/agent/executor.ts` declares a *second, duplicate* `TokenVault` class with different method signatures (`store`, `get`, `resolveTokens`).
* **Payload Sanitizer & Pre-fetch Guard (`payload-sanitizer.ts`):** Implemented. Performs deep scan of serialized JSON for Tier 3 patterns, raw vault strings, and token mapping dictionaries before transmission.

### 3.7 Task-Aware Context Planner (`task-context.ts`)
* **Status:** Partially Implemented (Keyword-heuristic).
* **Functionality:** Classifies task strings into 6 intents (`click`, `fill_form`, `analyze_statement`, `navigate`, `extract_data`, `general`) using regular expressions. Defines required, optional, and forbidden contexts.
* **Limitation:** Rigid regex-based intent classification. If user phrasing differs significantly from anticipated keywords, it defaults to `general`.

### 3.8 Server Gateway (`server/src/`)
* **Status:** Working.
* **`GET /health`:** Returns service health, uptime, and default provider.
* **`POST /agent/reason`:**
  - Validates sanitized payload using `validateSanitizedPayload` (strictly rejects incoming raw secrets and token vaults).
  - Routes request to selected provider adapter (`mock`, `openrouter`, `groq`).
  - Validates raw model output against strict action plan schema (`validateActionPlan`).
  - Size limiter middleware (`middleware/size-limit.js`) enforces 500 KB ceiling.
* **Providers:**
  - `mock`: Working. Returns deterministic actions based on simple task keywords (`type`, `fill`, `scroll`, `extract`).
  - `openrouter`: Implemented using `fetch` to OpenRouter chat completions API with JSON mode. Requires `OPENROUTER_API_KEY`.
  - `groq`: Implemented using `fetch` to Groq chat completions API with JSON mode. Requires `GROQ_API_KEY`.

### 3.9 Agent Execution & Action Guard (`extension/src/agent/`)
* **Action Schema (`action-schema.ts`):** Implemented. Validates action type allowlist (`click`, `type`, `select`, `scroll`, `navigate`, `focus`, `extract`, `wait`). Sanitizes against `eval()`, `<script>`, pseudo-protocols.
* **Action Guard (`action-guard.ts`):** Implemented. Checks staleness (< 30s), URL alignment, viewport bounds, target existence, role compatibility, visibility, and enabled state. Gating: low risk auto-allowed; medium risk validated; high risk flagged for user confirmation.
* **Browser Executor (`executor.ts`):** **BROKEN DOM TARGET RESOLUTION**.
  - `findDomElement()` searches `doc.getElementById(matchedId)`. Because `matchedId` is a perception ID like `"e1"`, `document.getElementById("e1")` returns `null` on real pages.
  - Does not use `getElementByPerceptionId(id)` from `dom.ts`.
  - Fallback text search only works if the target element's `innerText` or `value` contains `target.text`. On blank input fields with external `<label>` tags, target resolution fails.

### 3.10 Demo Site (`demo-site/`)
* **Status:** Working.
* **Components:**
  - `index.html`: Workflow A (Form assistant with synthetic PII/secrets).
  - `statement.html`: Workflow B (Account statement table with synthetic transactions).
  - `ground-truth.json`: Machine-readable fixtures for both workflows.
  - `serve.js`: Zero-dependency Node.js HTTP static server on port 8080.

### 3.11 Benchmarks (`benchmarks/`)
* **Status:** Mocked / Simulated.
* **Functionality:** `benchmarks/run.js` runs without errors and produces `benchmarks/results.json`.
* **Finding:** It does not run the actual extension or live browser perception. It uses a standalone regex function (`simulatePrivacyDetector`), hardcodes the sanitized payload structure, and hardcodes latencies (`320ms`, `285ms`, `0.85ms`).

### 3.12 Tests (`tests/`)
* **Status:** 70/70 passing (after running `npm run build`).
* **Suite Breakdown:**
  - `adversarial.test.js`: 10 adversarial attacks (unsanitized image guard, split tokens, fake Luhn, stale page, eval injection).
  - `agent-guard.test.js`: Action schema, Action Guard validation, risk policies, token resolution.
  - `benchmark.test.js`: Benchmark metric formulas, ground-truth validity.
  - `live-e2e.test.js`: Integration test running live gateway and demo server.
  - `perception.test.js`: DOM extraction, AccName, screenshot guards on synthetic DOM elements.
  - `privacy.test.js`: Rules, checksums, detector, policy engine, token vault, redactor, sanitizer.
  - `server.test.js`: Gateway HTTP endpoints, size limit, schemas, provider errors.
  - `skeleton.test.js`: Manifest and bundle integrity.
* **Limitation:** Tests execute in Node.js with synthetic DOM mocks. Real Chrome extension APIs (`chrome.tabs`, `chrome.sidePanel`) are mocked or unexercised in a real browser engine.

---

## 4. Summary Matrix: Claims vs. Reality

| Feature / Component | Claimed Status | Actual Implementation Status | Notes |
| :--- | :--- | :--- | :--- |
| **Manifest V3 Setup** | Implemented | **Implemented** | Manifest is valid, loads properly when unpacked from `extension/`. |
| **Local Perception (DOM & AccName)** | Implemented | **Implemented** | Accurate W3C AccName resolution, visibility, enabled checks. |
| **Stable Element IDs** | Implemented | **Implemented** | `ElementRegistry` produces stable `e1`, `e2` IDs. |
| **Screenshot Redaction / Vision** | Implemented | **Stubbed / Missing** | Guard exists, but no canvas image capture/redaction code is implemented. `sanitizedImage` is always `null`. |
| **PII & Secret Detection** | Implemented | **Implemented** | Comprehensive regexes, Luhn, IBAN, SSN, and attribute detectors. |
| **Task-Aware Minimization** | Implemented | **Partially Implemented** | Works via fixed keyword regexes; lacks semantic generalization. |
| **Local Token Vault** | Implemented | **Partially Implemented** | Works, but code is duplicated across two conflicting class definitions. |
| **Fail-Closed Sanitizer** | Implemented | **Implemented** | Pre-fetch and server-side validators strictly reject leaks and vault mappings. |
| **Reasoning Server Gateway** | Implemented | **Implemented** | Clean HTTP server, size limiter, schema validators, mock/openrouter/groq providers. |
| **Action Guard** | Implemented | **Implemented** | Validates schema, staleness, URL, target properties, and risk gating. |
| **Browser DOM Executor** | Implemented | **Broken** | `findDomElement` looks for perception ID in HTML DOM `getElementById("e1")` instead of using `getElementByPerceptionId`. |
| **Autonomous Agent Loop** | Implemented | **Missing / Stubbed** | Sidepanel only executes `actions[0]` once; does not loop or execute multi-step plans. |
| **Automated Benchmarks** | Implemented | **Simulated / Mocked** | Benchmark script uses a self-contained simulator with hardcoded latencies rather than live pipeline measurements. |

---

## 5. Identified Bugs & Technical Issues

### 5.1 Broken Functionality
1. **Perception ID DOM Lookup in Executor (`extension/src/agent/executor.ts`):**
   - Line 375: `doc.getElementById(matchedId)` fails when `matchedId` is an internal perception ID (`"e1"`) because the actual DOM element has `id="full-name"`.
   - **Fix Required:** Link `BrowserExecutor` to `getElementByPerceptionId` from `dom.ts` or resolve the element reference directly from the perception match.
2. **Single-Action Execution Limitation (`extension/src/sidepanel/app.ts`):**
   - Line 250: `const firstAction = actions[0];` executes only one action and finishes. Form completion tasks returning a list of field entries fail to complete.
   - **Fix Required:** Implement sequential action execution with DOM re-evaluation / re-perception.
3. **Background Worker Error Route Bug (`extension/src/background.ts`):**
   - Lines 43–54 and 71–82: On tab query failure or `chrome.runtime.lastError` during an `EXECUTE_ACTION` message, the worker sends `PERCEPTION_RESPONSE` instead of an action error response.

### 5.2 Build & Test Issues
1. **Tests Require Pre-Built Dist:**
   - `npm test` fails immediately if `npm run build` has not been run first, because test files import from `../dist/...`.
2. **Missing Out-of-the-Box Dependencies:**
   - Fresh clones lack `node_modules` and required explicit `npm install`.

### 5.3 Security & Architectural Inconsistencies
1. **Duplicate TokenVault Implementations:**
   - `extension/src/privacy/token-vault.ts` vs `extension/src/agent/executor.ts`. Two distinct classes with mismatched APIs create confusion and dual-maintenance hazard.
2. **Missing Canvas Image Redactor:**
   - Claimed vision capabilities are non-functional; extension operates purely in DOM/text mode.
3. **Hardcoded Gateway URL in Extension:**
   - Extension sidepanel hardcodes `http://127.0.0.1:3000/agent/reason`. Users cannot configure server host, port, provider, or model from the UI.

---

## 6. Prioritized Implementation Roadmap

### **P0 — Blocks the System from Running (Critical Fixes)**
1. **Fix `BrowserExecutor` Element Lookup:** Update `executor.ts` to locate elements via `getElementByPerceptionId(matchedId)` from `dom.ts` instead of `doc.getElementById(matchedId)`.
2. **Consolidate `TokenVault`:** Remove the secondary `TokenVault` in `executor.ts` and unify all code on `privacy/token-vault.ts`.
3. **Fix Background Service Worker Routing:** Ensure `EXECUTE_ACTION` failures return `ACTION_EXECUTION_RESULT` with error details rather than `PERCEPTION_RESPONSE`.

### **P1 — Core Functionality (Agent Execution & Pipeline)**
4. **Implement Multi-Step Action Loop:** Update `sidepanel/app.ts` to execute sequential actions returned by the model (e.g., fill name, fill email, fill phone, click submit) with appropriate DOM settling pauses.
5. **Add Gateway Configuration UI:** Allow user in `sidepanel` to set gateway URL and select AI provider (`mock`, `groq`, `openrouter`) and model name.
6. **Integrate Real Perception into Benchmarks:** Replace `simulatePrivacyDetector` in `benchmarks/run.js` with the real `detectPIIFromPerceptionElements` and `evaluateBatchPolicy` from the compiled extension.

### **P2 — Security Hardening**
7. **Complete Canvas Screenshot Redaction (Vision Module):** Implement offscreen canvas masking in `screenshot.ts` that blanks out sensitive bounding boxes before image transmission.
8. **Dynamic Stale Perception Invalidation:** Invalidate stored perception tokens whenever navigation or significant DOM mutations occur in the active tab.

### **P3 — Usability & Polish**
9. **Side Panel Action History & Receipts:** Display formatted privacy receipts (number of items blocked, tokenized, and minimized bytes) in a scrollable UI log.
10. **Visual Bounding Box Overlays:** Add optional content script visual highlights for elements targeted by the agent.

### **P4 — Optional Improvements**
11. **Semantic Task Intent Planner:** Replace keyword regex matching in `task-context.ts` with local small model or embedding-based classification.
12. **Playwright / Puppeteer E2E Testing:** Add true browser-driven integration tests to test the extension in real Chromium rather than synthetic node DOM objects.
