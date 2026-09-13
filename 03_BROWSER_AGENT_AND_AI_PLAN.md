# Browser Agent + Local Vision + Server Reasoning — Detailed Integration Plan

## 1. Objective

Build the agent around an existing browser-agent execution architecture, while inserting a local privacy firewall before every network boundary and a local action guard after every model response.

## 2. Existing repositories and exact role

### 2.1 NanoBrowser

Repository:
https://github.com/nanobrowser/nanobrowser

Use it as a reference for:
- browser-agent decomposition
- planner/navigator concepts
- tool/action orchestration
- model-provider abstraction ideas

Do not copy the whole product into the project. Keep only architecture patterns that fit our security boundary.

### 2.2 RunAnywhere On-Device Browser Agent

Repository:
https://github.com/RunanywhereAI/on-device-browser-agent

Use it as a primary reference for:
- Chrome MV3 extension structure
- local model/WebGPU setup
- browser navigation/action execution
- planner/navigator/executor separation

Its current scope is not identical to this project; our additions are local visual perception, privacy-aware context planning, adaptive redaction, and stronger action authorization.

### 2.3 SafeScreen

Repository:
https://github.com/thesid42/Safe-Screen

Use it as reference for:
- local screenshot handling
- privacy sanitization
- placeholder concepts
- keeping real values local
- guarded browser execution

### 2.4 DFKI Privacy Guardrail

Repository:
https://github.com/dfki-dsa/pii-guardrail-browser-extension

Use it as reference for:
- deterministic PII recognizers
- local NER
- ONNX Runtime Web
- WebGPU/WASM fallback
- benchmark harness and local-only operation

### 2.5 PrivacyLens

Repository:
https://github.com/shitijkarsolia/privacylens

Use it as reference for:
- Transformers.js local PII detection
- regex + model fusion
- side-panel UX
- fail-closed behavior
- visual redaction flow

### 2.6 TextSift

Repository:
https://github.com/teamchong/textsift/

Use it as reference for:
- openai/privacy-filter packaging
- browser WebGPU inference
- WASM fallback
- streaming detection
- benchmark concepts

## 3. Target runtime

### Extension

JavaScript/TypeScript + Chrome Manifest V3.

### Local ML

Preferred:
- Transformers.js
- ONNX Runtime Web
- WebGPU
- WASM fallback

References:
- https://github.com/huggingface/transformers.js
- https://github.com/microsoft/onnxruntime

### Backend

Node.js + Express or a minimal Node HTTP server.

### Server AI

Provider abstraction:

```text
AIProvider
  |- OpenRouterProvider
  |- GroqProvider
  |- LocalProvider (future)
```

## 4. Why keep a tiny Node backend

Direct extension-to-provider calls are technically possible, but a tiny project gateway is safer and cleaner because:

1. Provider API keys stay off the extension.
2. OpenRouter/Groq/model choice can be swapped without rebuilding the extension.
3. Model routing can happen server-side.
4. Provider failures can be handled centrally.
5. The architecture clearly shows the privacy boundary: only sanitized content crosses it.

The gateway should not store user page content.

## 5. Server provider recommendation

Do not hard-code one provider in the application. Implement adapters.

As of the current documentation:
- OpenRouter has a free-model router, `openrouter/free`, which filters for request requirements including image understanding, tool calling, and structured outputs; free-model availability can change. https://openrouter.ai/docs/guides/routing/routers/free-router
- Groq supports current multimodal models with image input and JSON/tool-use capabilities; its current vision documentation lists Qwen multimodal models and the API supports image inputs. https://console.groq.com/docs/vision

For the prototype, benchmark at least one OpenRouter path and one Groq path on the **same sanitized payloads**.

Do not claim “best model” until your own task benchmark proves it.

## 6. Local visual perception

Goal:

> Understand the current screen enough to identify relevant UI structure, visual regions, and task context while keeping raw sensitive data local.

Use a layered approach:

### Stage A — DOM/accessibility

Fast path:
- buttons
- inputs
- labels
- links
- headings
- visible text
- bounding boxes
- disabled/enabled state

### Stage B — local vision

Use a compact WebGPU-capable model for:
- visual UI regions
- canvas-rendered content
- image content
- missing DOM structure
- visual confirmation of candidate targets

### Stage C — OCR only when needed

Prefer DOM text first.

Use OCR on sanitized/local data only when required.

## 7. Perception contract

Every perception run returns:

```json
{
  "viewport": {"width": 1440, "height": 900},
  "elements": [
    {
      "id": "e17",
      "role": "button",
      "text": "Submit",
      "bbox": [820, 650, 100, 40],
      "visible": true,
      "enabled": true,
      "source": "dom"
    }
  ],
  "visualRegions": []
}
```

No private value is automatically included simply because it exists on the page.

## 8. Local task interpreter

Input:

```text
"Fill the form and submit it."
```

Output:

