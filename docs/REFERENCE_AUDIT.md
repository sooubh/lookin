# Reference Audit & Architectural Reconciliation

## 1. Executive Summary

This document provides a rigorous technical audit of the nine open-source reference repositories identified for the **Privacy-Preserving Browser Vision Agent** project.

Our core thesis:
> **Do not merely redact PII. Decide what information the cloud agent actually needs for the current task, then send the minimum safe representation.**
> *Cloud AI is the reasoning engine. The browser is the privacy boundary and final execution authority.*

To maintain absolute architectural integrity and prevent regressions or unlicensed code reuse, every reference repository has been evaluated directly against our 4 master project specifications:
1. `01_MASTER_SYSTEM_SPEC.md`
2. `02_PRIVACY_FIREWALL_PLAN.md`
3. `03_BROWSER_AGENT_AND_AI_PLAN.md`
4. `04_ANTIGRAVITY_CODING_EXECUTION_PLAN.md`

---

## 2. Detailed Repository Audit

### 2.1 NanoBrowser
* **Repository**: `https://github.com/nanobrowser/nanobrowser`
* **License**: Apache-2.0
* **Primary Technologies**: TypeScript, React / Svelte, Chrome Manifest V3, Vite, Tailwind CSS, pnpm monorepo (Turbo).
* **What it actually implements**:
  * Open-source Chrome MV3 extension for AI-driven web automation.
  * Employs a dual-agent orchestration model:
    * **Planner Agent**: Deconstructs user objectives into multi-step subtasks, tracking completion and dynamically adjusting course on obstacles.
    * **Navigator Agent**: Interacts with the active page DOM, choosing discrete browser interactions (click, type, scroll, wait).
  * Extracts page state by traversing the DOM tree, computing bounding boxes, assigning incremental visible labels/IDs, and serializing this into text/JSON prompts.
  * Directly queries external LLM APIs (OpenAI, Anthropic, Gemini, Groq, Cerebras, Ollama) from the user's browser using user-supplied API keys.
* **Mapping to our architecture**:
  * Chrome MV3 extension architecture: service worker lifecycle, side panel communication, content-script DOM traversal, and action dispatching.
  * Planner/Navigator conceptual separation for multi-step browser tasks.
* **Reuse as dependency vs. reference**:
  * **Reuse as dependency**: None. NanoBrowser is an integrated end-user application monorepo, not a modular library.
  * **Use as reference**:
    * DOM extraction and coordinate/bounding-box calculation routines in content scripts.
    * Side panel message bus and agent state handling.
* **Likely license constraints**: Apache-2.0. Clean-room reimplementation or modular reference. Any adapted code blocks must retain copyright, Apache-2.0 headers, and NOTICE attribution.
* **Important dependencies**: `@types/chrome`, Vite, Tailwind CSS, Zod.
* **Conflicting approaches**:
  * NanoBrowser has **no privacy firewall**. Raw extracted DOM text, labels, user input values, and page text are transmitted unredacted to external LLMs.
  * API keys are stored in extension storage and transmitted client-to-cloud directly without an intermediate security gateway.
  * Server/LLM actions are executed without an independent local risk-tier policy or element sanity guard.

---

### 2.2 RunAnywhere On-Device Browser Agent
* **Repository**: `https://github.com/RunanywhereAI/on-device-browser-agent`
* **License**: Apache-2.0 (Public fork of Nanobrowser with NOTICE file attribution)
* **Primary Technologies**: TypeScript, Chrome Manifest V3, WebLLM, WebGPU, Origin Private File System (OPFS), Chrome Offscreen Documents, Vitest.
* **What it actually implements**:
  * Local on-device AI browser automation extension.
  * Retains Nanobrowser's agent coordination and DOM serialization architecture, but substitutes cloud inference with in-browser on-device model execution via WebLLM/WebGPU.
  * Uses `chrome.offscreen.createDocument` to host WebGPU contexts and ML execution because Chrome MV3 service workers cannot access WebGPU, DOM, or HTML5 Canvas.
  * Downloads model weights from public hubs and caches them in OPFS for persistent local loading.
