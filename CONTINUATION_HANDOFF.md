# AI Powered Browsing Agent
## Continuation Handoff Document

This document is written for the next model or developer continuing the project. It describes the current browser-extension project, the architecture, completed work, active configuration, known issues, uncommitted changes, and the recommended implementation order.

Do not copy any API key into documentation, commits, prompts, screenshots, or chat messages. The local `.env` file is intentionally excluded by `.gitignore`.

---

## 1. Product Goal

The project is a Chrome/Edge Manifest V3 browser extension called **AI Powered Browsing Agent**.

The user opens the extension popup on the active browser page, enters a natural-language request, and chooses one of two modes:

- **Summarise**: understand the current page and return a text-only answer.
- **Execute**: run a bounded planner/executor loop, performing one validated browser action per planner call and observing the page again before replanning.

The extension sends page context to a local Node/Express service. The service calls the configured AI model. The private API key remains on the server and is never packaged into the extension.

Core request flow:

```text
Active browser tab
    -> popup request
  -> local task classifier
  -> direct browser operation for search/find/scroll/navigation
  -> otherwise page title, URL, selection, bounded text, compact DOM snapshot
  -> optional screenshot when the request is visibly visual
  -> local /api/agent endpoint
    -> model system instruction + dynamic user context
    -> structured JSON answer and optional action
    -> local validation
    -> text response or browser execution
```

Common browser tasks are handled locally before any model call. Semantic tasks use DOM-first context. Requests containing visual language capture the visible viewport up front. Other model requests can still use screenshot fallback after a context-related failure.

---

## 2. Repository and Git State

Repository:

```text
https://github.com/RoshanAnandSeeli/AI-BrowserAgent
```

Current branch:

```text
main
```

Last pushed commit at the time this document was created:

```text
345077e Improve browsing agent controls and diagnostics
```

Current working tree when this document was last audited contains uncommitted changes in:

- `.env.example`
- `README.md`
- `EXTENSION_TEST_PLAN.md`
- `extension/manifest.json`
- `extension/popup.html`
- `extension/popup.css`
- `extension/popup.js`
- `extension/background.js` is new and untracked
- `extension/sidebar.html` is new and untracked
- `server.ts`
- `AGENT_RELIABILITY_PLAN.md` is new and untracked
- `CONTINUATION_HANDOFF.md` is new and untracked

Before creating a new commit, inspect the working tree:

```powershell
git status --short
git diff
```

The local `.env` file must remain untracked and ignored.

No changes from this working tree have been pushed since commit `345077e` unless a later commit is created explicitly.

---

## 3. Current Project Structure

```text
Gemini Tester/
|-- extension/
|   |-- manifest.json
|   |-- popup.html
|   |-- popup.css
|   |-- popup.js
|   |-- sidebar.html
|   `-- background.js
|-- .env
|-- .env.example
|-- .gitignore
|-- ACHIEVEMENTS.md
|-- AGENT_RELIABILITY_PLAN.md
|-- CONTINUATION_HANDOFF.md
|-- EXTENSION_TEST_PLAN.md
|-- README.md
|-- agent-fixture.html
|-- package.json
|-- package-lock.json
|-- server.ts
`-- test.html
```

The old Vite playground, `src/`, `dist/`, `index.html`, and `vite.config.ts` were deliberately removed. This repository is extension-focused now.

---

## 4. Commands

Install dependencies:

```powershell
npm install
```

Run the local service:

```powershell
npm run server
```

The service listens on:

```text
http://localhost:3001
```

Health endpoints:

```text
GET http://localhost:3001/
GET http://localhost:3001/health
GET http://localhost:3001/api/diagnostics
GET http://localhost:3001/test
```

The server terminal is the current runtime log destination. No log file is configured.

Check whether it is still running:

```powershell
$listener = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
if ($listener) { "Running: $($listener[0].OwningProcess)" } else { "Not running" }
```

The VS Code terminal tool sometimes reports exit code 1 after a long-running process session is cleaned up, even when the server printed its startup line. Always verify port `3001` directly.

---

## 5. Environment Configuration

Current intended local configuration:

```env
GROQ_API_KEY=do_not_document_the_real_value
GROQ_MODEL=qwen/qwen3.8-27b
GROQ_REQUEST_TIMEOUT_MS=30000
PORT=3001
```

The Groq API key is loaded with `dotenv` in `server.ts`. The server uses Groq Chat Completions with strict JSON Schema output. The configured `qwen/qwen3.8-27b` model supports both structured output and the screenshot image inputs used by the extension.

