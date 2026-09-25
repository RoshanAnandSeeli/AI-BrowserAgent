const API_URL = 'http://localhost:3001/api/agent';
const PLANNER_URL = 'http://localhost:3001/api/agent/next';
const requestInput = document.querySelector('#request');
const summariseButton = document.querySelector('#summarise');
const executeButton = document.querySelector('#execute');
const pinButton = document.querySelector('#pin');
const copyButton = document.querySelector('#copy');
const status = document.querySelector('#status');
const result = document.querySelector('#result');
const answer = document.querySelector('#answer');
const actionWrap = document.querySelector('#action-wrap');
const actionCode = document.querySelector('#action');
const progressSection = document.querySelector('#agent-progress');
const agentGoal = document.querySelector('#agent-goal');
const agentPlan = document.querySelector('#agent-plan');
const currentStepText = document.querySelector('#agent-current-step');
const stopAgentButton = document.querySelector('#stop-agent');
const resumeAgentButton = document.querySelector('#resume-agent');
const confirmAgentButton = document.querySelector('#confirm-agent');
let suggestedAction = null;
let activeTabId = null;
let activeRunState = null;
let activeRunId = 0;
let activeController = null;
const MAX_AGENT_STEPS = 10;
const MAX_STEP_RETRIES = 2;
const MAX_NO_ACTION_STEPS = 2;
const EXECUTABLE_ACTION_TYPES = new Set(['click', 'type', 'scroll', 'navigate', 'back', 'forward', 'reload']);

function stateKey(tabId) { return `agent-state-${tabId}`; }
function agentStateKey(tabId) { return `agent-run-${tabId}`; }

async function saveState() {
	if (!activeTabId) return;
	await chrome.storage.local.set({ [stateKey(activeTabId)]: {
		url: document.querySelector('#page-url').textContent,
		title: document.querySelector('#page-title').textContent,
		request: requestInput.value,
		answer: answer.textContent,
		action: suggestedAction,
		resultVisible: !result.hidden,
	} });
}

async function restoreState(tab) {
	const stored = (await chrome.storage.local.get(stateKey(tab.id)))[stateKey(tab.id)];
	if (!stored || stored.url !== tab.url) return;
	requestInput.value = stored.request || '';
	if (stored.answer && stored.resultVisible) {
		answer.textContent = stored.answer;
		suggestedAction = stored.action || null;
		if (suggestedAction) {
			actionCode.textContent = JSON.stringify(suggestedAction, null, 2);
			actionWrap.hidden = false;
		}
		result.hidden = false;
		setStatus('Restored previous result.');
	}
}

async function saveAgentRun() {
	if (!activeTabId || !activeRunState) return;
	await chrome.storage.session.set({ [agentStateKey(activeTabId)]: activeRunState });
}

function renderAgentRun() {
	if (!progressSection) return;
	progressSection.hidden = !activeRunState;
	if (!activeRunState) return;
	agentGoal.textContent = activeRunState.goal;
	agentPlan.replaceChildren();
	for (const step of activeRunState.steps ?? []) {
		const item = document.createElement('li');
		item.dataset.state = step.status;
		item.textContent = `${step.status === 'completed' ? '✓' : step.status === 'failed' ? '×' : '•'} ${step.description}`;
		agentPlan.append(item);
	}
	for (const description of (activeRunState.plan ?? []).slice(0, 6)) {
		if ((activeRunState.steps ?? []).some((step) => step.description === description && step.status === 'completed')) continue;
		const item = document.createElement('li');
		item.dataset.state = 'pending';
		item.textContent = `◦ ${description}`;
		agentPlan.append(item);
	}
	currentStepText.textContent = activeRunState.currentStep?.description
		? `${activeRunState.status === 'waiting_confirmation' ? 'Needs confirmation: ' : activeRunState.paused ? 'Paused: ' : 'Current step: '}${activeRunState.currentStep.description}`
		: activeRunState.status === 'completed' ? 'Goal complete.' : activeRunState.status === 'failed' ? 'Agent stopped after an error.' : activeRunState.status === 'cancelled' ? 'Agent stopped by user.' : 'Preparing the next step…';
	resumeAgentButton.hidden = activeRunState.status !== 'running' || !activeRunState.paused;
	confirmAgentButton.hidden = activeRunState.status !== 'waiting_confirmation';
	stopAgentButton.hidden = !['running', 'waiting_confirmation'].includes(activeRunState.status);
	const busy = activeRunState.status === 'running' && !activeRunState.paused;
	executeButton.disabled = busy;
	summariseButton.disabled = busy;
}

async function restoreAgentRun(tab) {
	const stored = (await chrome.storage.session.get(agentStateKey(tab.id)))[agentStateKey(tab.id)];
	if (!stored) return;
	activeRunState = stored;
	requestInput.value = activeRunState.goal;
	if (activeRunState.status === 'running') activeRunState.paused = true;
	if (activeRunState.lastResult || activeRunState.summary) {
		answer.textContent = activeRunState.lastResult || activeRunState.summary;
		result.hidden = false;
	}
	renderAgentRun();
	if (activeRunState.status === 'running') setStatus('Agent state restored. Resume to inspect the current page and continue.');
	else if (activeRunState.status === 'waiting_confirmation') setStatus('Agent is waiting for your confirmation.');
}

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