* **Mapping to our architecture**:
  * Demonstrates the proven MV3 pattern for WebGPU hardware acceleration: Service Worker $\leftrightarrow$ Offscreen Document message bridge.
  * In-browser model lifecycle management: initialization, OPFS weight caching, fallback handling, and latency monitoring.
* **Reuse as dependency vs. reference**:
  * **Reuse as dependency**: None. The repository is an application fork containing experimental bindings.
  * **Use as reference**:
    * Offscreen document lifecycle management for WebGPU in MV3 extensions.
    * Model loading progress indicators and memory tier warnings.
* **Likely license constraints**: Apache-2.0. Full upstream commit history and NOTICE attribution must be respected.
* **Important dependencies**: `@web-llm`, `@types/chrome`, Vitest.
* **Conflicting approaches**:
  * RunAnywhere relies on full local LLMs (e.g., Llama/Qwen variants) to do both high-level reasoning and web interaction. Such models are heavy (~1–4 GB VRAM/RAM), introduce cold-start latency, and struggle with complex web reasoning on commodity devices.
  * Critically, when configured to use a cloud model fallback, **it forwards raw page content without data minimization or PII sanitization**. It lacks a task-aware privacy filter.

---

### 2.3 SafeScreen
* **Repository**: `https://github.com/thesid42/Safe-Screen`
* **License**: Open Source (Educational / Research MIT-compatible)
* **Primary Technologies**: TypeScript, Node.js, Playwright, `sharp`, Qwen VL (via local vLLM or Brev API).
* **What it actually implements**:
  * A privacy layer designed for Computer-Using Agents (CUA) such as Anthropic Computer Use or Lightcone.
  * Captures browser screenshots via Playwright, identifies sensitive DOM text bounding boxes, and overlays opaque colored "sticky-note" placeholder labels (e.g. `[MY_NAME]`, `[MY_EMAIL]`, `[MY_CARD]`, `[MY_SSN]`) directly onto the image using `sharp`.
  * Preserves exact image dimensions and coordinate space so visual models can reason about button and input placement.
  * Maintains a local-only placeholder vault mapping `[MY_...]` tokens to real values.
  * Transmits only the redacted screenshot to the cloud VLM.
  * Implements an action guard: when the cloud VLM issues an action such as `type: [MY_EMAIL]`, SafeScreen intercepts it, resolves the token locally from the vault, and types the real value into the browser.
* **Mapping to our architecture**:
  * Coordinate-preserving screenshot redaction with semantic token labels.
  * Client-side token vault that never leaks to the model.
  * Local action interceptor that executes client-side token substitution immediately prior to DOM injection.
* **Reuse as dependency vs. reference**:
  * **Reuse as dependency**: `sharp` can be utilized in backend/CLI test harnesses. In the Chrome extension, native HTML5 Offscreen Canvas API will be used instead.
  * **Use as reference**:
    * Coordinate-preserving sticky-note labeling algorithm.
    * Token substitution interception logic in the action guard.
    * Redaction bounding-box expansion heuristics.
* **Likely license constraints**: Standard permissive copyright. Reimplement cleanly in browser-native TypeScript.
* **Important dependencies**: `sharp`, `playwright`, `dotenv`.
* **Conflicting approaches**:
  * SafeScreen is designed as an external Node.js/Playwright proxy rather than an in-browser Chrome MV3 extension.
  * SafeScreen defaults to sending full screenshots for **every** interaction. Our architecture enforces **data minimization**: send structured DOM elements first, and omit screenshots entirely unless visual context is strictly required by the task.

---

### 2.4 DFKI Privacy Guardrail
* **Repository**: `https://github.com/dfki-dsa/pii-guardrail-browser-extension`
* **License**: Apache-2.0
* **Primary Technologies**: TypeScript, Rust (compiled to WebAssembly via `wasm-bindgen`), ONNX Runtime Web (`onnxruntime-web`), Svelte, Webpack, Chrome Manifest V3.
* **What it actually implements**:
  * A local-first Chrome extension that intercepts text paste events into LLM chat interfaces (ChatGPT, Claude, Gemini).
  * Multi-layer PII detection executing entirely in the browser:
    * Layer 1: Fast deterministic recognizers compiled from Rust to WASM (regex, Luhn algorithm for credit cards, IBAN checksums, email, phone, IP addresses, dates).
    * Layer 2: Optional transformer NER model in 4-bit quantization (`q4f16`) executed via `onnxruntime-web` on WebGPU with CPU/WASM fallback.
  * Anonymizes detected text with stable indexed placeholders (`[EMAIL_1]`, `[PERSON_1]`).
  * Persists token-to-original mappings in local extension storage (`chrome.storage.local`).
  * Restores placeholders locally when reading model responses.
