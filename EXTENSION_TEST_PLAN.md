# AI Powered Browsing Agent
## Experimental Test Plan

This document covers the current browser-extension version only.

## Test Setup

Before testing:

1. Start the local agent service:

   ```bash
   npm run server
   ```

2. Open Chrome or Edge.
3. Visit the extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
4. Enable **Developer mode**.
5. Choose **Load unpacked** and select the project's `extension/` folder.
6. Open a normal web page such as a news article, documentation page, or simple test page.
7. Pin **AI Powered Browsing Agent** to the browser toolbar.

For every test, record:

- Pass or fail
- Approximate response time
- What the agent returned
- Any unexpected behavior
- Screenshot or console error, if applicable

---

## A. Extension Startup and UI

### Test A1: Extension opens

**Steps**

1. Open a normal website.
2. Click the extension icon.

**Expected result**

- The popup opens.
- The title says **AI Powered Browsing Agent**.
- The popup shows the current page title and URL.
- The request box, **Summarise** button, and **Execute** button are visible.
- A pin/sidebar button is visible.
- No provider name is shown to the user.

### Test A2: Current page metadata updates

**Steps**

1. Open the extension on one website.
2. Close the popup.
3. Navigate to a different website.
4. Open the extension again.

**Expected result**

- The displayed page title and URL match the newly active tab.

### Test A3: Empty request validation

**Steps**

1. Open the popup.
2. Leave the request box empty.
3. Click **Summarise**.

**Expected result**

- No request is sent.
- The popup shows a clear message such as `Write a request first.`
- The request box receives focus.

### Test A4: State survives popup close

**Steps**

1. Enter a request and run **Summarise**.
2. Close the popup.
3. Open the popup again on the same page.

**Expected result**

- The request and latest response are restored.

### Test A5: Copy response

**Steps**

1. Run **Summarise**.
2. Click **Copy** beside the response.
3. Paste into a text editor.

**Expected result**

- The complete answer is copied to the clipboard.

### Test A6: Open persistent sidebar

**Steps**

1. Click the pin/sidebar button in the popup.

**Expected result**

- The browser side panel opens.
- The same agent interface is available without the popup closing when focus changes.

### Test A7: Keyboard shortcut

**Steps**

1. Press `Ctrl+Shift+Y` on Windows/Linux or `Command+Shift+Y` on macOS.

**Expected result**

- The AI browsing agent side panel opens for the active tab.

---

## B. Text and Page Understanding

### Test B1: Basic page summary

**Steps**

1. Open an article or documentation page.
2. Use **Summarise** so no browser action is allowed.
3. Enter: `Summarize this page in three bullet points.`
4. Click **Summarise**.

**Expected result**

- The agent returns a text response.
- The response reflects the visible page content.
- No browser action is performed.
- The result appears inside the extension popup.

### Test B2: Find information in page text

**Steps**

1. Open a page containing a clearly visible price, date, or heading.
2. Ask: `What is the price shown on this page?`

**Expected result**

- The response identifies the requested information.
- No screenshot is needed for a simple text-based task.
- The browser page remains unchanged.

### Test B3: Use selected text

**Steps**

1. Select a paragraph on a web page.
2. Open the extension.
3. Ask: `Explain the selected text in simple language.`

**Expected result**

- The response focuses on the selected text.
- The rest of the page does not incorrectly dominate the answer.

### Test B4: Text-only mode

**Steps**

1. Use **Summarise**.
2. Ask: `Find the main call-to-action button and tell me what it says.`

**Expected result**

- The agent provides the answer as text.
- No click, typing, scrolling, or navigation occurs.
- The page stays unchanged.

---

## C. DOM-First Performance

### Test C1: Local Google shortcut

**Steps**

1. Use **Execute**.
2. Enter `google kangaroos in australia`.

**Expected result**

- The extension opens Google with the encoded query.
- No DOM scan, screenshot, or model request is needed.

### Test C2: DOM-first request

**Steps**

1. Open a page with headings, links, buttons, and form fields.
2. Ask: `List the main buttons and links on this page.`
3. Watch the status message.

**Expected result**

- The status initially indicates that the page structure is being read.
- The agent returns an answer without requiring a screenshot.
- The response is faster than a screenshot-based request on the same page.

### Test C3: Large or complex page

**Steps**

1. Open a long page with many sections and controls.
2. Ask: `Find the section about pricing.`

**Expected result**

