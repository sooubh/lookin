# Privacy Firewall — Detailed Implementation Plan

## 1. Objective

The Privacy Firewall is the main differentiator of the project.

It must answer three questions locally:

1. What sensitive information is present?
2. How risky is each item?
3. Does the current task actually require that information to leave the browser?

Only after all three are known can the browser decide what to send.

## 2. Decision model

For each UI item:

```text
Detection
  +
Confidence
  +
Sensitivity
  +
Task requirement
  +
Destination policy
      |
      v
Privacy decision
```

## 3. Sensitivity tiers

### Tier 0 — Public

Examples:
- public page title
- Submit button
- navigation labels
- product names

Default: allow when task-relevant.

### Tier 1 — Personal

Examples:
- name
- email
- phone
- address

Default: minimize; tokenize or redact unless task-required.

### Tier 2 — Sensitive

Examples:
- financial values
- account identifiers
- medical/private document content
- personal transaction history

Default: only transmit the minimum subset required by the task.

### Tier 3 — Secret

Examples:
- password
- OTP
- session token
- API key
- private key
- CVV

Default: BLOCK. No exception for server reasoning.

## 4. Detector stack

### Layer A — DOM signals

Read safe metadata:
- input type
- name/id attributes
- aria-label
- label text
- autocomplete
- `password`, `email`, `tel`, etc.

### Layer B — deterministic patterns

Implement regex/checksum detectors for:
- email
- phone
- card-like numbers
- IPs
- URLs containing tokens
- common API key prefixes
- JWTs
- PEM headers
- OTP-like fields

### Layer C — local semantic model

Use browser ML for contextual PII that deterministic rules miss.

Existing reference:
- PrivacyLens uses OpenAI's `privacy-filter` model via Transformers.js in-browser.
- DFKI Privacy Guardrail combines deterministic recognizers with optional transformer NER via ONNX Runtime Web.
- TextSift demonstrates a local privacy-filter engine with browser WebGPU and a fallback path.

References:
- https://github.com/shitijkarsolia/privacylens
- https://github.com/dfki-dsa/pii-guardrail-browser-extension
- https://github.com/teamchong/textsift

### Layer D — visual detector

Use local vision only for information that cannot be safely inferred from structured page data, e.g.:
- faces
- image-embedded text
- visual documents
- screenshots of desktop-like canvas apps
- UI regions missing from DOM

Research/reference direction:
- WebPII/WebRedact-style visual PII detection.

## 5. Confidence fusion

Example:

```text
DOM email type            = 0.99
Regex email               = 0.98
NER email                 = 0.96
Visual OCR email          = 0.91

Final confidence          = 0.99
```

Do not blindly average everything. Use category-specific rules.

Recommended initial policy:

```text
>= 0.95      strong detection
0.75–0.95    uncertain; use secondary verifier
< 0.75       keep protected until resolved
```

Fail closed for high-risk categories.

## 6. Risk score

For the prototype, implement a transparent heuristic before attempting learned risk scoring.

Example:

```text
risk =
  sensitivity_weight
  * detection_confidence
  * exposure_impact
```

Then clamp to `[0, 1]`.

Example output:

```json
{
  "category": "password",
  "confidence": 0.998,
  "risk": 1.0
}
```

```json
{
  "category": "name",
  "confidence": 0.97,
  "risk": 0.42
}
```

Do not represent this as a scientifically validated risk score in the pitch. It is an engineering policy score for the prototype.

## 7. Task-aware minimum-context engine

First classify user intent into a minimal information requirement.

### Example: click

Task:

```text
"Click Submit"
```

Required:
- button role
- button text
- position
- visibility
- enabled state

Not required:
- name
- email
- phone
- account balance

### Example: analyze transaction

Task:

```text
"What did I spend this month?"
```

Required:
- transaction dates
- merchant labels if needed
- amounts
- currency

Potentially unnecessary:
- account number
- exact home address
- password