function classifyLocalTask(request) {
	const normalized = request.trim();
	const searchMatch = normalized.match(/^(?:google|look up)\s+(.+)$/i);
	if (searchMatch) return { type: 'search', query: searchMatch[1].trim() };

	const findMatch = normalized.match(/^(?:find|locate)\s+(?:"([^"]+)"|(.+?))(?:\s+on this page)?$/i);
	if (findMatch && /\bon this page\b/i.test(normalized)) return { type: 'find', text: (findMatch[1] || findMatch[2]).trim() };
	if (/^(?:go )?back(?: to the previous page)?$/i.test(normalized)) return { type: 'back' };
	if (/^(?:go )?forward(?: to the next page)?$/i.test(normalized)) return { type: 'forward' };
	if (/^(?:reload|refresh)(?: the page)?$/i.test(normalized)) return { type: 'reload' };
	if (/^(?:scroll|go)\s+(?:down|lower)$/i.test(normalized)) return { type: 'scroll', amount: 650 };
	if (/^(?:scroll|go)\s+up$/i.test(normalized)) return { type: 'scroll', amount: -650 };
	if (/^go\s+to\s+https?:\/\/\S+$/i.test(normalized)) return { type: 'navigate', url: normalized.replace(/^go\s+to\s+/i, '') };
	if (/^https?:\/\/\S+$/i.test(normalized)) return { type: 'navigate', url: normalized };
	return null;
}

function wantsVisualContext(request) {
	return /screenshot|screen|image|visual|appearance|layout|chart|graph|diagram|color|look like/i.test(request);
}

async function performLocalTask(task) {
	if (task.type === 'search') {
		await chrome.tabs.update(activeTabId, { url: `https://www.google.com/search?q=${encodeURIComponent(task.query)}` });
		return `Searching Google for "${task.query}".`;
	}
	if (task.type === 'navigate') {
		const destination = new URL(task.url);
		if (!['http:', 'https:'].includes(destination.protocol)) throw new Error('Navigation is limited to http and https URLs.');
		await chrome.tabs.update(activeTabId, { url: destination.href });
		return `Opening ${destination.href}.`;
	}
	if (task.type === 'back') { await chrome.tabs.goBack(activeTabId); return 'Going back to the previous page.'; }
	if (task.type === 'forward') { await chrome.tabs.goForward(activeTabId); return 'Going forward to the next page.'; }
	if (task.type === 'reload') { await chrome.tabs.reload(activeTabId); return 'Reloading the current page.'; }
	if (task.type === 'scroll') {
		await chrome.scripting.executeScript({ target: { tabId: activeTabId }, args: [task.amount], func: (amount) => window.scrollBy({ top: amount, behavior: 'smooth' }) });
		return task.amount > 0 ? 'Scrolling down.' : 'Scrolling up.';
	}
	if (task.type === 'find') {
		const [result] = await chrome.scripting.executeScript({
			target: { tabId: activeTabId },
			args: [task.text],
			func: (text) => ({ found: window.find(text), text }),
		});
		if (!result.result?.found) throw new Error(`Could not find "${task.text}" on this page.`);
		return `Found and highlighted "${task.text}" on this page.`;
	}
	throw new Error('Unsupported local browser task.');
}

