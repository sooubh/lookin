# Privacy-Preserving Browser Vision Agent — Master System Specification

## 0. Purpose

Build an SIH-ready prototype of a Chrome browser agent that can understand webpages using local browser perception, decide locally what information is safe/necessary to expose, send only sanitized context to a server-side VLM/LLM, and validate every returned browser action locally before execution.

The system should work on arbitrary websites, while one controlled demo website is also provided for repeatable benchmarking.

## 1. Core idea

**Do not merely redact PII. Decide what information the cloud agent actually needs for the current task, then send the minimum safe representation.**

Core security principle:

> Cloud AI is the reasoning engine. The browser is the privacy boundary and final execution authority.

## 2. System flow

```text
User task
   |
   v
Chrome Extension
   |
   +--> DOM / Accessibility / UI extraction
   |
   +--> Local lightweight vision model (WebGPU)
   |
   v
Local Perception Fusion
   |
   v
Privacy Analyzer
   |- PII / secret detection
   |- sensitivity classification
   |- confidence estimation
   v
Task-Aware Context Planner
   |- what does this task require?
   |- what is unnecessary?
   |- what is forbidden to transmit?
   v
Privacy Policy Engine
   |- allow
   |- tokenize
   |- blur
   |- mask
   |- structure-only
   |- block
   v
Sanitized Context
   |- safe DOM/UI structure
   |- optional sanitized screenshot
   |- task description
   |- no raw secret values
   v
Node API Gateway
   |
   v
Server VLM / LLM
   |
   v
Structured Action Plan
   |
   v
Local Action Guard
   |- verify current page/state
   |- verify target
   |- risk-check action
   |- require confirmation for high-risk actions
   v
Browser execution
```

## 3. Components

### 3.1 Chrome extension

Manifest V3 extension written in JavaScript/TypeScript.

Responsibilities:
- receive user task from side panel
- inspect current page
- capture screenshot only when policy requires it
- run local privacy/perception models
- build sanitized context
- call the project Node gateway
- validate server actions
- execute allowed actions
- show an audit/privacy receipt

### 3.2 Local perception

Use a hybrid representation:

1. DOM and accessibility information for reliable structured elements.
2. Lightweight vision model in the browser for visual/layout information that DOM cannot capture.
3. Optional OCR only when required by a task and not already exposed through DOM text.

The target is **full screen/task understanding**, not necessarily a large local general-purpose VLM.

### 3.3 Privacy analyzer

Detect at least:
- name/person
- email
- phone
- address
- passwords
- OTP/authentication codes
- credit/debit card information
- bank/account identifiers
- government identifiers
- face regions
- API keys/tokens/secrets
- private document regions

Use a hybrid detector:
- deterministic DOM/type signals
- regex/checksum rules
- local NER/privacy model
- visual detector where appropriate
- confidence fusion

### 3.4 Task-aware context planner

Convert a user task into a minimal context requirement.

Example:

```json
{
  "task": "Click the Submit button",
  "required": ["visible_button_text", "button_position", "button_enabled"],
  "unnecessary": ["name", "email", "phone", "address"],
  "never_transmit": ["password", "otp", "api_key"]
}
```

The browser creates this requirement locally. The server must not be trusted to decide what sensitive data it is allowed to receive.

### 3.5 Privacy policy engine

For every detected item, produce:

```json
{
  "category": "email",
  "risk": 0.86,
  "confidence": 0.98,
  "task_required": false,
  "decision": "tokenize"
}
```

Actions:
- `allow`
- `tokenize`
- `blur`
- `mask`
- `structure_only`
- `block`

### 3.6 Token vault

Keep mappings only on the client.

```text
[PERSON_1] -> real person value
[EMAIL_1]  -> real email value
[ORDER_1]  -> real order ID
```

The server sees only placeholders.

### 3.7 Sanitized screenshot

When visual context is necessary:
- redact sensitive bounding boxes locally
- preserve layout and task-relevant geometry
- preserve labels that are safe and required
- never send the original screenshot

For many tasks, skip screenshot transfer entirely and send structured context.

### 3.8 Server reasoning layer

Keep Node backend intentionally small.

Responsibilities:
- authenticate/provider-call if needed
- accept sanitized context only
- invoke selected VLM/LLM
- validate response schema
- return structured action plan
- log only non-sensitive metrics

Do not store raw screenshots, tokens, or browser data.

### 3.9 Local Action Guard

No model response is executed blindly.

Validate:
- current URL/page identity
- element still exists
- target matches requested label/role
- target is within expected bounding box
- action is allowed by policy
- page did not change unexpectedly