- The extension remains responsive.
- The request completes using the bounded page text and DOM snapshot.
- The response does not contain an unreasonably large payload or crash.

### Test C4: Screenshot fallback

**Steps**

1. Use a page where visual layout matters, such as a chart, image-heavy page, or visual card layout.
2. Ask: `Describe the visual layout of this page.`

**Expected result**

- The extension first attempts structure-based analysis.
- If structure is insufficient, the status changes to a visual fallback message.
- A screenshot is captured and the request is retried.
- The final response uses visual information.

Record whether fallback occurred and how long the full request took.

---

## D. Automatic Browser Actions

Only use harmless test pages or a local HTML test page for these tests.

### Test D1: Automatic scroll

**Steps**

1. Open a long page.
2. Click **Execute**.
3. Ask: `Scroll down to the next section.`

**Expected result**

- The agent returns a scroll action.
- The page scrolls automatically.
- The popup reports that the action was performed automatically.

### Test D2: Automatic click

**Steps**

1. Open a page with a harmless button such as `Show details`.
2. Click **Execute**.
3. Ask: `Click the Show details button.`

**Expected result**

- The correct button is clicked.
- The page changes as expected.
- The popup records or displays the performed action.

### Test D3: Automatic typing

**Steps**

1. Use a harmless local test form.
2. Click **Execute**.
3. Ask: `Type test value into the name field.`

**Expected result**

- The correct input receives the text.
- Input and change events are triggered.
- No form is submitted automatically.

### Test D4: Automatic URL navigation

**Steps**

1. Open a harmless page with a known link.
2. Click **Execute**.
3. Ask: `Open the documentation link.`

**Expected result**

- The active tab navigates to the intended URL.
- The URL is correct.

### Test D5: Search a mail in Gmail

**Steps**

1. Open Gmail with a test account and no sensitive messages visible.
2. Click **Execute** and ask: `Search Gmail for the subject quarterly test.`

**Expected result**

- The DOM snapshot includes the visible Gmail search control with its accessible name or placeholder and a unique selector.
- The agent fills the search field, replacing any previous query, and submits it.
- No message is opened, sent, or changed.

### Test D6: Open the first organic Google result

**Steps**

1. Open a Google results page for a harmless query.
2. Click **Execute** and ask: `Open the first organic search result.`

**Expected result**

- The snapshot includes result link text and its destination, including text nested inside the link.
- The agent clicks the first organic result, not an advertisement or navigation link.
- The resulting destination matches the link shown in the snapshot.

Do not test purchases, account changes, message sending, deletion, or form submission with automatic mode enabled.

### Test D8: Planner, action, fresh observation, and replan

**Setup**

1. Open `http://localhost:3001/agent-fixture`.
2. Use **Execute** with a multi-step request such as: `Show the fixture detail, then search for cedar, then open the Cedar tree care guide.`

**Expected result**

- The progress area shows the goal, plan, and current step.
- Each action is followed by a fresh page observation before another action is selected.
- The detail text appears, fixture search results update, and the Cedar link is opened in order.
- Closing the popup and reopening it allows the run to be resumed from the latest page state.
- **Stop** prevents further steps. No run executes more than 10 actions or retries a failed/unverified step more than twice.

### Test D9: Consequential action confirmation

Use a harmless fixture or mock page with a control labeled `Delete item` (do not connect it to real data). Confirm that the action pauses for explicit user confirmation and that **Stop** cancels it.

### Test D7: Automatic mode disabled

**Steps**

1. Use **Summarise**.
2. Ask for an action, such as: `Click the Show details button.`

**Expected result**

- The answer is shown as text and no action is performed.
- No action is performed.
- The page remains unchanged.

---

## E. Restricted Pages and Permissions

### Test E1: Browser-internal page

**Steps**

1. Open `chrome://extensions` or `edge://extensions`.
2. Click the extension icon.
3. Try to analyze the page.

**Expected result**

- The extension reports that the page cannot be captured.
- No unhandled error appears.

### Test E2: Permission reload

**Steps**

1. Reload the unpacked extension from the extensions page.
2. Open a normal website.
3. Open the extension and run a summary request.

**Expected result**

- The extension still has access to the active tab.
- Page title, DOM, and response work normally.

### Test E3: Popup close during request

**Steps**

1. Start a request.
2. Close the popup while it is processing.
3. Reopen the extension.

**Expected result**

- The browser does not become unstable.
- No page action occurs unexpectedly.
- Any request cancellation or loss of popup state is documented as expected version 0 behavior.

