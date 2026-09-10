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
- The request box, checkbox, and **Analyze page** button are visible.
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
3. Click **Analyze page**.

**Expected result**

- No request is sent.
- The popup shows a clear message such as `Write a request first.`
- The request box receives focus.

---

## B. Text and Page Understanding

### Test B1: Basic page summary

**Steps**

1. Open an article or documentation page.
2. Leave **Automatically perform AI actions** unchecked.
3. Enter: `Summarize this page in three bullet points.`
4. Click **Analyze page**.

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

1. Ensure **Automatically perform AI actions** is unchecked.
2. Ask: `Find the main call-to-action button and tell me what it says.`

**Expected result**

- The agent provides the answer as text.
- No click, typing, scrolling, or navigation occurs.
- The page stays unchanged.

---

## C. DOM-First Performance

### Test C1: DOM-first request

**Steps**

1. Open a page with headings, links, buttons, and form fields.
2. Ask: `List the main buttons and links on this page.`
3. Watch the status message.

**Expected result**

- The status initially indicates that the page structure is being read.
- The agent returns an answer without requiring a screenshot.
- The response is faster than a screenshot-based request on the same page.

### Test C2: Large or complex page

**Steps**

1. Open a long page with many sections and controls.
2. Ask: `Find the section about pricing.`

**Expected result**

- The extension remains responsive.
- The request completes using the bounded page text and DOM snapshot.
- The response does not contain an unreasonably large payload or crash.

### Test C3: Screenshot fallback

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
2. Check **Automatically perform AI actions**.
3. Ask: `Scroll down to the next section.`

**Expected result**

- The agent returns a scroll action.
- The page scrolls automatically.
- The popup reports that the action was performed automatically.

### Test D2: Automatic click

**Steps**

1. Open a page with a harmless button such as `Show details`.
2. Check **Automatically perform AI actions**.
3. Ask: `Click the Show details button.`

**Expected result**

- The correct button is clicked.
- The page changes as expected.
- The popup records or displays the performed action.

### Test D3: Automatic typing

**Steps**

1. Use a harmless local test form.
2. Check **Automatically perform AI actions**.
3. Ask: `Type test value into the name field.`

**Expected result**

- The correct input receives the text.
- Input and change events are triggered.
- No form is submitted automatically.

### Test D4: Automatic URL navigation

**Steps**

1. Open a harmless page with a known link.
2. Check **Automatically perform AI actions**.
3. Ask: `Open the documentation link.`

**Expected result**

- The active tab navigates to the intended URL.
- The URL is correct.

Do not test purchases, account changes, message sending, deletion, or form submission with automatic mode enabled.

### Test D5: Automatic mode disabled

**Steps**

1. Uncheck **Automatically perform AI actions**.
2. Ask for an action, such as: `Click the Show details button.`

**Expected result**

- The answer is shown as text.
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