```json
{
  "intent": "form_completion",
  "required": [
    "field_labels",
    "field_types",
    "user-approved values"
  ],
  "forbidden": [
    "password_to_server",
    "api_key_to_server"
  ]
}
```

For highly sensitive actual values, use local execution where possible:

```text
Server tells local agent:
fill EMAIL_FIELD with token [EMAIL_1]

Local browser resolves:
[EMAIL_1] -> local value
```

Thus the server can plan the action without learning the value.

## 9. Action protocol

Server output must be strict JSON.

```json
{
  "actions": [
    {
      "type": "click",
      "target": {
        "text": "Submit",
        "role": "button"
      },
      "risk": "low"
    }
  ]
}
```

Reject:
- arbitrary JavaScript
- `eval`
- shell commands
- unknown action types
- selectors not validated by the extension

## 10. Action guard

### Low risk

Can execute automatically:
- scroll
- focus
- open tab/navigation when safe
- click ordinary UI controls
- select non-destructive options

### Medium risk

Require extra local validation:
- form submission
- changing settings
- sending a message

### High risk

Require explicit user confirmation:
- purchase
- money transfer
- account deletion
- publishing/posting
- sending sensitive content
- irreversible operations

## 11. Browser execution strategy

Prefer deterministic DOM interaction when an element is available.

Use visual coordinates only when:
- target is rendered on canvas
- element has no reliable DOM representation
- local vision finds a target not exposed structurally

For coordinate actions, require:
- screenshot timestamp/state ID
- matching viewport dimensions
- target confidence
- local hit-test confirmation where possible

## 12. Extension modules

```text
extension/
├── manifest.json
├── background.js
├── content.js
├── sidepanel/
│   ├── index.html
│   └── app.js
├── perception/
│   ├── dom.js
│   ├── accessibility.js
│   ├── screenshot.js
│   ├── vision.js
│   └── fusion.js
├── privacy/
│   └── ...
├── agent/
│   ├── planner.js
│   ├── action-schema.js
│   ├── action-guard.js
│   └── executor.js
└── common/
    └── messages.js
```

## 13. Backend modules

```text
server/
├── src/
│   ├── index.js
│   ├── routes/
│   │   └── agent.js
│   ├── providers/
│   │   ├── index.js
│   │   ├── openrouter.js
│   │   └── groq.js
│   ├── prompts/
│   │   └── vision-agent.js
│   ├── schemas/
│   │   └── action-plan.js
│   └── middleware/
│       └── size-limit.js
└── .env
```

## 14. API contract

### POST `/agent/reason`

Request:

```json
{
  "task": "Find the order status",
  "context": {
    "dom": {},
    "visual": null,
    "safeText": [],
    "sanitizedImage": null
  },
  "capabilities": ["click", "scroll", "extract"]
}
```

Response:

```json
{
  "actions": [
    {
      "type": "extract",
      "target": {"text": "Delivered"},
      "risk": "low"
    }
  ]
}
```

No token map is accepted by this API.

## 15. AI-coding agent sequence

### Agent A0 — Repository reconnaissance

Read the current project tree and the supplied reference repositories.

Produce:
- component mapping
- dependency list
- license notes
- files to reference
- files to reimplement

Do not modify code.

### Agent A1 — MV3 skeleton

Create the extension shell, side panel, service worker, content script, typed message bus.

No AI yet.

### Agent A2 — Page perception

Implement DOM/accessibility extraction with stable element IDs and bounding boxes.

### Agent A3 — Screenshot module

Capture visible tab screenshots only in memory.

Add explicit “raw screenshot must never be uploaded” test hooks.

### Agent A4 — Local ML runtime

Integrate Transformers.js/ONNX Runtime Web with WebGPU and a WASM fallback.

Keep model adapter generic.

### Agent A5 — Privacy firewall

Integrate the separate privacy modules from the Privacy Firewall specification.

### Agent A6 — Sanitized-context builder

Build the exact payload sent to the server.

Run a final local leak scan immediately before fetch.

### Agent A7 — Node gateway

Implement `/agent/reason` and provider adapters.

### Agent A8 — Structured VLM reasoning

Implement strict action JSON output and schema validation.

### Agent A9 — Local action guard

Implement action validation and risk policies.

### Agent A10 — Browser executor

Implement click/type/select/scroll/navigate/focus/extract.

### Agent A11 — Demo site + workflows

Build the controlled benchmark website with synthetic private data.

### Agent A12 — Evaluation dashboard

Measure detection and end-to-end metrics.

## 16. Definition of done

The prototype is not done until all of the following are true:

- raw screenshot cannot be sent through the network layer
- password/OTP/API-key test strings are blocked
- sanitized screenshot is visually inspectable
- server receives a safe payload
- server returns strict JSON actions
- local action guard can reject invalid/stale actions
- at least two complete workflows run end-to-end
- local WebGPU path works on a supported machine
- fallback path works without WebGPU
- benchmark data is generated from synthetic fixtures