async function getPageContext(tabId, request) {
	const [context] = await chrome.scripting.executeScript({ target: { tabId }, args: [request], func: (requestText) => {
		const clean = (value) => value.replace(/\s+/g, ' ').trim();
		const stopWords = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'what', 'where', 'when', 'which', 'who', 'how', 'show', 'find', 'open', 'click', 'select', 'search', 'page', 'site', 'mail', 'gmail', 'google', 'first', 'result', 'please', 'about', 'into', 'using']);
		const terms = [...new Set((requestText.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((term) => !stopWords.has(term)))].slice(0, 14);
		const escapeAttribute = (value) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
		const selectorFor = (element) => {
			const isUnique = (selector) => {
				try { return document.querySelectorAll(selector).length === 1; } catch { return false; }
			};
			if (element.id) {
				const byId = `#${CSS.escape(element.id)}`;
				if (isUnique(byId)) return byId;
			}
			const testId = element.getAttribute('data-testid');
			if (testId) {
				const byTestId = `[data-testid="${escapeAttribute(testId)}"]`;
				if (isUnique(byTestId)) return byTestId;
			}
			const parts = [];
			let current = element;
			while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 14) {
				if (current.id) {
					const ancestorId = `#${CSS.escape(current.id)}`;
					if (isUnique(ancestorId)) return [ancestorId, ...parts].join(' > ');
				}
				const ancestorTestId = current.getAttribute('data-testid');
				if (ancestorTestId) {
					const ancestorSelector = `[data-testid="${escapeAttribute(ancestorTestId)}"]`;
					if (isUnique(ancestorSelector)) return [ancestorSelector, ...parts].join(' > ');
				}
				let part = current.tagName.toLowerCase();
				if (current.getAttribute('name')) part += `[name="${escapeAttribute(current.getAttribute('name'))}"]`;
				const parent = current.parentElement;
				if (parent) {
					const siblings = [...parent.children].filter((child) => child.tagName === current.tagName);
					part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
				}
				parts.unshift(part);
				current = current.parentElement;
				const selector = parts.join(' > ');
				if (isUnique(selector)) return selector;
			}
			return parts.join(' > ');
		};
		const isVisible = (element) => {
			if (element.closest('[aria-hidden="true"]')) return false;
			const style = getComputedStyle(element);
			return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
		};
		const labelFor = (element) => {
			const labelledBy = element.getAttribute('aria-labelledby')?.split(/\s+/).map((id) => document.getElementById(id)?.innerText).filter(Boolean).join(' ');
			const labels = element.labels ? [...element.labels].map((label) => label.innerText).filter(Boolean).join(' ') : '';
			return clean(element.getAttribute('aria-label') || labelledBy || element.getAttribute('placeholder') || element.getAttribute('title') || labels || element.innerText || element.value || element.textContent || '').slice(0, 180);
		};
		const describe = (element) => {
			const role = element.getAttribute('role');
			const linkTitle = element instanceof HTMLAnchorElement ? element.querySelector('h3')?.innerText : '';
			const attrs = [
				['name', labelFor(element).slice(0, 100)], ['role', role], ['type', element.getAttribute('type')],
				['placeholder', element.getAttribute('placeholder')], ['nameAttr', element.getAttribute('name')],
				['resultTitle', linkTitle], ['href', element instanceof HTMLAnchorElement ? element.href.slice(0, 140) : ''],
				['state', element.disabled ? 'disabled' : element.readOnly ? 'readonly' : ''],
			].filter(([, value]) => value).map(([name, value]) => `${name}="${clean(String(value)).slice(0, 140)}"`).join(' ');
			return `<${element.tagName.toLowerCase()} selector="${selectorFor(element)}" ${attrs}>`;
		};
		const addGroup = (query, limit) => {
			const entries = [];
			let count = 0;
			for (const element of document.querySelectorAll(query)) {
				if (count >= limit || !isVisible(element)) continue;
				const line = describe(element);
				if (entries.includes(line)) continue;
				entries.push(line);
				count++;
			}
			return entries;
		};
		// Put text fields and accessible custom controls first so large pages cannot crowd them out.
		const fields = addGroup('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="searchbox"], [role="combobox"]', 55);
		const buttons = addGroup('button, [role="button"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"]', 35);
		const links = addGroup('a[href], [role="link"]', 80);
		const landmarks = addGroup('form, [role="search"], [role="main"], h1, h2, h3, h4', 35);
		const compactGroup = (entries, maxChars, maxItems) => {
			const chosen = [];
			let used = 0;
			for (const line of entries) {
				if (chosen.length >= maxItems) break;
				if (used + line.length > maxChars) continue;
				chosen.push(line);
				used += line.length + 1;
			}
			return chosen;
		};
		const prioritizedFields = fields.map((line, index) => {
			const matches = terms.reduce((total, term) => total + (line.toLowerCase().includes(term) ? 1 : 0), 0);
			const searchField = /search|mail|gmail|textbox|combobox/i.test(line) && /search|mail|gmail/i.test(requestText) ? 2 : 0;
			return { line, index, score: matches + searchField };
		}).sort((a, b) => b.score - a.score || a.index - b.index).map((item) => item.line);
		const rankedLinks = links.map((line, index) => {
			const words = line.toLowerCase();
			const score = terms.reduce((total, term) => total + (words.includes(term) ? 1 : 0), 0);
			return { line, index, priority: line.includes('resultTitle=') ? 1 : 0, score };
		}).sort((a, b) => b.priority - a.priority || b.score - a.score || a.index - b.index).slice(0, 30).map((item) => item.line);
		const domSnapshot = [
			...compactGroup(prioritizedFields, 1500, 10),
			...compactGroup(buttons, 600, 4),
			...compactGroup(rankedLinks, 2500, 22),
			...compactGroup(landmarks, 400, 5),
		].join('\n').slice(0, 5000);
		const sourceLines = (document.body?.innerText ?? '').slice(0, 100000).split(/\n+/).map(clean).filter((line) => line.length >= 35);
		const scoredLines = sourceLines.map((line, index) => {
			const words = line.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
			const score = terms.reduce((total, term) => total + (words.includes(term) ? 1 : 0), 0);
			return { line: line.slice(0, 360), index, score };
		});
		let selectedLines;
		if (terms.length && scoredLines.some((item) => item.score > 0)) {
			selectedLines = scoredLines.filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 8).sort((a, b) => a.index - b.index);
		} else {
			selectedLines = [...scoredLines.slice(0, 4), ...scoredLines.slice(4).sort((a, b) => b.line.length - a.line.length).slice(0, 4)].sort((a, b) => a.index - b.index);
		}
		let text = '';
		for (const item of selectedLines) {
			const excerpt = `[${item.index + 1}] ${item.line}`;
			if (text.length + excerpt.length > 1700) continue;
			text += `${text ? '\n' : ''}${excerpt}`;
		}
		return { title: document.title, url: location.href, selection: (window.getSelection()?.toString() ?? '').slice(0, 700), text, domSnapshot };
	}});
	return context.result;
}

function dataUrlParts(dataUrl) { const [header, data] = dataUrl.split(',', 2); return { mimeType: header.match(/data:(.*?);/)?.[1] ?? 'image/png', data }; }

async function requestAgent(payload, { url = API_URL, signal } = {}) {
	let response;
	try {
		response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal });
	} catch (cause) {
		if (cause?.name === 'AbortError') throw cause;
		const error = new Error('Could not connect to the local agent service.');
		error.stage = 'connection';
		throw error;
	}
	const text = await response.text();
	let data;
	try { data = text ? JSON.parse(text) : {}; } catch {
		const error = new Error(`Agent server returned an invalid response (${response.status}).`);
		error.status = response.status;
		error.stage = 'protocol';
		throw error;
	}
	if (!response.ok) {
		const error = new Error(data.error ?? 'Agent request failed.');
		error.status = response.status;
		error.stage = data.stage ?? 'http';
		throw error;
	}
	if (typeof data.answer !== 'string' || !data.answer.trim()) {
		const error = new Error('The agent returned no usable answer.');
		error.stage = 'interpretation';
		throw error;
	}
	return data;
}

function isChainedGoal(request) {
	return /\b(?:then|after that|afterwards|and then|and (?:open|click|visit|select|summari[sz]e|explain))\b|\b(?:open|click|visit)\s+(?:the\s+)?(?:first|top|relevant|official)\s+(?:result|link|video|product|page)\b/i.test(request);
}

function updateStep(step, status) {
	const existing = activeRunState.steps.at(-1);
	if (existing?.description === step.description && existing.status === 'running') existing.status = status;
	else activeRunState.steps.push({ description: step.description, status });
	if (status === 'completed') activeRunState.completedSteps.push(step.description);
}