The current decision is to use one Groq model only, with no fallback models.

Important history:

- `gemini-2.0-flash` was retired/unavailable in an earlier experiment.
- `gemini-3.6-flash` was the previous provider's main model before the Groq migration.
- `gemini-3.7-flash` was attempted as a fallback and did not work reliably.
- Temporary `503` high-demand errors and `429` quota errors have occurred.
- A model can be valid and authenticated while still being temporarily unavailable or quota-exhausted.

Never print the key in logs or diagnostic pages. The diagnostics page only reports whether a key is present and its character count.

---

## 6. Server Responsibilities

`server.ts` is the only backend file.

It currently provides:

### `GET /`

Returns a small service status JSON object.

### `GET /health`

Returns `{ "status": "ok" }`.

### `GET /test`

Serves `test.html`, the simple prompt-testing and diagnostics page.

### `GET /api/diagnostics`

Returns safe configuration information:

- Server status
- Whether an API key is present
- API key length, not the value
- Current model
- Request timeout
- Timestamp

### `POST /api/diagnostics`

Accepts:

```json
{
  "prompt": "What is 2 + 2?"
}
```

It sends the prompt directly to the configured model and returns:

- `ok`
- `stage`
- `model`
- `prompt`
- `elapsedMs`
- `response`, or a provider error

This route is for debugging provider configuration. It does not use the browser-agent system prompt or JSON schema.

### `POST /api/agent`

Accepts the browser-agent request:

```json
{
  "request": "Search for browser automation",
  "pageText": "bounded page text",
  "domSnapshot": "compact DOM snapshot",
  "allowActions": true,
  "image": {
    "mimeType": "image/png",
    "data": "base64 data without the data URL prefix"
  }
}
```

The image is optional. The extension sends it for explicit visual requests or an eligible interpretation fallback. Each API request contains only the current request; previous popup state is not sent as conversation history. Page text is reduced to relevant excerpts and both page text and DOM are size-capped.

The route:

1. Validates the API key configuration.
2. Validates request, page text, and DOM snapshot fields.
3. Builds the dynamic user message.
4. Sends the dynamic message plus optional image to the model.
5. Uses the stable agent system instruction.
6. Uses SDK JSON response configuration and a response schema.
7. Parses and validates the returned object.
8. Normalizes search `type` actions so `pressEnter` becomes true.
9. Returns the structured result and model name.

The extension now avoids this route for simple local tasks such as search, find-on-page, scroll, back, forward, reload, and direct URL navigation.

---

## 7. Agent System Instruction

The stable system instruction is the `AGENT_SYSTEM_INSTRUCTION` constant in `server.ts`.

It defines:

- Agent identity: AI Powered Browsing Agent
- JSON-only output contract
- Required `answer`, `intent`, and `action` fields
- Allowed intent concepts
- Allowed browser actions
- Navigation rules
- Search Enter behavior
- Safety rules
- Selector reliability requirements
- The rule to return `action: null` when context is insufficient

The system instruction is passed through the SDK model configuration as `systemInstruction`.

Dynamic material is kept separate in `userMessage`:

- Execution mode
- User request
- Current page text
- Current DOM snapshot
- Whether visual context is included

This separation is important. Do not put live page content into the stable system instruction.

---

## 8. Structured Response and Intent Model

The SDK response schema is `AGENT_RESPONSE_SCHEMA` in `server.ts`.

Required top-level fields:

```json
{
  "answer": "string",
  "intent": "answer|summarize|search|click|type|scroll|navigate",
  "action": null
}
```

The action may be an object with:

```json
{
  "type": "click|type|scroll|navigate|back|forward|reload",
  "selector": "optional selector",
  "text": "optional typing text",
  "url": "optional http or https URL",
  "amount": "optional integer",
  "pressEnter": "optional boolean"
}
```

The SDK is configured with:

```ts
responseMimeType: 'application/json'
responseSchema: AGENT_RESPONSE_SCHEMA
```

The schema is helpful, but local validation is still necessary because the model output must be safe for browser execution.

---

## 9. Local Action Validation

`validateAgentResult()` in `server.ts` validates:

- The response is an object.
- `answer` is a non-empty string.
- `intent` is one of the allowed intent values.
- Text-only mode cannot return an action.
- The action type is allowed.
- `click` and `type` require a selector.
- `type` requires text no longer than 4000 characters.
- `navigate` requires an absolute `http` or `https` URL.
- Search intent plus type action forces `pressEnter = true`.