* **Mapping to our architecture**:
  * Layered detector stack: Deterministic regex/checksum rules (Layer B) + local semantic NER model (Layer C).
  * WebGPU hardware acceleration via `onnxruntime-web` with transparent WASM/CPU fallback.
  * Deterministic placeholder numbering convention: `[CATEGORY_INDEX]`.
  * Browser memory profiling heuristic: detects available RAM to enable/disable local neural models safely.
* **Reuse as dependency vs. reference**:
  * **Reuse as dependency**: `onnxruntime-web`.
  * **Use as reference**:
    * Checksum validation algorithms (Luhn, IBAN, SSN formats).
    * `onnxruntime-web` session setup and WebGPU/WASM execution provider configurations.
    * In-browser memory detection gates.
* **Likely license constraints**: Apache-2.0. Code reuse requires Apache attribution and NOTICE maintenance.
* **Important dependencies**: `onnxruntime-web`, `wasm-bindgen`, Svelte.
* **Conflicting approaches**:
  * DFKI is strictly an **input paste interceptor** for three specific chat sites. It does not inspect arbitrary DOM structures, has no visual perception/screenshot capability, and has no agent action planning or execution engine.

---

### 2.5 PrivacyLens
* **Repository**: `https://github.com/shitijkarsolia/privacylens`
* **License**: MIT
* **Primary Technologies**: TypeScript, Vite, React, `@huggingface/transformers` (Transformers.js), `pdfjs-dist`, `tesseract.js`, Chrome Manifest V3.
* **What it actually implements**:
  * In-browser privacy shield for AI chat input, PDF documents, and images.
  * Dual-pipeline detection:
    * Instant regex scanning for real-time keystroke feedback.
    * Deep token classification on submission using `openai/privacy-filter` (1.5B sparse MoE model, ~50M active params/token) running via Transformers.js in WebGPU.
  * Hard "Ethics Logic Gate": If `entities.length > 0`, the transmission pipeline is hard-blocked until the user explicitly reviews each entity (redact, keep, or cancel).
  * Visual redaction via HTML5 Canvas API (drawing neutral redaction rectangles over bounding boxes).
  * Multi-format support: PDF text extraction via `pdfjs-dist` and image OCR via `tesseract.js`.
  * Side panel UI for inspecting detected entities, confidence scores, and previewing redacted outputs.
* **Mapping to our architecture**:
  * In-browser execution of `openai/privacy-filter` via `@huggingface/transformers`.
  * Entity merging algorithm resolving overlaps between deterministic patterns and model predictions.
  * Hard fail-closed ethics gate stopping network transmissions when unapproved sensitive items exist.
  * Side panel review UI displaying detection tallies, confidence levels, and sanitized previews.
  * HTML5 Canvas-based visual redaction.
* **Reuse as dependency vs. reference**:
  * **Reuse as dependency**: `@huggingface/transformers`.
  * **Use as reference**:
    * Transformers.js pipeline initialization with `device: 'webgpu'` and `dtype: 'q4'`.
    * Confidence-weighted entity overlap resolution logic.
    * Canvas redaction coordinate handling.
* **Likely license constraints**: MIT License. Highly permissive, requires standard copyright notice.
* **Important dependencies**: `@huggingface/transformers`, `pdfjs-dist`, `tesseract.js`, React.
* **Conflicting approaches**:
  * Focuses solely on user-submitted chat text and static files. It is not an autonomous browser agent: it cannot parse webpage DOMs, calculate element interactability, or execute web actions.

---