### Example: fill form

Task:

```text
"Fill the registration form"
```

Required values may include personal data, but the server should receive **field semantics and safe tokens**, not raw identity values.

## 8. Policy matrix

| Sensitivity | Task needed? | Representation | Network |
|---|---|---|---|
| Public | Yes | Raw/structured | Allow |
| Public | No | Omit | Block |
| Personal | No | Omit/token | Prefer omit |
| Personal | Yes | Tokenized/minimized | Allow token only |
| Sensitive | No | Omit | Block |
| Sensitive | Yes | Minimum safe subset | Allow sanitized only |
| Secret | Any | Never transmit | Block |
| Face | Not needed | Blur/remove | Block raw |

## 9. Redaction engine

Input:

```text
screenshot + bounding boxes + privacy decisions
```

Output:

```text
sanitized screenshot
```

Use deterministic canvas operations:
- fill black/neutral rectangle for secret values
- blur face regions
- replace text region with placeholder where semantic continuity is required
- preserve non-sensitive UI geometry

Store original screenshot only in memory and discard after sanitization.

## 10. Token vault

Use browser storage only for prototype, e.g. `chrome.storage.session` or another short-lived client-side store.

Token format:

```text
[PERSON_1]
[EMAIL_1]
[ORDER_ID_1]
```

Never send the mapping object to the server.

## 11. Privacy receipt

Every request creates a local-only receipt:

```json
{
  "detected": 7,
  "allowed": 2,
  "tokenized": 3,
  "blurred": 1,
  "blocked": 1,
  "rawScreenshotSent": false,
  "rawSecretSent": false,
  "payloadBytes": 12400
}
```

This is for demo/benchmarking, not analytics.

## 12. Fail-closed behavior

The browser must block network transmission when:
- screenshot sanitization fails
- a Tier 3 secret is unresolved
- detector/model crashes and protected information might remain
- the current page state changed after analysis
- payload contains a known secret pattern

## 13. Privacy firewall files

```text
extension/privacy/
├── categories.js
├── rules.js
├── pii-detector.js
├── visual-detector.js
├── confidence-fusion.js
├── risk-engine.js
├── task-context.js
├── policy-engine.js
├── token-vault.js
├── redactor.js
├── payload-sanitizer.js
└── privacy-receipt.js
```

## 14. AI coding-agent task sequence

### Agent Task P1 — Detection abstraction

Build a category-based detection interface.

Do not build the UI, API, or screenshot upload yet.

Output:
```js
{
  category,
  spanOrBox,
  confidence,
  source
}
```

### Agent Task P2 — Deterministic detector

Implement DOM + regex/checksum rules.

Include unit tests for synthetic examples.

### Agent Task P3 — Local model adapter

Add an interface for browser local model inference.

Do not hard-couple the application to one model provider.

### Agent Task P4 — Confidence fusion

Combine detector outputs without weakening Tier 3 protection.

### Agent Task P5 — Task requirement engine

Convert natural-language task into required/optional/forbidden context categories.

### Agent Task P6 — Policy engine

Implement the allow/tokenize/blur/mask/structure-only/block decisions.

### Agent Task P7 — Redaction

Implement screenshot bounding-box redaction and tests.

### Agent Task P8 — Sanitized payload guard

Before fetch, run a final leak scan over the serialized payload.

If any blocked category remains, abort the network request.

## 15. Existing privacy projects to study

SafeScreen:
https://github.com/thesid42/Safe-Screen

DFKI Privacy Guardrail:
https://github.com/dfki-dsa/pii-guardrail-browser-extension

PrivacyLens:
https://github.com/shitijkarsolia/privacylens

TextSift:
https://github.com/teamchong/textsift

Umbra:
https://github.com/useumbra/umbra

## 16. Key engineering principle

Do not build “PII detector + blur”. Build:

**Task → required information → sensitivity → confidence → minimum safe representation.**