The extension performs a second validation immediately before executing:

- Selector syntax is wrapped in `try/catch`.
- Missing elements are rejected.
- Type actions require an input, textarea, select, or contenteditable element.
- Navigation is limited to `http` and `https` URLs.

---

## 10. Extension Responsibilities

### `extension/manifest.json`

Manifest V3 configuration.

Permissions:

- `activeTab`
- `scripting`
- `tabs`

Host permission:

```text
http://localhost:3001/*
```

### `extension/popup.html`

User interface with:

- Current page title and URL
- Request textarea
- **Summarise** button
- **Execute** button
- Status text
- Agent answer
- Executed action display

The old automatic-action checkbox was removed. The user now explicitly chooses text-only summarization or execution.

### `extension/popup.js`

Main extension behavior:

1. Finds the active tab.
2. Rejects protected browser URLs such as `chrome://` and `edge://`.
3. Classifies common requests locally before collecting page context.
4. Performs local search, find, scroll, back, forward, reload, and URL navigation directly.
5. For unresolved requests, reads page context with `chrome.scripting.executeScript`.
6. Builds a compact DOM snapshot.
7. Captures an image only for visual requests or an eligible context fallback.
8. Sends semantic requests to `/api/agent`.
9. Displays the answer.
10. Executes a model action only when the user clicked **Execute**.
11. Refreshes title and URL when the active tab finishes navigation.

### `extension/popup.css`

Provides the popup’s dark compact visual design.

---

## 11. DOM Snapshot Strategy

The extension scans a bounded portion of the page and prioritizes:

- Links
- Buttons
- Inputs
- Textareas
- Select elements
- Headings `h1` through `h4`
- Labels
- Forms
- Navigation
- Main landmarks
- ARIA landmarks such as search and complementary regions

Each interactive element can include:

- `aria-label`
- `placeholder`
- `name`
- `type`
- `role`
- A generated CSS selector

Current bounds:

- Prioritized visible form controls, buttons, links, and landmarks
- Maximum depth 12
- Maximum DOM snapshot length 5,000 characters
- Maximum relevant page text length 1,800 characters

This is intentionally smaller than the original scanner, which included too many text-bearing nodes and increased request latency.

Local classification is intentionally conservative. A request is handled locally only when it matches a clear pattern. Ambiguous requests continue to the model instead of being guessed locally.

---

## 12. Search Execution Behavior

Clear Google shortcuts are now handled locally. For example, `google kangaroos in australia` or `look up kangaroos in australia` directly opens a Google search URL with an encoded query and does not call the model or inspect the DOM. The keyword `search` is intentionally not a direct Google shortcut anymore.

For site-specific or ambiguous search requests, the agent can still return a `type` action targeting a search field.

The extension then:

1. Focuses the element.
2. Uses the native value setter when available.
3. Adds text character by character.
4. Dispatches `InputEvent` for each character.
5. Moves the caret to the end.
6. Dispatches keydown, keypress, and keyup Enter events.
7. Finds the nearest form.
8. Clicks a submit button if present, otherwise calls `form.requestSubmit()`.
9. Dispatches a change event.

This was added because filling a field alone did not submit Google search. Synthetic keyboard events are not trusted browser events, so form submission is the important reliable fallback.

The local web-search path is the preferred path for ordinary searches because it avoids the unreliable search-box action entirely.

---

## 13. Local Browser Task Classifier

`classifyLocalTask()` in `extension/popup.js` recognizes:

- `google ...` and `look up ...`
- `find ... on this page` and `locate ... on this page`
- `back` and previous-page wording
- `forward` and next-page wording
- `reload` and `refresh`
- `scroll down`, `scroll up`, and equivalent wording
- `go to https://...` and a raw HTTP/HTTPS URL

`performLocalTask()` executes these using extension/browser APIs. Local results are displayed directly in the popup with `Completed locally.` status. Navigation, search, scroll, and reload require **Execute**; read-only find-on-page can run in either mode.

This optimization prevents routine browser actions from consuming model quota or waiting for model latency.

---

## 14. Popup State, Copy, Hotkey, and Sidebar

The extension uses `chrome.storage.local` with a per-tab key. It restores the request and latest response when the popup is reopened on the same URL. It clears stale results after a completed navigation.

The response has a **Copy** button using the extension page clipboard API.