async function observeCurrentPage(request, tab) {
	const page = await getPageContext(tab.id, request);
	const observation = {
		url: page.url || tab.url || '',
		title: page.title || tab.title || '',
		pageText: `${page.text.slice(0, 1700)}`,
		domSnapshot: page.domSnapshot.slice(0, 5000),
		selectedText: page.selection.slice(0, 700),
	};
	if (wantsVisualContext(request)) {
		const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
		observation.image = dataUrlParts(screenshot);
	}
	return observation;
}

async function requestNextStep(state, observation, signal) {
	const payload = {
		goal: state.goal,
		title: observation.title,
		url: observation.url,
		pageText: observation.pageText,
		domSnapshot: observation.domSnapshot,
		selectedText: observation.selectedText,
		runContext: {
			completedSteps: state.completedSteps.slice(-4),
			lastResult: state.lastResult,
			stepCount: state.stepCount,
			retryCount: state.retryCount,
		},
		...(observation.image ? { image: observation.image } : {}),
	};
	try {
		return await requestAgent(payload, { url: PLANNER_URL, signal });
	} catch (error) {
		if (observation.image || error.stage !== 'interpretation') throw error;
		const tab = await chrome.tabs.get(activeTabId);
		const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
		return requestAgent({ ...payload, image: dataUrlParts(screenshot) }, { url: PLANNER_URL, signal });
	}
}

function normalizePlannerDecision(rawDecision) {
	if (!rawDecision || typeof rawDecision !== 'object' || Array.isArray(rawDecision)) throw new Error('Planner returned no decision object.');
	const statusAliases = { complete: 'complete', completed: 'complete', failed: 'failed', confirm: 'confirm', waiting_confirmation: 'confirm', executing: 'executing', execute: 'executing', read: 'executing', verify: 'executing' };
	const status = Object.hasOwn(statusAliases, rawDecision.status) ? statusAliases[rawDecision.status] : null;
	if (!status) throw new Error(`Planner returned unsupported status "${String(rawDecision.status)}".`);
	const intent = typeof rawDecision.intent === 'string' ? rawDecision.intent : ['read', 'verify'].includes(rawDecision.status) ? rawDecision.status : 'answer';
	if (!['answer', 'summarize', 'search', 'click', 'type', 'scroll', 'navigate', 'read', 'verify'].includes(intent)) throw new Error(`Planner returned unsupported intent "${intent}".`);
	const description = typeof rawDecision.description === 'string' && rawDecision.description.trim()
		? rawDecision.description.trim().slice(0, 240)
		: typeof rawDecision.summary === 'string' && rawDecision.summary.trim() ? rawDecision.summary.trim().slice(0, 240) : 'Planner step';
	const expectedOutcome = typeof rawDecision.expectedOutcome === 'string' ? rawDecision.expectedOutcome.slice(0, 240) : '';
	const summary = typeof rawDecision.summary === 'string' && rawDecision.summary.trim() ? rawDecision.summary.trim().slice(0, 400) : description;
	const answerText = typeof rawDecision.answer === 'string' && rawDecision.answer.trim() ? rawDecision.answer.trim().slice(0, 1200) : summary;
	const plan = Array.isArray(rawDecision.plan) ? rawDecision.plan.filter((item) => typeof item === 'string').slice(0, 6).map((item) => item.slice(0, 180)) : [];
	let actionType = typeof rawDecision.actionType === 'string' ? rawDecision.actionType : '';
	if (['complete', 'failed'].includes(status) || ['read', 'verify'].includes(rawDecision.status)) actionType = 'none';
	if (!actionType && status === 'confirm') actionType = 'none';
	if (actionType === 'none') {
		return { status, intent, summary, answer: answerText, plan, description, expectedOutcome, action: null, confirmationReason: typeof rawDecision.confirmationReason === 'string' ? rawDecision.confirmationReason.slice(0, 220) : '' };
	}
	if (!EXECUTABLE_ACTION_TYPES.has(actionType)) throw new Error(`Planner returned invalid actionType "${actionType || '(missing)'}".`);
	const action = validateNormalizedAction({
		type: actionType,
		selector: rawDecision.selector,
		text: rawDecision.text,
		url: rawDecision.url,
		amount: rawDecision.amount,
		pressEnter: rawDecision.pressEnter,
		needsConfirmation: false,
	});
	return { status, intent, summary, answer: answerText, plan, description, expectedOutcome, action, confirmationReason: typeof rawDecision.confirmationReason === 'string' ? rawDecision.confirmationReason.slice(0, 220) : '' };
}

function validateNormalizedAction(candidate) {
	if (!candidate || typeof candidate !== 'object' || !EXECUTABLE_ACTION_TYPES.has(candidate.type)) throw new Error('Planner action is missing or unsupported.');
	const action = {
		type: candidate.type,
		selector: typeof candidate.selector === 'string' && candidate.selector.trim() ? candidate.selector.trim() : null,
		text: typeof candidate.text === 'string' ? candidate.text : null,
		url: typeof candidate.url === 'string' && candidate.url.trim() ? candidate.url.trim() : null,
		amount: Number.isFinite(candidate.amount) ? candidate.amount : null,
		pressEnter: typeof candidate.pressEnter === 'boolean' ? candidate.pressEnter : null,
		needsConfirmation: candidate.needsConfirmation === true,
	};
	if (action.type === 'click' && !action.selector) throw new Error('Click action requires a selector.');
	if (action.type === 'type' && (!action.selector || action.text === null)) throw new Error('Type action requires a selector and text.');
	if (action.type === 'scroll' && action.amount === null) throw new Error('Scroll action requires a finite amount.');
	if (action.type === 'navigate') {
		if (!action.url) throw new Error('Navigate action requires a URL.');
		let destination;
		try { destination = new URL(action.url); } catch { throw new Error('Navigate action URL is invalid.'); }
		if (!['http:', 'https:'].includes(destination.protocol)) throw new Error('Navigate action URL must use http or https.');
		action.url = destination.href;
	}
	if (['back', 'forward', 'reload'].includes(action.type) && (candidate.selector != null || candidate.text != null || candidate.url != null)) {
		throw new Error(`${action.type} action must not include selector, text, or URL.`);
	}
	return action;
}