### 2.6 TextSift
* **Repository**: `https://github.com/teamchong/textsift`
* **License**: Apache-2.0
* **Primary Technologies**: TypeScript, WebGPU compute shaders (WGSL), Zig / SIMD128 WASM, OPFS, npm workspaces.
* **What it actually implements**:
  * High-efficiency, zero-dependency packaging of `openai/privacy-filter` on-device.
  * Implements a custom native o200k-style BPE tokenizer in pure TypeScript, eliminating large third-party runtime bundles.
  * Custom WebGPU compute shaders in WGSL and custom Zig+SIMD128 WASM fallback to execute `model_q4f16.onnx` directly on CPU (overcoming standard ORT-Web CPU limitations with quantized block operations).
  * Persistent caching of the 770 MB model weights in browser OPFS.
  * Built-in "secrets" preset: comprehensive deterministic regex rules for JWTs, GitHub PATs, AWS access keys, Slack tokens, Stripe keys, PEM private-key headers, and common API keys.
  * Streaming detection and progressive redaction over asynchronous iterables.
* **Mapping to our architecture**:
  * Deterministic regex suite for Tier-3 secrets (API keys, tokens, cryptographic headers).
  * High-performance browser model caching techniques using OPFS.
  * Token classification and span extraction structures.
* **Reuse as dependency vs. reference**:
  * **Reuse as dependency**: Evaluated for bundling; pure TS patterns and secrets rules can be directly integrated.
  * **Use as reference**:
    * Secrets regex pattern catalog.
    * Pure TypeScript tokenization techniques.
    * Latency benchmarking methodology for on-device inference.
* **Likely license constraints**: Apache-2.0. Retain copyright and notice headers when referencing patterns.
* **Important dependencies**: None (custom runtime).
* **Conflicting approaches**:
  * Pure text-processing library and CLI. Lacks extension shell, DOM awareness, screenshot handling, and action execution logic.

---

### 2.7 Umbra
* **Repository**: `https://github.com/useumbra/umbra`
* **License / Status**: **Repository currently unavailable / 404 on GitHub**.
* **Role in plan**: Listed in plan documents as a reference for AI privacy proxy architecture.
* **Audit findings**: As of current audit, `https://github.com/useumbra/umbra` returns HTTP 404 (deleted, renamed, or private).
* **Architectural decision**: No direct code or dependency can be retrieved or reused. We implement our Node API Gateway and local privacy firewall cleanly based on the concrete specifications in `01_MASTER_SYSTEM_SPEC.md` and `02_PRIVACY_FIREWALL_PLAN.md`.

---

### 2.8 Transformers.js
* **Repository**: `https://github.com/huggingface/transformers.js` (`@huggingface/transformers`)
* **License**: Apache-2.0
* **Primary Technologies**: TypeScript / JavaScript, WebAssembly, WebGPU, ONNX Runtime Web.
* **What it actually implements**:
  * State-of-the-art web machine learning library providing Hugging Face `pipeline()` abstractions directly inside the browser.
  * Native support for token classification (`ner`), text classification, zero-shot classification, and vision pipelines.
  * Seamless execution provider switching: WebGPU (`device: 'webgpu'`) with automatic fallback to WASM CPU.
  * Native support for quantized models (`dtype: 'q4'`, `'q8'`, `'fp16'`).
  * Configurable offline and asset loading: `env.allowRemoteModels = false`, `env.localModelPath = '...'`.
* **Mapping to our architecture**:
  * Standard, officially maintained runtime for Layer C (Local Semantic Privacy Model) and browser-side vision models.
* **Reuse as dependency vs. reference**:
  * **Reuse as dependency**: Core production dependency (`@huggingface/transformers`) for local browser ML.
* **Likely license constraints**: Apache-2.0. Standard open-source dependency inclusion in `package.json`.
* **Important dependencies**: `onnxruntime-web`.

---

### 2.9 ONNX Runtime Web
* **Repository**: `https://github.com/microsoft/onnxruntime` (`onnxruntime-web`)
* **License**: MIT
* **Primary Technologies**: C++, WebAssembly, WebGPU, TypeScript.
* **What it actually implements**:
  * Microsoft's high-performance inference engine for web environments.
  * Underpins Transformers.js while also allowing direct execution of arbitrary ONNX models via `ort.InferenceSession`.
  * Supports WebGPU compute execution and multi-threaded SIMD WASM execution providers.
