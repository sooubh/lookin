# Antigravity Coding Execution Plan — Prompt-by-Prompt Build System

## 0. How to use this file

Do not give one giant prompt to Antigravity.

Run the prompts below sequentially. After each task:
1. build
2. run tests
3. inspect the changed files
4. manually verify the feature
5. commit the working state
6. only then continue

Reference repositories supplied by the project owner:
- https://github.com/nanobrowser/nanobrowser
- https://github.com/RunanywhereAI/on-device-browser-agent
- https://github.com/thesid42/Safe-Screen

Additional references:
- https://github.com/dfki-dsa/pii-guardrail-browser-extension
- https://github.com/shitijkarsolia/privacylens
- https://github.com/teamchong/textsift
- https://github.com/useumbra/umbra
- https://github.com/huggingface/transformers.js
- https://github.com/microsoft/onnxruntime

## 1. Global instructions for every Antigravity task

Use these rules in every prompt:

- Project language: JavaScript/TypeScript.
- Browser target: Chrome Manifest V3 first.
- Backend: Node.js.
- No database unless a later task proves it is necessary.
- Do not copy an entire reference repository into the project.
- Inspect reference code before adapting any idea.
- Verify third-party licenses before copying source code.
- Never send raw screenshots to the server.
- Never send passwords, OTPs, API keys, auth tokens, or secret mappings to the server.
- Never use `eval` for browser actions.
- All server actions must pass local validation.
- Keep modules small and testable.
- Prefer real implementation over placeholders.
- Do not fabricate benchmark numbers.

## 2. Master project layout

```text
privacy-browser-agent/
├── extension/
├── server/
├── demo-site/
├── benchmarks/
├── docs/
├── package.json
└── README.md
```

## 3. Prompt A0 — Reconnaissance only

### Give Antigravity this prompt

```text
You are working on a new project called Privacy-Preserving Browser Vision Agent.

Do NOT modify or create production code yet.

Study these repositories:
1. https://github.com/nanobrowser/nanobrowser
2. https://github.com/RunanywhereAI/on-device-browser-agent
3. https://github.com/thesid42/Safe-Screen
4. https://github.com/dfki-dsa/pii-guardrail-browser-extension
5. https://github.com/shitijkarsolia/privacylens
6. https://github.com/teamchong/textsift
7. https://github.com/useumbra/umbra

Also study:
8. https://github.com/huggingface/transformers.js
9. https://github.com/microsoft/onnxruntime

Produce docs/REFERENCE_AUDIT.md with:
- what each repository actually implements
- which components map to our architecture
- what should be reused as a dependency
- what should be used only as a reference
- likely license constraints
- important dependencies
- conflicting approaches
- what is already solved by existing projects
- what our genuinely new layer is

Our differentiation is:
1. task-aware minimum-context planning
2. adaptive privacy decisions
3. confidence/risk-based local policy
4. local action guard

Do not claim anything without evidence from the repositories.
Do not modify application code.
```

## 4. Prompt A1 — Extension skeleton

```text
Build only the Chrome MV3 extension skeleton.

Create:
- manifest.json
- service worker
- content script
- side panel
- shared message types
- minimal UI

Requirements:
- TypeScript preferred.
- No AI calls.
- No backend.
- No screenshot upload.
- Side panel must allow entering a user task.
- Content script must be able to return page metadata.

Add a simple health/status panel.

Run build and basic tests before finishing.
Do not implement privacy or agent execution yet.
```

## 5. Prompt A2 — DOM/accessibility perception

```text
Implement only local page perception.

From the active tab, collect visible interactive and semantic elements:
- buttons
- links
- inputs
- selects
- textareas
- headings
- relevant visible text

For each element return:
- stable local ID
- role
- safe visible label/text
- bbox
- visible
- enabled/disabled
- input type where applicable
- source = dom

Do not send the collected data to any server yet.

Add unit tests using synthetic DOM fixtures.
Do not implement screenshots, AI, redaction, or browser actions.
```

## 6. Prompt A3 — Screenshot module

```text
Implement local screenshot capture only.

Requirements:
- capture the visible tab in memory
- expose width/height/timestamp
- do not persist raw screenshots to disk
- do not send them over the network
- provide a testable function that returns a Blob/ImageBitmap/data URL as appropriate

Add a hard guard function called assertSafeToTransmit(image, metadata) that currently always fails for raw images.

Do not connect screenshots to the backend yet.
```