---

## F. Error Handling and Recovery

### Test F1: Server stopped

**Steps**

1. Stop the local server.
2. Open the extension.
3. Submit a request.

**Expected result**

- The popup shows a readable connection or agent error.
- It does not show `Unexpected end of JSON input`.
- The popup becomes usable again after the error.

### Test F2: Server restarted

**Steps**

1. Start the server again.
2. Reload the extension if needed.
3. Submit the same request.

**Expected result**

- The request succeeds without reinstalling the extension.

### Test F3: Invalid or incomplete response

**Steps**

1. Use a test server response that is empty or not JSON, if available.
2. Submit a request.

**Expected result**

- The popup displays a clear invalid-response error.
- The UI does not crash.
- The Analyze button becomes enabled again.

### Test F4: Stale selector

**Steps**

1. Ask the agent to act on a harmless page element.
2. Change or remove that element before the action executes.
3. Submit the request with automatic mode enabled.

**Expected result**

- The action fails with a readable message.
- No unrelated element is changed.

### Test F5: Large page context stays bounded

**Steps**

1. Open a long page with many links and paragraphs.
2. Submit a task that mentions a distinctive phrase appearing in a later section.
3. Inspect the request payload in local DevTools, avoiding any private page content in shared logs.

**Expected result**

- The request contains only the current task, not prior popup requests or answers.
- Page text contains a small set of relevant excerpts, not the full page.
- The DOM snapshot is capped at 5,000 characters and prioritizes fields and relevant links.
- No repeated context accumulates across requests.

---

## G. Privacy and Product Identity

### Test G1: Provider-neutral UI

**Steps**

1. Open the extension popup.
2. Inspect the popup title, visible text, tooltip, and extension name.

**Expected result**

- The user-facing name is **AI Powered Browsing Agent**.
- No provider name appears in the extension UI.

### Test G2: API key is not in extension package

**Steps**

1. Inspect the `extension/` folder.
2. Search its files for `API_KEY`, `GEMINI_API_KEY`, or the actual secret.

**Expected result**

- No private API key is present in the extension package.

### Test G3: Popup keyboard shortcut

**Steps**

1. Reload the unpacked extension after changing the manifest.
2. Open `chrome://extensions/shortcuts` and confirm the AI Powered Browsing Agent action is assigned `Ctrl+Shift+Y` (or assign an available shortcut).
3. Focus a normal browser tab and press the assigned shortcut.

**Expected result**

- The extension popup opens. The pin button remains the path to the side panel.
- If the command is unassigned, resolve the shortcut in the browser's shortcuts page.
- The extension calls the local agent endpoint instead.

### Test G3: Page data scope

**Steps**

1. Open a page containing text outside the visible viewport.
2. Run a normal analysis.
3. Record what content the agent can identify.

**Expected result**

- The DOM and bounded text are used first.
- Screenshot fallback covers only the visible viewport.
- The limitation is clearly reported if the requested content is outside the available context.

---

## Suggested Tech Lead Summary

Use this short summary after running the tests:

```text
The version 0 browser-agent extension was tested across startup, page metadata, text understanding, selected text, DOM-first processing, screenshot fallback, text-only mode, automatic click/type/scroll/navigation actions, restricted browser pages, server recovery, malformed responses, stale selectors, provider-neutral branding, and API-key isolation.

Overall result: [PASS / PASS WITH ISSUES / FAIL]

Passed tests: [number]
Failed tests: [number]
Not tested: [number]

Main observations:
- [observation]
- [observation]
- [observation]

Recommended next step:
- [next improvement]
```

## Result Table

| Test ID | Result | Response time | Notes |
|---|---|---:|---|
| A1 | Not run | | |
| A2 | Not run | | |
| A3 | Not run | | |
| B1 | Not run | | |
| B2 | Not run | | |
| B3 | Not run | | |
| B4 | Not run | | |
| C1 | Not run | | |
| C2 | Not run | | |
| C3 | Not run | | |
| D1 | Not run | | |
| D2 | Not run | | |
| D3 | Not run | | |
| D4 | Not run | | |
| D5 | Not run | | |
| E1 | Not run | | |
| E2 | Not run | | |
| E3 | Not run | | |
| F1 | Not run | | |
| F2 | Not run | | |
| F3 | Not run | | |
| F4 | Not run | | |
| G1 | Not run | | |
| G2 | Not run | | |
| G3 | Not run | | |