async function askAgent(allowActions) {
	const request = requestInput.value.trim();
	if (!request) { setStatus('Write a request first.', true); requestInput.focus(); return; }
	try {
		const tab = await getActiveTab();
		activeTabId = tab.id;
		updatePageDetails(tab);
		const localTask = classifyLocalTask(request);
		const canRunLocalTask = localTask && !isChainedGoal(request) && (allowActions || localTask.type === 'find');
		if (canRunLocalTask) {
			summariseButton.disabled = true; executeButton.disabled = true;
			answer.textContent = await performLocalTask(localTask);
			result.hidden = false;
			setStatus('Completed locally.');
			await saveState();
			return;
		}
		if (allowActions) {
			await beginAgentRun(request, tab);
			return;
		}
		await summarizeCurrentPage(request, tab);
	} catch (error) {
		setStatus(error instanceof Error ? error.message : 'Request failed.', true);
		summariseButton.disabled = false; executeButton.disabled = false;
	}
}

async function summarizeCurrentPage(request, tab) {
	summariseButton.disabled = true; executeButton.disabled = true;
	result.hidden = true; actionWrap.hidden = true; setStatus('Reading page...');
	try {
		const modelRequest = request.slice(0, 900);
		const observation = await observeCurrentPage(modelRequest, tab);
		const payload = { request: modelRequest, pageText: observation.pageText, domSnapshot: observation.domSnapshot, allowActions: false, ...(observation.image ? { image: observation.image } : {}) };
		let data;
		try { data = await requestAgent(payload); } catch (firstError) {
			if (observation.image || firstError.stage !== 'interpretation') throw firstError;
			setStatus('Using visual fallback...');
			const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
			data = await requestAgent({ ...payload, image: dataUrlParts(screenshot) });
		}
		answer.textContent = data.answer;
		suggestedAction = null;
		result.hidden = false;
		setStatus('Done.');
		await saveState();
	} catch (error) { setStatus(error instanceof Error ? error.message : 'Request failed.', true); }
	finally { summariseButton.disabled = false; executeButton.disabled = false; }
}

async function beginAgentRun(goal, tab) {
	activeRunState = {
		goal: goal.slice(0, 900), status: 'running', paused: false, plan: [], steps: [], completedSteps: [],
		currentStep: null, pendingAction: null, currentUrl: tab.url || '', currentTitle: tab.title || '',
		stepCount: 0, retryCount: 0, noActionCount: 0, lastFailedStep: '', lastResult: '', awaitingObservation: false,
	};
	result.hidden = true; actionWrap.hidden = true; suggestedAction = null;
	answer.textContent = '';
	activeRunId++;
	activeController = new AbortController();
	await saveAgentRun();
	renderAgentRun();
	setStatus('Planning and observing the current page...');
	await runAgentLoop(activeRunId);
}