## 7. Prompt A4 — Local ML adapter

```text
Add a browser-local ML adapter using Transformers.js and/or ONNX Runtime Web.

Requirements:
- WebGPU first
- WASM fallback
- model loading must be lazy
- cache model assets locally where practical
- no remote inference calls
- expose a generic interface such as:
  initialize()
  analyze(imageOrText)
  dispose()
  getRuntimeInfo()

Keep the model implementation behind an adapter so it can be replaced later.

Do not build the privacy policy yet.
Add a small local benchmark command that records initialization and inference latency.
```

## 8. Prompt A5 — Deterministic privacy detector

```text
Implement local privacy detection without sending page data anywhere.

Detect at minimum:
- email
- phone
- password fields
- OTP fields
- credit-card-like numbers
- API/JWT/token patterns
- person/name indicators where practical
- address indicators where practical

Use:
- DOM metadata
- regex/checksum rules
- explicit sensitivity categories

Return:
{
  category,
  confidence,
  location,
  source
}

Add synthetic tests.
Do not add any network call.
```

## 9. Prompt A6 — Semantic local detector

```text
Add the local semantic privacy model adapter.

Use the existing local browser inference adapter.

The model must run locally in Chrome and integrate with the deterministic detector.

Implement a fusion layer that combines multiple signals.

For Tier-3 secrets, do not allow a low model confidence score to weaken protection.

Add tests showing that:
- obvious emails are detected
- names can be detected from context
- passwords/keys remain protected
```

## 10. Prompt A7 — Privacy policy engine

```text
Implement the adaptive Privacy Firewall.

For each detected item, decide among:
allow
omit
mask
tokenize
blur
structure_only
block

Inputs:
- category
- sensitivity tier
- confidence
- task requirements
- whether the value is a secret

Rules:
- secrets are always block
- unnecessary personal data should be omitted where possible
- task-required personal values should be tokenized instead of revealed to the server
- visual faces should be blurred when visual context is needed
- public task-relevant UI can remain visible

Return a fully explainable decision object.

Do not use an LLM to make the final security decision.
```

## 11. Prompt A8 — Task-aware minimum-context engine

```text
Implement the local task requirement engine.

Input: natural-language task.

Output:
{
  intent,
  requiredContext,
  optionalContext,
  forbiddenContext,
  allowedActions,
  highRiskActions
}

Example input:
"Click the Submit button."

Expected required context:
button role, label, visibility, enabled state, position.

Expected forbidden context:
passwords, OTPs, API keys.

Keep the first version deterministic/rule-driven. Design the interface so a future local model can improve intent extraction.

Add tests for both demo workflows.
```

## 12. Prompt A9 — Token vault + redaction

```text
Implement:
1. local short-lived token vault
2. placeholder generation
3. screenshot redaction
4. sanitized text/DOM generation

Requirements:
- original values stay local
- server receives placeholders only
- secret values are never tokenized for transmission; they are blocked
- redacted screenshot preserves UI geometry
- raw screenshot is never passed to fetch()

Add before/after test fixtures.
```

## 13. Prompt A10 — Sanitized payload builder

```text
Build the final sanitized context builder.

Inputs:
- task requirements
- page perception
- privacy detections
- privacy decisions
- optional sanitized screenshot

Output:
{
  task,
  safeDom,
  safeText,
  sanitizedImage,
  capabilities,
  privacyReceipt
}

Before any network call, run a final leak scan over the serialized payload.

The network call must be aborted if:
- a Tier-3 pattern exists
- raw token vault values appear
- a raw screenshot is attached
- policy-required fields are missing

Add tests proving that dangerous payloads never reach fetch().
```

## 14. Prompt A11 — Node gateway

```text
Create a minimal Node.js server.

Endpoint:
POST /agent/reason

Requirements:
- no database
- no raw-content persistence
- provider abstraction
- request size limits
- strict input validation
- strict JSON output validation

Providers:
- OpenRouter
- Groq

Create environment variables for API keys and model IDs.
Do not place keys in the extension.
```

## 15. Prompt A12 — Server VLM reasoning

```text
Implement the reasoning layer for sanitized context.

The model must receive only:
- user task
- sanitized structured UI context
- sanitized visual context if necessary
- allowed action schema

Do not accept token-vault mappings.
Do not ask the model to decide whether secret data is allowed; the browser already made that decision.

Return strict JSON actions.

Implement a provider-neutral prompt.
Do not allow arbitrary code/tool calls.
```