The manifest registers the action popup command:

```text
Ctrl+Shift+Y (Windows/Linux)
Command+Shift+Y (macOS)
```

The `_execute_action` command opens the action popup. The optional `open-agent` command is handled by `extension/background.js` and can be assigned a separate shortcut to open the side panel.

The pin button in the popup calls `chrome.sidePanel.open()` for the active tab. `extension/sidebar.html` reuses `popup.js` and `popup.css`, so the side panel has the same behavior and storage state as the popup.

---

## 15. Browser Navigation

Supported action types include:

- `navigate`: update the active tab to an absolute HTTP/HTTPS URL.
- `back`: browser history back.
- `forward`: browser history forward.
- `reload`: reload the active tab.

The popup refreshes title and URL when the active tab reports completed navigation.

One limitation: a popup can close during navigation, so persistent state across page transitions is not implemented yet.

Current implementation update: active Execute runs are stored per tab in `chrome.storage.session`. Reopening the popup restores the active run in a paused state; the user can resume after a fresh observation. The persistent side panel can continue displaying the run across navigation.

---

## 15. Diagnostics and Provider Errors

The test page is:

```text
http://localhost:3001/test
```

It displays:

- Server status
- Key-present status without the key
- Key length
- Current model
- Request timeout
- Prompt input
- HTTP status
- Request timing
- Provider response or safe error details

Known provider errors observed:

### 401 authentication error

`ACCESS_TOKEN_TYPE_UNSUPPORTED` meant the credential was not accepted as a valid API key. The server loaded the environment variable, but Google rejected the value.

### 404 model not found

`gemini-3-flash` was not a valid API identifier for the API version being used. It was removed from fallback configuration.

### 503 model busy

Google reported high demand for `gemini-3.6-flash`. This is a temporary provider capacity issue.

### 429 quota exceeded

Google reported free-tier quota exhaustion, including a 20-request daily model limit in one observed response. Repeated retries can make this worse.

The current project intentionally uses only Groq model `qwen/qwen3.8-27b` and no fallback models.

---

## 16. Timeout Behavior

The server reads:

```env
GROQ_REQUEST_TIMEOUT_MS=30000
```

It passes the timeout through the installed SDK request options. A timed-out agent request returns HTTP `504` with:

```text
The AI request timed out. Please retry.
```

The timeout is not a quota workaround. It only prevents requests from hanging indefinitely.

---

## 17. Completed Milestones

- Created the Manifest V3 extension.
- Added popup UI and provider-neutral branding.
- Added active-tab page metadata.
- Added page text, selected text, and DOM capture.
- Added DOM-first processing.
- Added screenshot fallback.
- Added Summarise and Execute modes.
- Added click, type, scroll, and navigation actions.
- Added search typing and form submission behavior.
- Added page navigation updates.
- Added stable system instruction.
- Separated dynamic user context from stable policy.
- Added SDK JSON response schema.
- Added explicit intent classification.
- Added server-side response validation.
- Added extension-side selector validation.
- Added simple diagnostics/test page.
- Added request timeout.
- Added local browser-task classification for common operations.
- Added direct local web search without model action planning.
- Added direct local find-on-page behavior.
- Added prompt-based DOM/image capture selection.
- Removed experimental Vite/chat playground files.
- Published the project to GitHub.

---

## 18. Current Reliability Plan Status

See [AGENT_RELIABILITY_PLAN.md](AGENT_RELIABILITY_PLAN.md).

Completed:

- Step 1: stable system instruction.
- Step 2: dynamic user context in user message.
- Step 3: SDK-enforced JSON response schema.
- Step 4: explicit intent classification.
- Step 5: returned action and selector validation.

Implemented in the current working tree:

- Step 6: planner action-null enforcement and text-only action rejection.
- Step 7: one-action planner/executor loop with fresh observation before replanning.
- Step 8: bounded screenshot fallback and run context; structured logs remain a future improvement.

---

## 19. Known Issues and Risks

1. The extension can still attempt screenshot fallback after some context request errors. It should only use screenshot fallback for context/interpretation failures, not provider quota, authentication, model-not-found, or timeout failures.
2. The popup does not preserve conversation history.
4. The model can still return a technically valid but semantically poor selector.
5. Selector validation only happens against the current page immediately before action execution; it does not prove that the selected element is the intended target.
6. Execute actions are automatic once the user clicks Execute. Destructive-action policy needs stronger local enforcement.
7. The server CORS policy currently allows the request origin broadly for local development. Production deployment needs authentication and a restricted origin policy.
8. The server has terminal logs only, not structured file logs or monitoring.
9. The test page exposes detailed provider errors for local debugging. Do not expose this level of detail in a public deployment.
10. The current model may return temporary 429/503 errors because of provider demand or project quota.
11. A browser popup may close when a navigation occurs, so the UI cannot always display post-navigation state.

