const API_URL = 'http://localhost:3001/api/agent';
const requestInput = document.querySelector('#request');
const summariseButton = document.querySelector('#summarise');
const executeButton = document.querySelector('#execute');
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

function updatePageDetails(tab) {
	document.querySelector('#page-title').textContent = tab.title || 'Untitled page';
	document.querySelector('#page-url').textContent = tab.url || '';
}

async function getPageContext(tabId) {
	const [context] = await chrome.scripting.executeScript({ target: { tabId }, func: () => {
		const clean = (value) => value.replace(/\s+/g, ' ').trim();
		const selectorFor = (element) => {
			if (element.id) return `#${CSS.escape(element.id)}`;
			const testId = element.getAttribute('data-testid');
			if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
			const parts = [];
			let current = element;
			while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
				let part = current.tagName.toLowerCase();
				if (current.getAttribute('name')) part += `[name="${CSS.escape(current.getAttribute('name'))}"]`;
				const parent = current.parentElement;
				if (parent) {
					const siblings = [...parent.children].filter((child) => child.tagName === current.tagName);
					if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
				}
				parts.unshift(part);
				current = current.parentElement;
			}
			return parts.join(' > ');
		};
		const lines = [];
		const important = new Set(['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'H1', 'H2', 'H3', 'H4', 'LABEL', 'FORM', 'NAV', 'MAIN']);
		const walk = (element, depth) => {
			if (lines.length >= 450 || depth > 12) return;
			const text = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => clean(node.textContent ?? '')).filter(Boolean).join(' ').slice(0, 180);
			const landmark = element.getAttribute('role');
			if (important.has(element.tagName) || ['banner', 'navigation', 'main', 'search', 'complementary', 'contentinfo'].includes(landmark)) {
				const attrs = ['aria-label', 'placeholder', 'name', 'type', 'role'].map((name) => element.getAttribute(name) ? `${name}="${clean(element.getAttribute(name))}"` : '').filter(Boolean).join(' ');
				const selector = ['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) ? ` selector="${selectorFor(element)}"` : '';
				lines.push(`${'  '.repeat(Math.min(depth, 8))}<${element.tagName.toLowerCase()}${attrs ? ` ${attrs}` : ''}${selector}>${text ? ` ${text}` : ''}`);
			}
			[...element.children].forEach((child) => walk(child, depth + 1));
		};
		if (document.body) walk(document.body, 0);
		return { title: document.title, url: location.href, selection: window.getSelection()?.toString() ?? '', text: document.body?.innerText?.slice(0, 8000) ?? '', domSnapshot: lines.join('\n').slice(0, 16000) };
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

async function askAgent(allowActions) {
	const request = requestInput.value.trim();
	if (!request) { setStatus('Write a request first.', true); requestInput.focus(); return; }
	summariseButton.disabled = true; executeButton.disabled = true; result.hidden = true; actionWrap.hidden = true; setStatus('Reading page...');
	try {
		const tab = await getActiveTab();
		activeTabId = tab.id;
		updatePageDetails(tab);
		const page = await getPageContext(tab.id);
		updatePageDetails({ title: page.title, url: page.url });
		const payload = { request, pageText: `${page.selection}\n${page.text}`, domSnapshot: page.domSnapshot, allowActions };
		let data;
		try { data = await requestAgent(payload); } catch (firstError) {
			setStatus('Using visual fallback...');
			const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
			data = await requestAgent({ ...payload, image: dataUrlParts(screenshot) });
		}
		answer.textContent = data.answer;
		suggestedAction = allowActions ? data.action ?? null : null;
		if (suggestedAction) {
			actionCode.textContent = JSON.stringify(suggestedAction, null, 2);
			actionWrap.hidden = false;
			await performAction(suggestedAction);
			setStatus('Done.');
		} else setStatus(allowActions ? 'Done. No action was needed.' : 'Done.');
		result.hidden = false;
	} catch (error) { setStatus(error instanceof Error ? error.message : 'Request failed.', true); }
	finally { summariseButton.disabled = false; executeButton.disabled = false; }
}

async function performAction(action) {
	if (!activeTabId) return;
	if (action.type === 'open_url' && action.url) { await chrome.tabs.update(activeTabId, { url: action.url }); return; }
	await chrome.scripting.executeScript({ target: { tabId: activeTabId }, args: [action], func: async (browserAction) => {
		if (browserAction.type === 'scroll') { window.scrollBy({ top: Number(browserAction.amount) || 600, behavior: 'smooth' }); return; }
		const element = browserAction.selector ? document.querySelector(browserAction.selector) : null;
		if (!element) throw new Error('The suggested element is no longer on the page.');
		if (browserAction.type === 'click') element.click();
		if (browserAction.type === 'type') {
			element.focus();
			const valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
			for (const character of browserAction.text ?? '') {
				if (valueSetter) valueSetter.call(element, element.value + character);
				else element.value += character;
				element.dispatchEvent(new InputEvent('input', { bubbles: true, data: character, inputType: 'insertText' }));
				await new Promise((resolve) => setTimeout(resolve, 18));
			}
			if (browserAction.pressEnter) {
				element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
				element.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
				element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
			}
			element.dispatchEvent(new Event('change', { bubbles: true }));
		}
	}});
}

summariseButton.addEventListener('click', () => askAgent(false));
executeButton.addEventListener('click', () => askAgent(true));
requestInput.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') askAgent(false); });
getActiveTab().then((tab) => { activeTabId = tab.id; updatePageDetails(tab); }).catch((error) => setStatus(error.message, true));
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
	if (tabId === activeTabId && changeInfo.status === 'complete') updatePageDetails(tab);
});