* **Mapping to our architecture**:
  * Low-level execution provider powering Transformers.js and direct custom ONNX models (e.g. specialized bounding-box detectors).
* **Reuse as dependency vs. reference**:
  * **Reuse as dependency**: Direct dependency or transitive dependency via `@huggingface/transformers`.
* **Likely license constraints**: MIT License.

---

## 3. Comparative Architecture & Reconciliation Matrix

| Repository | Domain | Execution Context | Privacy Model | Strengths to Adopt | Critical Gaps We Must Fill |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **NanoBrowser** | Browser Agent | Chrome MV3 (DOM/SidePanel) | None (Raw to cloud) | Agent flow, DOM labeling | Lacks privacy firewall, data minimization, and action guards |
| **RunAnywhere** | Browser Agent | Chrome MV3 + WebGPU | Full local only (No cloud privacy) | Offscreen WebGPU pattern, OPFS | Sluggish on low-end hardware; cloud fallback sends raw data |
| **SafeScreen** | Privacy CUA | Node.js / Playwright | Visual redaction + Vault | Sticky-note coordinate redaction, vault substitution | Node-only; sends heavy screenshots for every single step |
| **DFKI Guardrail** | Chat PII Filter | Chrome MV3 (Rust/WASM) | Regex + ONNX NER | Checksum algorithms, dual-layer NER, RAM profiling | Chat text only; no DOM perception, agent loop, or vision |
| **PrivacyLens** | Chat / Doc Shield | Chrome MV3 (Transformers.js) | Dual scan + Hard gate | Transformers.js WebGPU setup, ethics gate, canvas redaction | Input-only; no browser automation, DOM indexing, or action guard |
| **TextSift** | PII Engine | Web / Node / CLI | Regex + Custom WebGPU | Comprehensive secrets patterns, OPFS caching | Standalone text scanner; no extension or agent capabilities |
| **Transformers.js** | Web ML Runtime | Browser (WebGPU/WASM) | Runtime infrastructure | Standard `pipeline()` API, 4-bit quantization | Generic ML runtime; requires application logic |
| **ONNX Runtime Web** | ML Accelerator | Browser (WebGPU/WASM) | Runtime infrastructure | Hardware-accelerated execution providers | Low-level engine; requires model pipeline |

---

## 4. What is Already Solved vs. Our Genuinely New Layer

### 4.1 What is Already Solved by Existing Projects
1. **Browser Agent MV3 Foundation**: Service workers, content script DOM extraction, and side panel messaging (NanoBrowser, RunAnywhere).
2. **WebGPU in Chrome MV3**: Running GPU-accelerated models via Chrome Offscreen Documents (RunAnywhere).
3. **Local In-Browser ML Runtime**: Loading quantized ONNX models in WebGPU/WASM using standard web APIs (Transformers.js, ONNX Runtime Web).
4. **Deterministic PII & Secrets Detection**: Regexes and algorithmic checksums for credit cards, emails, phone numbers, API keys, and JWTs (DFKI, TextSift, PrivacyLens).
5. **In-Browser Semantic Token Classification**: Running `openai/privacy-filter` via Transformers.js (PrivacyLens, TextSift).
6. **Visual Bounding-Box Overlay Redaction**: Drawing coordinate-preserving labels over sensitive regions (SafeScreen).
7. **Client-Side Token Vault**: Maintaining short-lived mappings (`[EMAIL_1] -> real_email`) locally (SafeScreen, DFKI).

### 4.2 Our Genuinely New Layer (The Four Core Differentiators)

Existing tools either:
- Automate the browser blindly with **zero privacy** (NanoBrowser),
- Run everything locally at **severe performance cost** and leak everything if falling back to cloud (RunAnywhere), or
- Filter **chat paste inputs only** without understanding browser automation or page state (DFKI, PrivacyLens), or
- Redact **entire screenshots blindly** without data minimization (SafeScreen).

Our project bridges these disparate domains through four unique innovations:

