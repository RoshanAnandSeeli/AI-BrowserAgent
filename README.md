# AI Powered Browsing Agent

This repository contains version 0 of the **AI Powered Browsing Agent**, a Chrome/Edge Manifest V3 extension that reads the active page and helps the user complete browser tasks.

## Project Structure

```text
extension/
|-- manifest.json
|-- popup.html
|-- popup.css
`-- popup.js
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
GEMINI_API_KEY=your_api_key_here
GEMINI_MODEL=gemini-3.6-flash
# Optional fallback after a temporary 429/503 response.
GEMINI_FALLBACK_MODEL=
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
2. The extension refreshes the active page title and URL, then captures a compact DOM snapshot, page text, and selected text.
3. **Summarise** requests a text-only response.
4. **Execute** permits one browser action, including typing into a field and pressing Enter for searches.
5. If the DOM-first request fails, the extension captures the visible viewport and retries with image context.
6. Page metadata is refreshed again after navigation when the popup remains open.

The normal request is DOM-first. A request contains:

- The user's request
- A bounded page-text extract
- Selected text, when present
- A compact DOM snapshot with interactive-element selectors
- `allowActions: false` or `allowActions: true`

The screenshot is sent only during the fallback retry.

Supported actions:

- `click`
- `type`
- `scroll`
- `open_url`

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

The server can try `GEMINI_FALLBACK_MODEL` after temporary `429` or `503` responses. Fallback models may still share the same project quota. The extension displays a short retry message instead of the full provider stack trace.