async function runAgentLoop(runId) {
	const signal = activeController?.signal;
	try {
		activeRunState.paused = false;
		renderAgentRun();
		while (runId === activeRunId && activeRunState?.status === 'running') {
			const tab = await chrome.tabs.get(activeTabId);
			if (!tab?.url || /^(?:chrome|edge|about):/i.test(tab.url)) throw new Error('This browser page does not allow agent observation.');
			const observation = await observeCurrentPage(activeRunState.goal, tab);
			activeRunState.currentUrl = observation.url;
			activeRunState.currentTitle = observation.title;
			updatePageDetails({ title: observation.title, url: observation.url });
			if (activeRunState.awaitingObservation) {
				activeRunState.verificationCandidate = activeRunState.currentStep?.description ?? '';
				activeRunState.lastResult = `The previous action was issued (${activeRunState.currentStep?.description ?? 'step'}). Verify its result from this fresh page observation; do not repeat it unless needed.`;
				activeRunState.awaitingObservation = false;
				await saveAgentRun();
			}
			setStatus(`Planning step ${activeRunState.stepCount + 1}…`);
			const decision = await requestNextStep(activeRunState, observation, signal);
			console.log('[AGENT] planner decision:', decision);
			const normalizedDecision = normalizePlannerDecision(decision);
			const action = normalizedDecision.action;
			console.log('[AGENT] normalized action:', action);
			if (activeRunState.verificationCandidate) {
				const prior = activeRunState.steps.at(-1);
				if (prior?.status === 'running') {
					const repeated = normalizedDecision.status === 'executing' && action && normalizedDecision.description === activeRunState.verificationCandidate;
					prior.status = repeated ? 'failed' : 'completed';
					if (!repeated) {
						activeRunState.completedSteps.push(prior.description);
						activeRunState.retryCount = 0;
						activeRunState.lastFailedStep = '';
					}
					else {
						activeRunState.retryCount++;
						activeRunState.lastFailedStep = prior.description;
					}
				}
				activeRunState.verificationCandidate = '';
			}
			if (activeRunState.retryCount > MAX_STEP_RETRIES) {
				activeRunState.status = 'failed';
				activeRunState.lastResult = `Stopped after ${MAX_STEP_RETRIES} retries without verifying the previous step.`;
				answer.textContent = activeRunState.lastResult;
				setStatus(activeRunState.lastResult, true);
				break;
			}
			if (normalizedDecision.status === 'executing' && action && activeRunState.stepCount >= MAX_AGENT_STEPS) {
				activeRunState.status = 'failed';
				activeRunState.lastResult = `Stopped after reaching the ${MAX_AGENT_STEPS}-step limit.`;
				answer.textContent = activeRunState.lastResult;
				setStatus(activeRunState.lastResult, true);
				break;
			}
			activeRunState.plan = normalizedDecision.plan;
			activeRunState.summary = normalizedDecision.summary;
			activeRunState.currentStep = {
				description: normalizedDecision.description,
				expectedOutcome: normalizedDecision.expectedOutcome,
				intent: normalizedDecision.intent,
				action,
			};
			answer.textContent = normalizedDecision.status === 'complete' || normalizedDecision.status === 'failed' ? normalizedDecision.answer : normalizedDecision.summary;
			result.hidden = false;
			if (normalizedDecision.status === 'complete') {
				activeRunState.status = 'completed';
				activeRunState.lastResult = normalizedDecision.answer;
				setStatus('Goal complete.');
				break;
			}
			if (normalizedDecision.status === 'failed') {
				activeRunState.status = 'failed';
				activeRunState.lastResult = normalizedDecision.answer;
				setStatus(normalizedDecision.answer, true);
				break;
			}
			if (!action) {
				if (normalizedDecision.status === 'confirm') {
					activeRunState.status = 'failed';
					activeRunState.lastResult = `The planner requested confirmation but provided no action to confirm. ${normalizedDecision.answer}`.trim();
					answer.textContent = activeRunState.lastResult;
					setStatus(activeRunState.lastResult, true);
					break;
				}
				if (['answer', 'summarize'].includes(normalizedDecision.intent)) {
					activeRunState.status = 'completed';
					activeRunState.lastResult = normalizedDecision.answer;
					answer.textContent = normalizedDecision.answer;
					setStatus('Goal complete.');
					break;
				}
				if (!['read', 'verify', 'answer', 'summarize'].includes(normalizedDecision.intent)) {
					activeRunState.status = 'failed';
					activeRunState.lastResult = `The planner returned no executable action for its ${normalizedDecision.intent} step.`;
					answer.textContent = activeRunState.lastResult;
					setStatus(activeRunState.lastResult, true);
					break;
				}
				activeRunState.noActionCount = (activeRunState.noActionCount ?? 0) + 1;
				activeRunState.steps.push({ description: normalizedDecision.description, status: 'completed' });
				activeRunState.lastResult = `Observed without a browser action: ${normalizedDecision.summary}`.slice(0, 300);
				if (activeRunState.noActionCount > MAX_NO_ACTION_STEPS) {
					activeRunState.status = 'failed';
					activeRunState.lastResult = 'The planner repeatedly returned no action without completing the goal.';
					answer.textContent = activeRunState.lastResult;
					setStatus(activeRunState.lastResult, true);
					break;
				}
				await saveAgentRun();
				renderAgentRun();
				continue;
			}
			activeRunState.noActionCount = 0;
			const step = { ...activeRunState.currentStep, action };
			const policy = await inspectActionPolicy(action);
			action.needsConfirmation = normalizedDecision.status === 'confirm' || policy?.needsConfirmation === true;
			if (action.needsConfirmation) {
				activeRunState.status = 'waiting_confirmation';
				activeRunState.pendingAction = { action, description: step.description, expectedOutcome: step.expectedOutcome, targetLabel: policy?.label || step.description, reason: normalizedDecision.confirmationReason || policy?.reason || normalizedDecision.answer, url: observation.url };
				setStatus(`Confirmation needed: ${activeRunState.pendingAction.reason}`);
				break;
			}
			await executePlannedStep(step, observation.url, runId);
		}
	} catch (error) {
		if (error?.name === 'AbortError' || activeRunState?.status === 'cancelled' || runId !== activeRunId) return;
		activeRunState.status = 'failed';
		activeRunState.lastResult = error instanceof Error ? error.message : 'Agent run failed.';
		answer.textContent = activeRunState.lastResult;
		setStatus(activeRunState.lastResult, true);
	} finally {
		if (runId === activeRunId) {
			activeController = null;
			await saveAgentRun();
			renderAgentRun();
			summariseButton.disabled = false;
			executeButton.disabled = false;
			await saveState();
		}
	}
}

async function executePlannedStep(step, previousUrl, runId) {
	const action = validateNormalizedAction(step?.action);
	step = { ...step, action };
	activeRunState.status = 'running';
	activeRunState.paused = false;
	activeRunState.stepCount++;
	activeRunState.currentStep = step;
	activeRunState.awaitingObservation = true;
	activeRunState.steps.push({ description: step.description, status: 'running' });
	activeRunState.pendingAction = null;
	suggestedAction = action;
	actionCode.textContent = JSON.stringify(action, null, 2);
	actionWrap.hidden = false;
	await saveAgentRun();
	renderAgentRun();
	try {
		await performAction(action);
		if (runId !== activeRunId || activeRunState.status === 'cancelled') return;
		activeRunState.lastResult = `Action issued: ${step.description}. Verify: ${step.expectedOutcome}`.slice(0, 300);
		setStatus(step.description);
		await waitForPageSettle(activeTabId, previousUrl);
	} catch (error) {
		if (runId !== activeRunId || activeRunState.status === 'cancelled') return;
		updateStep(step, 'failed');
		activeRunState.retryCount = activeRunState.lastFailedStep === step.description ? activeRunState.retryCount + 1 : 1;
		activeRunState.lastFailedStep = step.description;
		activeRunState.lastResult = `Action failed: ${error instanceof Error ? error.message : 'browser action failed'}`.slice(0, 300);
		activeRunState.awaitingObservation = false;
		if (activeRunState.retryCount > MAX_STEP_RETRIES) {
			activeRunState.status = 'failed';
			answer.textContent = `Stopped after ${MAX_STEP_RETRIES} retries: ${activeRunState.lastResult}`;
			setStatus(answer.textContent, true);
		}
	}
	await saveAgentRun();
	renderAgentRun();
}

async function resumeAgent() {
	if (!activeRunState || activeRunState.status !== 'running') return;
	activeRunState.paused = false;
	activeRunId++;
	activeController = new AbortController();
	await saveAgentRun();
	setStatus('Resuming from a fresh page observation…');
	await runAgentLoop(activeRunId);
}