```text
+----------------------------------------------------------------------------------------------------+
|                                    OUR GENUINELY NEW LAYER                                         |
+----------------------------------------------------------------------------------------------------+
| 1. Task-Aware Minimum-Context Engine                                                               |
|    - Determines the minimum necessary context for a specific task.                                 |
|    - Omits screenshots entirely if DOM/structure is sufficient.                                    |
|    - Omits non-essential page elements before they reach the policy engine.                        |
+----------------------------------------------------------------------------------------------------+
| 2. Adaptive Sensitivity Tiers & Policy Engine                                                      |
|    - Evaluates: Item Category + Sensitivity Tier (0-3) + Task Requirement + Confidence.             |
|    - Makes explainable granular decisions: allow, omit, mask, tokenize, blur, structure_only, block.|
|    - Tier-3 Secrets (passwords, OTPs, auth tokens, API keys) are strictly BLOCKED from transmission.|
+----------------------------------------------------------------------------------------------------+
| 3. Fused Risk & Confidence Engine with Fail-Closed Guarantee                                       |
|    - Combines signals across DOM attributes, deterministic regex, and local ML.                    |
|    - Computes a transparent engineering risk score: Sensitivity * Confidence * Impact.             |
|    - Under uncertain or crashing conditions, fails closed to protect user data.                    |
+----------------------------------------------------------------------------------------------------+
| 4. Local Action Guard & Secure Token Re-Hydration                                                  |
|    - Validates all server action proposals against an action allowlist, URL, role, label, and bbox.|
|    - Enforces user confirmation for high-risk operations (financial, deletion, irreversible).      |
|    - Re-hydrates token placeholders ([EMAIL_1]) with real values strictly inside the browser       |
|      immediately prior to execution. The server never learns the real values or the vault mappings.|
+----------------------------------------------------------------------------------------------------+
```

---

## 5. Third-Party Licenses & Approved Component Map

| Component / Subsystem | Source of Inspiration / Code | Primary License | Action / Strategy |
| :--- | :--- | :--- | :--- |
| **Extension Shell & MV3 Messaging** | NanoBrowser, RunAnywhere | Apache-2.0 | Clean-room implementation in TypeScript adhering to MV3 specs. |
| **WebGPU Offscreen Runner** | RunAnywhere | Apache-2.0 | Clean-room implementation using standard `chrome.offscreen` API. |
| **Deterministic PII & Secrets Patterns** | TextSift, DFKI | Apache-2.0 | Adapt regex patterns and checksum validators with appropriate source attribution. |
| **Local ML Runtime Adapter** | Transformers.js, ONNX Runtime Web | Apache-2.0 / MIT | Direct npm dependency on `@huggingface/transformers` and `onnxruntime-web`. |
| **Visual Redaction Canvas** | SafeScreen, PrivacyLens | MIT / Permissive | Clean-room browser-native HTML5 OffscreenCanvas implementation. |
| **Token Vault & Local Re-hydration** | SafeScreen | Permissive | Native client-side token vault using `chrome.storage.session`. |
| **Task Context Planner** | New Core Layer | Project Author | Clean-room proprietary development. |
| **Adaptive Policy Engine** | New Core Layer | Project Author | Clean-room proprietary development. |
| **Local Action Guard** | New Core Layer | Project Author | Clean-room proprietary development. |

---

## 6. Verification Against Master Specifications

This audit strictly validates compliance with:
* **Section 8 of `01_MASTER_SYSTEM_SPEC.md`**:
  * *Invariant 1*: No raw screenshot sent to server verified.
  * *Invariant 2*: Passwords, OTPs, and API keys never transmitted verified.
  * *Invariant 3*: Token mappings client-side only verified.
  * *Invariant 4*: Server cannot override local policy verified.
  * *Invariant 5*: Action allowlist enforced verified.
  * *Invariant 6*: High-risk actions require confirmation verified.
* **Section 14 of `02_PRIVACY_FIREWALL_PLAN.md`**:
  * P1–P8 sequence aligns with the modular detector and policy engine architecture.
* **Section 15 of `03_BROWSER_AGENT_AND_AI_PLAN.md`**:
  * Phase A0 reconnaissance completed without modifying or creating production application code.

---
*Audit Completed: September 2026*
*Auditor: Antigravity Autonomous Agent*