High-risk actions such as financial transfers, deletion, purchase, message sending, or irreversible submission should require confirmation.

## 4. Action schema

Start with:

```json
{
  "actions": [
    {
      "type": "click",
      "target": {
        "text": "Submit",
        "role": "button"
      },
      "risk": "low",
      "reason": "Complete the requested form"
    }
  ]
}
```

Supported action types should eventually include:
- click
- type
- select
- scroll
- navigate
- focus
- extract
- wait

Use an allowlist; reject unknown actions.

## 5. Primary demo workflows

### Workflow A — Private Form Assistant

User task: "Fill this form and submit it."

The page includes deliberately planted personal data and a submit button.

Expected flow:
1. local perception discovers form structure
2. local privacy engine detects PII/secrets
3. task-aware planner determines required context
4. only required fields/actions are shared
5. server VLM produces structured actions
6. local action guard validates them
7. extension performs fill/submit
8. privacy receipt shows exactly what left the browser

### Workflow B — Private Account/Statement Analysis

User task: "Check this account statement and tell me the total monthly spending."

Expected flow:
1. local perception finds statement structure
2. account identifiers are blocked/redacted
3. transactions and amounts needed for the question are preserved
4. sanitized representation is sent
5. server computes/understands result
6. answer returns to user
7. no browser action required

## 6. Demo UI

Side panel should show:

```text
PRIVACY FIREWALL

Local analysis       READY
PII detected         7
Blocked              2
Tokenized            3
Allowed              2

Raw screenshot sent  NO
Raw PII sent         NO
Sanitized context    12.4 KB
Local inference      84 ms
Server reasoning     310 ms

ACTION
Click "Submit"

LOCAL GUARD
Verified ✓
Executed ✓
```

## 7. Resource strategy

The local stack should prefer:

```text
WebGPU when available
       |
       +--> lightweight ONNX / Transformers.js model
       |
       +--> otherwise WASM/CPU fallback
```

Run expensive vision only when DOM/metadata is insufficient.

Use caching and model warm-up to avoid repeat-download latency.

## 8. Security invariants

The implementation must enforce these rules:

1. No raw screenshot is sent to the server.
2. Passwords, OTPs, API keys and authentication tokens are never transmitted.
3. Original-to-token mappings stay client-side.
4. The server cannot override the local privacy policy.
5. Unknown model actions are rejected.
6. High-risk actions require explicit confirmation.
7. Telemetry must not contain private page content.
8. Sensitive test fixtures use synthetic data.

## 9. Recommended repository structure

```text
privacy-browser-agent/
├── extension/
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── sidepanel/
│   ├── perception/
│   ├── privacy/
│   ├── redaction/
│   ├── token-vault/
│   └── agent/
├── server/
│   ├── src/
│   │   ├── routes/
│   │   ├── providers/
│   │   ├── schemas/
│   │   └── index.js
├── demo-site/
├── benchmarks/
└── docs/
```

## 10. Existing project references

### Browser agents
- NanoBrowser: https://github.com/nanobrowser/nanobrowser
- RunAnywhere on-device browser agent: https://github.com/RunanywhereAI/on-device-browser-agent

### Privacy/redaction
- SafeScreen: https://github.com/thesid42/Safe-Screen
- DFKI Privacy Guardrail: https://github.com/dfki-dsa/pii-guardrail-browser-extension
- PrivacyLens: https://github.com/shitijkarsolia/privacylens
- TextSift: https://github.com/teamchong/textsift
- Umbra: https://github.com/useumbra/umbra

### Browser ML
- Transformers.js: https://github.com/huggingface/transformers.js
- ONNX Runtime Web: https://github.com/microsoft/onnxruntime

## 11. What to reuse vs rebuild

### Reuse/reference
- NanoBrowser: agent/tool/browser concepts
- RunAnywhere: MV3 browser-agent execution and local WebGPU architecture
- SafeScreen: privacy boundary and sanitized-screen concept
- DFKI Privacy Guardrail / PrivacyLens / TextSift: local PII detection techniques and benchmarking ideas
- Transformers.js + ONNX Runtime Web: local browser inference runtime

### Build ourselves
- task-aware minimum-context planner
- adaptive privacy policy engine
- fused privacy risk score
- context budget/data minimization logic
- action guard tied to privacy/risk policy
- SIH benchmark dashboard

Do not copy code until licenses and individual file headers are verified. Prefer modular dependency use and clean-room reimplementation of ideas where appropriate.
