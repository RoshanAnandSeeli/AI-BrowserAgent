const API_URL = 'http://localhost:3001/api/agent';
const requestInput = document.querySelector('#request');
const askButton = document.querySelector('#ask');
const autoActions = document.querySelector('#auto-actions');
const status = document.querySelector('#status');
const result = document.querySelector('#result');
const answer = document.querySelector('#answer');
const actionWrap = document.querySelector('#action-wrap');
const actionCode = document.querySelector('#action');
let suggestedAction = null;
let activeTabId = null;

function setStatus(message, isError = false) { status.textContent = message; status.style.color = isError ? '#f29b9b' : ''; }

async function getActiveTab() {
	const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
	const tab = tabs[0];
	if (!tab?.id) throw new Error('No active browser tab was found.');
	if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('edge://')) throw new Error('This browser page does not allow extensions to capture it.');
	return tab;
}

async function getPageContext(tabId) {
	const [context] = await chrome.scripting.executeScript({ target: { tabId }, func: () => {
		const clean = (value) => value.replace(/\s+/g, ' ').trim();
		const selectorFor = (element) => {
			if (element.id) return `#${CSS.escape(element.id)}`;
			const testId = element.getAttribute('data-testid');
			if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
			return element.tagName.toLowerCase();
		};
		const lines = [];
		const important = new Set(['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'H1', 'H2', 'H3', 'LABEL', 'FORM', 'NAV', 'MAIN', 'ARTICLE', 'SECTION']);
		const walk = (element, depth) => {
			if (lines.length >= 900 || depth > 14) return;
			const text = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => clean(node.textContent ?? '')).filter(Boolean).join(' ').slice(0, 180);
			if (important.has(element.tagName) || text) {
				const attrs = ['aria-label', 'placeholder', 'name', 'type', 'role'].map((name) => element.getAttribute(name) ? `${name}="${clean(element.getAttribute(name))}"` : '').filter(Boolean).join(' ');
				const selector = ['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) ? ` selector="${selectorFor(element)}"` : '';
				lines.push(`${'  '.repeat(Math.min(depth, 8))}<${element.tagName.toLowerCase()}${attrs ? ` ${attrs}` : ''}${selector}>${text ? ` ${text}` : ''}`);
			}
			[...element.children].forEach((child) => walk(child, depth + 1));
		};
		if (document.body) walk(document.body, 0);
		return { title: document.title, url: location.href, selection: window.getSelection()?.toString() ?? '', text: document.body?.innerText?.slice(0, 12000) ?? '', domSnapshot: lines.join('\n').slice(0, 30000) };
	}});
	return context.result;
}

function dataUrlParts(dataUrl) { const [header, data] = dataUrl.split(',', 2); return { mimeType: header.match(/data:(.*?);/)?.[1] ?? 'image/png', data }; }

async function requestAgent(payload) {
	const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
	const text = await response.text();
	let data;
	try { data = text ? JSON.parse(text) : {}; } catch { throw new Error(`Agent server returned an invalid response (${response.status}).`); }
	if (!response.ok) throw new Error(data.error ?? 'Agent request failed.');
	if (typeof data.answer !== 'string' || !data.answer.trim()) throw new Error('The agent returned no usable answer.');
	return data;
}

async function askAgent() {
	const request = requestInput.value.trim();
	if (!request) { setStatus('Write a request first.', true); requestInput.focus(); return; }
	askButton.disabled = true; result.hidden = true; actionWrap.hidden = true; setStatus('Reading the page structure...');
	try {
		const tab = await getActiveTab();
		activeTabId = tab.id;
		const page = await getPageContext(tab.id);
		document.querySelector('#page-title').textContent = page.title || 'Untitled page';
		document.querySelector('#page-url').textContent = page.url;
		const payload = { request, pageText: `${page.selection}\n${page.text}`, domSnapshot: page.domSnapshot, allowActions: autoActions.checked };
		let data;
		try { data = await requestAgent(payload); } catch (firstError) {
			setStatus('Structure was not enough. Capturing a visual fallback...');
			const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
			data = await requestAgent({ ...payload, image: dataUrlParts(screenshot) });
		}
		answer.textContent = data.answer;
		suggestedAction = autoActions.checked ? data.action ?? null : null;
		if (suggestedAction) {
			actionCode.textContent = `Action performed automatically:\n${JSON.stringify(suggestedAction, null, 2)}`;
			actionWrap.hidden = false;
			await performAction(suggestedAction);
			setStatus('Analysis complete. The AI action was performed automatically.');
		} else setStatus('Analysis complete.');
		result.hidden = false;
	} catch (error) { setStatus(error instanceof Error ? error.message : 'Something went wrong.', true); }
	finally { askButton.disabled = false; }
}

async function performAction(action) {
	if (!activeTabId) return;
	if (action.type === 'open_url' && action.url) { await chrome.tabs.update(activeTabId, { url: action.url }); return; }
	await chrome.scripting.executeScript({ target: { tabId: activeTabId }, args: [action], func: (browserAction) => {
		if (browserAction.type === 'scroll') { window.scrollBy({ top: Number(browserAction.amount) || 600, behavior: 'smooth' }); return; }
		const element = browserAction.selector ? document.querySelector(browserAction.selector) : null;
		if (!element) throw new Error('The suggested element is no longer on the page.');
		if (browserAction.type === 'click') element.click();
		if (browserAction.type === 'type') { element.focus(); element.value = browserAction.text ?? ''; element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); }
	}});
}

askButton.addEventListener('click', askAgent);
requestInput.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') askAgent(); });
getActiveTab().then((tab) => { activeTabId = tab.id; document.querySelector('#page-title').textContent = tab.title || 'Current page'; document.querySelector('#page-url').textContent = tab.url || ''; }).catch((error) => setStatus(error.message, true));