async function confirmPendingAction() {
	if (!activeRunState?.pendingAction) return;
	const pending = activeRunState.pendingAction;
	try {
		const pendingAction = validateNormalizedAction(pending.action);
		const tab = await chrome.tabs.get(activeTabId);
		if (tab.url !== pending.url) {
			activeRunState.status = 'running';
			activeRunState.pendingAction = null;
			activeRunState.lastResult = 'The page changed before confirmation. Re-checking the current page before taking any action.';
			await saveAgentRun();
			activeRunId++;
			activeController = new AbortController();
			await runAgentLoop(activeRunId);
			return;
		}
		const freshObservation = await observeCurrentPage(activeRunState.goal, tab);
		const risk = await inspectActionPolicy(pendingAction);
		if (risk?.label !== pending.targetLabel) {
			activeRunState.pendingAction = { ...pending, action: pendingAction, targetLabel: risk?.label || 'unknown target', reason: 'The target changed; review the updated action before confirming.', url: freshObservation.url };
			setStatus('The target changed. Review and confirm again.');
			await saveAgentRun();
			renderAgentRun();
			return;
		}
		activeRunState.status = 'running';
		activeRunState.lastResult = `User confirmed: ${pending.reason}`;
		activeRunId++;
		activeController = new AbortController();
		const runId = activeRunId;
		await executePlannedStep({ ...activeRunState.currentStep, description: pending.description, expectedOutcome: pending.expectedOutcome, action: pendingAction }, freshObservation.url, runId);
		if (activeRunState.status === 'running') await runAgentLoop(runId);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'The confirmed action failed.';
		const step = activeRunState.currentStep;
		if (step) {
			updateStep(step, 'failed');
			activeRunState.retryCount = activeRunState.lastFailedStep === step.description ? activeRunState.retryCount + 1 : 1;
			activeRunState.lastFailedStep = step.description;
			activeRunState.lastResult = `Confirmed action failed: ${message}`.slice(0, 300);
			activeRunState.status = activeRunState.retryCount > MAX_STEP_RETRIES ? 'failed' : 'running';
		} else {
			activeRunState.status = 'failed';
			activeRunState.lastResult = message;
		}
		setStatus(activeRunState.lastResult, activeRunState.status === 'failed');
		await saveAgentRun();
		renderAgentRun();
		if (activeRunState.status === 'running') {
			activeRunId++;
			activeController = new AbortController();
			await runAgentLoop(activeRunId);
		}
	}
}

async function stopAgent() {
	if (!activeRunState || !['running', 'waiting_confirmation'].includes(activeRunState.status)) return;
	activeRunState.status = 'cancelled';
	activeRunState.paused = false;
	activeRunState.pendingAction = null;
	activeRunState.lastResult = 'Agent stopped by user.';
	activeController?.abort();
	activeRunId++;
	answer.textContent = activeRunState.lastResult;
	setStatus('Agent stopped by user.');
	await saveAgentRun();
	renderAgentRun();
	await saveState();
}

async function openSidebar() {
	if (!activeTabId) return;
	await chrome.sidePanel.open({ tabId: activeTabId });
}

async function copyAnswer() {
	if (!answer.textContent) return;
	await navigator.clipboard.writeText(answer.textContent);
	setStatus('Summary copied to clipboard.');
}

async function inspectActionPolicy(action) {
	const browserAction = validateNormalizedAction(action);
	if (!['click', 'type'].includes(browserAction.type)) return { needsConfirmation: false, label: browserAction.type, reason: '' };
	const [inspection] = await chrome.scripting.executeScript({ target: { tabId: activeTabId }, args: [browserAction], func: (browserAction) => {
		let matches;
		try { matches = document.querySelectorAll(browserAction.selector); } catch { throw new Error('The suggested selector is invalid.'); }
		if (matches.length !== 1) throw new Error(matches.length ? 'The suggested selector matches more than one element.' : 'The suggested element is no longer on the page.');
		const element = matches[0];
		const style = getComputedStyle(element);
		if (style.display === 'none' || style.visibility === 'hidden' || element.getClientRects().length === 0) throw new Error('The suggested element is not visible.');
		if (element.disabled || element.getAttribute('aria-disabled') === 'true' || (browserAction.type === 'type' && (element.readOnly || element.getAttribute('aria-readonly') === 'true'))) throw new Error('The suggested element is disabled or readonly.');
		const label = [element.getAttribute('aria-label'), element.getAttribute('title'), element.getAttribute('placeholder'), element.innerText, element.value].filter(Boolean).join(' ').replace(/\s+/g, ' ').slice(0, 180);
		const form = element.closest('form');
		const formLabel = form ? [form.getAttribute('aria-label'), form.getAttribute('role'), form.innerText, form.getAttribute('action')].filter(Boolean).join(' ').slice(0, 300) : '';
		const isSearchForm = /search|find mail|find messages/i.test(`${formLabel} ${label}`) || element.getAttribute('role') === 'searchbox' || element.getAttribute('type') === 'search';
		const sensitiveField = browserAction.type === 'type' && element instanceof HTMLInputElement && (element.type === 'password' || /current-password|new-password|username/i.test(element.autocomplete));
		const consequential = /(?:delete|remove|purchase|buy now|pay now|checkout|send message|send email|publish|post publicly|submit order|place order|transfer funds|change password|save changes|cancel subscription|unsubscribe)/i.test(label);
		const nonSearchSubmission = Boolean(form && !isSearchForm && (browserAction.type === 'type' && browserAction.pressEnter || element.type === 'submit' || element.getAttribute('type') === 'submit'));
		return { needsConfirmation: sensitiveField || consequential || nonSearchSubmission, label: label || element.tagName.toLowerCase(), reason: sensitiveField ? 'This field may contain credentials.' : consequential ? 'This control may cause an important external change.' : nonSearchSubmission ? 'This action submits a non-search form.' : '' };
	}});
	if (!inspection || !inspection.result || typeof inspection.result !== 'object') throw new Error('Could not inspect the action confirmation policy on this page.');
	return inspection.result;
}