## 16. Prompt A13 — Local Action Guard

```text
Implement the Local Action Guard.

For every server action:
1. validate action type against allowlist
2. resolve target locally
3. verify page/state is current
4. verify target matches role/label/bbox
5. check risk policy
6. execute or block

High-risk actions must require explicit user confirmation.

Never execute JavaScript returned by the model.
Never trust coordinates without local validation.
Add negative tests for stale, unknown, and malicious actions.
```

## 17. Prompt A14 — Browser executor

```text
Implement safe browser actions:
- click
- type
- select
- scroll
- navigate
- focus
- extract

Each action must go through Local Action Guard.

For typing sensitive local values, resolve the placeholder/token inside the browser and never send the actual value to the server.

Add test cases for both simple and sensitive form flows.
```

## 18. Prompt A15 — Controlled demo website

```text
Build a controlled demo website with synthetic data only.

Workflow 1: Private Form Assistant
Include:
- fake name
- fake email
- fake phone
- fake password
- fake address
- ordinary form fields
- Submit button

Workflow 2: Private Account/Statement Analysis
Include:
- fake account identifier
- fake transactions
- amounts
- dates
- irrelevant personal fields

The site must be deliberately instrumented so the benchmark can know the ground-truth sensitive regions.
Do not use real personal data.
```

## 19. Prompt A16 — Privacy dashboard

```text
Build the side-panel privacy receipt.

Show:
- local analysis status
- detected PII count
- blocked/tokenized/blurred/allowed counts
- raw screenshot sent: NO
- raw secret sent: NO
- payload size
- local inference latency
- server latency
- action guard result

Never display actual secret values in the dashboard.
```

## 20. Prompt A17 — Benchmark harness

```text
Create a benchmark harness for the two controlled workflows.

Measure:
1. visual/UI context accuracy
2. PII detection precision and recall
3. redaction precision
4. local CPU/RAM/WebGPU usage where measurable
5. end-to-end task latency

Use synthetic ground truth.
Do not fabricate results.
Export machine-readable JSON and a human-readable report.
```

## 21. Prompt A18 — Adversarial privacy tests

```text
Add adversarial tests:
- email embedded in an image
- name split across DOM nodes
- password in visually styled text
- secret-looking non-secret string
- disabled form fields
- hidden DOM elements
- off-screen sensitive element
- canvas-rendered sensitive text
- page changing after analysis
- server returning malicious/unknown action

The privacy firewall must fail closed whenever a protected secret might escape.
```

## 22. Prompt A19 — Final audit

```text
Perform a full architecture and security audit.

Check:
- no raw screenshot network path
- no token vault network path
- no secret transmission
- action allowlist
- server schema validation
- provider key handling
- extension permissions
- XSS/injection risks
- prompt-injection exposure from webpage text
- stale screenshot/action state
- error handling
- performance

Produce docs/FINAL_AUDIT.md.
Do not rewrite architecture unless there is a concrete bug.
```

## 23. Recommended branching strategy

```text
main
 |
 +-- feat/extension-shell
 +-- feat/page-perception
 +-- feat/local-ml
 +-- feat/privacy-firewall
 +-- feat/task-context
 +-- feat/sanitized-payload
 +-- feat/node-gateway
 +-- feat/vlm-reasoning
 +-- feat/action-guard
 +-- feat/demo-site
 +-- feat/benchmarks
```

Merge only tested features.

## 24. Final demo sequence

The exact live demonstration should be:

```text
1. Open controlled website.
2. Show fake private information on screen.
3. Open extension side panel.
4. Enter task.
5. Show local detection.
6. Show privacy decisions.
7. Show sanitized context preview.
8. Show "Raw PII sent: 0".
9. Send safe payload to VLM.
10. Receive action plan.
11. Local Action Guard verifies it.
12. Browser executes the action.
13. Show privacy receipt and latency.
14. Repeat with statement-analysis workflow.
```

## 25. Important coding-agent rule

Whenever an agent proposes:
- sending raw screenshots “for better accuracy”
- letting the server decide privacy
- exposing real values to the VLM
- executing arbitrary JS from model output
- copying an entire reference repository
- storing raw page data in a database

**reject that change and preserve the core architecture.**
