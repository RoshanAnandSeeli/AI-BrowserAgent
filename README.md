# AI Powered Browsing Agent

This repository contains version 0 of the **AI Powered Browsing Agent**, a Chrome/Edge Manifest V3 extension that reads the active page and helps the user complete browser tasks.

## Project Structure

```text
extension/
|-- manifest.json
|-- popup.html
|-- popup.css
|-- popup.js
|-- sidebar.html
`-- background.js
server.ts
.env
.env.example
ACHIEVEMENTS.md
EXTENSION_TEST_PLAN.md
```

## Run the Agent Service

Install dependencies:

```bash
npm install
```

Configure the local environment in `.env`:

```env
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=qwen/qwen3.8-27b
GROQ_REQUEST_TIMEOUT_MS=30000
PORT=3001
```

Start the service:

```bash
npm run server
```

The extension expects the agent endpoint at:

```text
http://localhost:3001/api/agent
```

The server logs appear in the terminal running `npm run server`. The project does not currently write logs to a file.

## Load the Extension

1. Open Chrome or Edge.
2. Visit `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the project's `extension/` folder.
6. Pin **AI Powered Browsing Agent** and open it on a normal web page.

## Current Agent Flow

1. The user enters a request in the extension popup.
2. The extension refreshes the active page title and URL and classifies common tasks locally.
3. Search, find-on-page, scroll, back, forward, reload, and direct URL navigation run locally without a model request.
4. **Summarise** sends unresolved requests for a text-only response.
5. **Execute** starts a bounded planner/executor loop: the model proposes one current action, the extension validates and performs it, then observes the changed page before asking for the next action.
6. Semantic requests capture a compact DOM snapshot; visual wording captures an image up front.
7. The run shows its plan and progress, can be stopped, and can be resumed after reopening the popup. Consequential actions pause for user confirmation.

The normal request is DOM-first. Each request contains only the current task, not prior conversation history. Page text is reduced to a few request-relevant snippets, and the DOM snapshot prioritizes visible controls and links within a strict size budget. A request contains:

- The user's request
- Up to 1,800 characters of page title, URL, selected text, and relevant excerpts
- Selected text, when present
- A compact DOM snapshot capped at 5,000 characters, prioritizing interactive-element selectors
- `allowActions: false` or `allowActions: true`

The screenshot is sent for explicitly visual requests or during an eligible fallback retry.

Execute runs allow at most 10 actions and 2 retries for an unverified or failed step. Only the current task, a short summary of this run, and the latest bounded page observation are sent to the model. The extension stores active run state in `chrome.storage.session`; popup state and per-tab request/response state remain in `chrome.storage.local`.

For repeatable action checks, open `http://localhost:3001/agent-fixture`. It provides a local search form, safe links, a state-changing button, and long content for scroll/observation tests.

Routine web searches are handled locally by opening an encoded Google search URL, so they do not use model quota or depend on search-box Enter behavior.

The direct Google shortcut intentionally recognizes `google ...` and `look up ...`; the keyword `search` is reserved for site-specific or model-assisted requests.

The popup state is stored per tab, so the request and latest response survive closing and reopening the popup while the page URL is unchanged. `Ctrl+Shift+Y` opens the popup on Windows/Linux, and `Command+Shift+Y` opens it on macOS. Use the pin button to open the persistent browser sidebar. Shortcuts can be checked or changed at `chrome://extensions/shortcuts`.

Use **Copy** beside the response heading to copy the current summary or answer.

Supported actions:

- `click`
- `type`
- `scroll`
- `open_url`
- `navigate`
- `back`
- `forward`
- `reload`

Search requests use a specific input selector, type the value through input events, and dispatch Enter key events so page search handlers can run.

## Safety Notes

- The API key remains on the local server and is not included in the extension package.
- Use a test page for automatic actions.
- Do not test purchases, deletion, account changes, or message sending with automatic actions enabled.
- Browser-internal pages such as `chrome://` cannot be inspected.
- Review [EXTENSION_TEST_PLAN.md](EXTENSION_TEST_PLAN.md) before reporting results.

## Troubleshooting

### Port 3001 is already in use

Only one server process should run at a time. Stop the existing process or close the terminal running `npm run server`, then start it again.

### The popup cannot inspect the page

Browser-internal pages such as `chrome://extensions`, `edge://extensions`, and other protected pages do not allow extension script access. Test on a normal website.

### The extension shows a connection error

Confirm that the server is running and listening on port `3001`:

```bash
npm run server
```

Then reload the unpacked extension from the browser extensions page.

### Execute does not run an action

Use **Execute** instead of **Summarise**. Summarise intentionally requests a text-only response.

### The model is busy or quota-limited

The server uses Groq with one configured model and returns a concise retry message for temporary `429` or `503` provider responses. The request timeout is controlled by `GROQ_REQUEST_TIMEOUT_MS`.