async function waitForPageSettle(tabId, previousUrl) {
	const start = Date.now();
	const deadline = start + 12000;
	let changed = false;
	while (Date.now() < deadline) {
		const tab = await chrome.tabs.get(tabId);
		changed ||= tab.url !== previousUrl;
		if (tab.status === 'complete' && (changed || Date.now() - start >= 700)) {
			await new Promise((resolve) => setTimeout(resolve, 350));
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
}

async function performAction(action) {
	const browserAction = validateNormalizedAction(action);
	if (!activeTabId) return;
	if (browserAction.type === 'navigate') {
		const destination = new URL(browserAction.url);
		if (!['http:', 'https:'].includes(destination.protocol)) throw new Error('Navigation is limited to http and https URLs.');
		await chrome.tabs.update(activeTabId, { url: destination.href });
		return;
	}
	if (browserAction.type === 'back') { await chrome.tabs.goBack(activeTabId); return; }
	if (browserAction.type === 'forward') { await chrome.tabs.goForward(activeTabId); return; }
	if (browserAction.type === 'reload') { await chrome.tabs.reload(activeTabId); return; }
	await chrome.scripting.executeScript({ target: { tabId: activeTabId }, args: [browserAction], func: async (browserAction) => {
		if (browserAction.type === 'scroll') { window.scrollBy({ top: Number(browserAction.amount) || 600, behavior: 'smooth' }); return; }
		let matches;
		try { matches = browserAction.selector ? document.querySelectorAll(browserAction.selector) : []; } catch { throw new Error('The suggested selector is invalid.'); }
		if (matches.length !== 1) throw new Error(matches.length ? 'The suggested selector matches more than one element.' : 'The suggested element is no longer on the page.');
		const element = matches[0];
		const style = getComputedStyle(element);
		if (style.display === 'none' || style.visibility === 'hidden' || element.getClientRects().length === 0) throw new Error('The suggested element is not visible.');
		if (browserAction.type === 'click') {
			if (element.disabled || element.getAttribute('aria-disabled') === 'true') throw new Error('The suggested element is disabled.');
			element.click();
		}
		if (browserAction.type === 'type') {
			const canType = (element instanceof HTMLInputElement && !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'hidden', 'image'].includes(element.type)) || element instanceof HTMLTextAreaElement || element.isContentEditable;
			if (!canType) throw new Error('The suggested element is not a text-capable field.');
			if (element.disabled || element.readOnly || element.getAttribute('aria-disabled') === 'true' || element.getAttribute('aria-readonly') === 'true') throw new Error('The suggested field is disabled or readonly.');
			element.focus();
			if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
				let prototype = Object.getPrototypeOf(element);
				let valueSetter;
				while (prototype && !valueSetter) {
					valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
					prototype = Object.getPrototypeOf(prototype);
				}
				if (valueSetter) valueSetter.call(element, '');
				else element.value = '';
				element.dispatchEvent(new InputEvent('input', { bubbles: true, data: null, inputType: 'deleteContentBackward' }));
				for (const character of browserAction.text ?? '') {
					if (valueSetter) valueSetter.call(element, element.value + character);
					else element.value += character;
					element.dispatchEvent(new InputEvent('input', { bubbles: true, data: character, inputType: 'insertText' }));
					await new Promise((resolve) => setTimeout(resolve, 12));
				}
				try { element.setSelectionRange(element.value.length, element.value.length); } catch {}
			} else {
				const text = browserAction.text ?? '';
				const selection = window.getSelection();
				const range = document.createRange();
				range.selectNodeContents(element);
				range.collapse(false);
				selection.removeAllRanges();
				selection.addRange(range);
				if (!document.execCommand('insertText', false, text)) element.textContent = text;
				element.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
			}
			if (browserAction.pressEnter) {
				element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
				element.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
				element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
				const form = element instanceof HTMLElement ? element.closest('form') : null;
				if (form instanceof HTMLFormElement) {
					const submitButton = form.querySelector('button[type="submit"], input[type="submit"]');
					if (submitButton instanceof HTMLElement) submitButton.click();
					else form.requestSubmit();
				} else if (element instanceof HTMLInputElement && element.type !== 'textarea') {
					element.dispatchEvent(new Event('change', { bubbles: true }));
				}
			}
			element.dispatchEvent(new Event('change', { bubbles: true }));
		}
	}});
}

summariseButton.addEventListener('click', () => askAgent(false));
executeButton.addEventListener('click', () => askAgent(true));
pinButton?.addEventListener('click', openSidebar);
copyButton?.addEventListener('click', copyAnswer);
stopAgentButton?.addEventListener('click', stopAgent);
resumeAgentButton?.addEventListener('click', resumeAgent);
confirmAgentButton?.addEventListener('click', confirmPendingAction);
requestInput.addEventListener('input', () => { saveState().catch(() => {}); });
requestInput.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') askAgent(false); });
getActiveTab().then(async (tab) => { activeTabId = tab.id; updatePageDetails(tab); await restoreState(tab); await restoreAgentRun(tab); }).catch((error) => setStatus(error.message, true));
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
	if (tabId === activeTabId && changeInfo.status === 'complete') {
		updatePageDetails(tab);
		if (activeRunState && ['running', 'waiting_confirmation'].includes(activeRunState.status)) {
			renderAgentRun();
			return;
		}
		result.hidden = true;
		actionWrap.hidden = true;
		suggestedAction = null;
		requestInput.value = '';
		saveState().catch(() => {});
	}
});