---

## 20. Recommended Next Implementation Order

### Next task A: add focused automated behavior coverage

Use the local `/agent-fixture` page to cover planner output validation, safe confirmation, retry bounds, navigation resume, Stop, and fresh-observation replanning.

### Completed: screenshot fallback classification

The extension request helper preserves HTTP status and error stage. It only captures a screenshot for a DOM/interpretation failure. It does not retry with an image for:

- 401
- 403
- 404
- 429
- 503
- 504
- connection failure

### Completed: strengthen action-null rules

The server and extension enforce:

- Summarise requests must have `action: null`.
- `answer` and `summarize` intents should not execute actions.
- Execute mode may execute only a validated action.
- Search intent must use `type` plus `pressEnter: true`.

### Next task D: improve navigation state

Add a persistent extension state mechanism or content script so navigation results can update after the popup closes and reopens.

### Next task E: add local test pages

Create a harmless local HTML fixture with:

- Search form
- Text input
- Button
- Long scrollable content
- Internal links
- Back/forward navigation

Use it for repeatable action tests without touching real accounts or websites.

### Next task F: add request cancellation

Add an AbortController or UI cancellation path so users can stop a slow request before the 30-second timeout.

### Next task G: improve action validation

Validate:

- Selector resolves to exactly one element.
- Element is visible.
- Element is inside the active document.
- URL is allowed by domain policy.
- Click target is not disabled.
- Type target is not readonly or disabled.

### Next task H: add structured logs

Log request ID, intent, model, timing, fallback usage, provider status, and action type without logging secrets or full sensitive page text.

---

## 21. Safe Testing Checklist

Use the diagnostics page:

```text
http://localhost:3001/test
```

Use the unpacked extension on a harmless page.

Test these first:

1. Summarise a simple article.
2. Use **Execute** with `google kangaroos in australia` and confirm it opens Google directly.
3. Use `find kangaroo on this page` and confirm the text is highlighted locally.
4. Execute typing into a local test input.
5. Scroll a long page.
6. Navigate to a safe URL.
7. Use back, forward, and reload.
8. Stop the server and confirm the popup displays a readable error.
9. Test an invalid/stale selector.
10. Test a `chrome://` page and confirm it is rejected.
11. Trigger the 30-second timeout only when necessary; do not repeatedly retry quota-exhausted requests.

Do not test with:

- Purchases
- Account changes
- Deletion
- Message sending
- Public posting
- Credential fields
- Real sensitive data

---

## 22. Handoff Instructions for the Next Model

Before editing:

1. Read this document.
2. Read [AGENT_RELIABILITY_PLAN.md](AGENT_RELIABILITY_PLAN.md).
3. Inspect `git status --short`.
4. Read the current `server.ts` and `extension/popup.js`.
5. Do not assume the previous server process is still running; check port `3001`.
6. Do not print or copy `.env` secrets.
7. Reload the unpacked extension after manifest, sidebar, background worker, or popup changes.
8. Configure the keyboard shortcut at `chrome://extensions/shortcuts` if the suggested key conflicts with another extension.

After editing:

1. Run `get_errors` on `server.ts`.
2. Run `node --check server.ts`.
3. Run `node --check extension/popup.js`.
4. Start the server with `npm run server`.
5. Check `GET /health` and `GET /api/diagnostics`.
6. Run the smallest behavior test for the changed feature.
7. Update the plan/documentation.
8. Commit and push only when explicitly requested.

For the current UI features, verify these manually:

- Popup opens on a normal page.
- Pin button opens the side panel.
- `Ctrl+Shift+Y` or `Command+Shift+Y` opens the popup; the pin button opens the side panel.
- Request and response restore after closing/reopening the popup on the same URL.
- **Copy** copies the current answer.
- `google ...` and `look up ...` open Google locally.
- `search ...` does not use the direct Google shortcut.

The current project is a working version 0 foundation. The next priority should be reliability around action execution, screenshot fallback classification, and safe navigation—not adding more model fallbacks without verified API identifiers and quota availability.
