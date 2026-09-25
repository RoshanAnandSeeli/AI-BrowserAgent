import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Groq from 'groq-sdk';

const app = express();
const port = Number(process.env.PORT) || 3001;
const apiKey = process.env.GROQ_API_KEY;
const modelName = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';
const requestTimeoutMs = Number(process.env.GROQ_REQUEST_TIMEOUT_MS) || 30000;
const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
const AGENT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    intent: { type: 'string', enum: ['answer', 'summarize', 'search', 'click', 'type', 'scroll', 'navigate'] },
    action: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['click', 'type', 'scroll', 'navigate', 'back', 'forward', 'reload'] },
            selector: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            text: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            url: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            amount: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
            pressEnter: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
          },
          required: ['type', 'selector', 'text', 'url', 'amount', 'pressEnter'],
          additionalProperties: false,
        },
      ],
    },
  },
  required: ['answer', 'intent', 'action'],
  additionalProperties: false,
} as const;
const AGENT_SYSTEM_INSTRUCTION = `You are the AI Powered Browsing Agent. Use only the supplied page evidence; never assume missing content or selectors.
Return only JSON: {"answer":"...","intent":"answer|summarize|search|click|type|scroll|navigate","action":null|{...}}. Keep the answer concise and return at most one action. Use action null for answers, summaries, or insufficient/ambiguous evidence.
Allowed actions: click, type, scroll, navigate, back, forward, reload. Use exact unique selectors from the DOM snapshot. Match controls by accessible name, role, placeholder, or destination. For site search, fill the matching visible search field and press Enter. For Google, choose the first organic result link, not ads or navigation. Navigate only to absolute http/https URLs.
Never take destructive, financial, messaging, or account-changing actions. Do not submit forms except an explicitly requested search.`;
const PLANNER_SYSTEM_INSTRUCTION = `You are the planner for a browser agent. Return ONLY one valid JSON object using this flat shape: {"goal":"string","status":"executing|complete|failed|confirm|read|verify","summary":"short user-safe status","answer":"string","plan":["up to 6 short steps"],"description":"current step description","expectedOutcome":"expected visible result","intent":"read|verify|search|click|type|scroll|navigate|answer|summarize","actionType":"none|click|type|scroll|navigate|back|forward|reload","selector":null,"text":null,"url":null,"amount":null,"pressEnter":null}. Do not nest an action object. For status complete, failed, read, or verify, actionType must be none. For confirm, actionType may be none or one actual action; never fabricate a default action. For actionType none, return null for selector, text, url, amount, and pressEnter. click requires selector; type requires selector and text; scroll requires amount; navigate requires an absolute http/https url; back, forward, and reload require selector, text, and url to be null. Do not add markdown or extra keys. You receive one user goal, a short active-run summary, and the latest page observation. Use fresh DOM evidence; never assume prior actions succeeded. Verify the prior action's expected outcome before continuing; otherwise re-plan from this page state. Return complete only when evidence shows the goal is achieved. If no safe, evidence-based action can be selected, return failed with actionType none and briefly explain what is missing. Include only the next action; never give selectors for future steps. Never reveal hidden reasoning. Do not initiate consequential actions unless explicitly requested. An explicitly requested consequential action is still subject to local confirmation. Only use absolute http/https navigation.`;

const INTENTS = new Set(['answer', 'summarize', 'search', 'click', 'type', 'scroll', 'navigate']);
const ACTIONS = new Set(['click', 'type', 'scroll', 'navigate', 'back', 'forward', 'reload']);
const PLANNER_STATUSES = new Set(['executing', 'complete', 'completed', 'failed', 'confirm', 'read', 'verify']);

function validateAgentResult(result: unknown, allowActions: boolean) {
  if (!result || typeof result !== 'object') throw new Error('Agent response was not an object.');
  const candidate = result as { answer?: unknown; intent?: unknown; action?: unknown };
  if (typeof candidate.answer !== 'string' || !candidate.answer.trim()) throw new Error('Agent response has no answer.');
  if (typeof candidate.intent !== 'string' || !INTENTS.has(candidate.intent)) throw new Error('Agent response has an invalid intent.');
  if (candidate.action === null) return candidate;
  if (candidate.intent === 'answer' || candidate.intent === 'summarize') throw new Error('Informational and summarization intents must not include an action.');
  if (!allowActions) throw new Error('Agent returned an action in text-only mode.');
  if (!candidate.action || typeof candidate.action !== 'object') throw new Error('Agent response has an invalid action.');
  const action = candidate.action as { type?: unknown; selector?: unknown; text?: unknown; url?: unknown; pressEnter?: unknown };
  if (typeof action.type !== 'string' || !ACTIONS.has(action.type)) throw new Error('Agent response has an invalid action type.');
  if (['click', 'type'].includes(action.type) && (typeof action.selector !== 'string' || !action.selector.trim())) throw new Error('Interactive action is missing a selector.');
  if (action.type === 'type' && (typeof action.text !== 'string' || action.text.length > 4000)) throw new Error('Type action text is invalid.');
  if (candidate.intent === 'search') {
    if (action.type !== 'type') throw new Error('Search intent requires a type action.');
    action.pressEnter = true;
  }
  if (action.type === 'navigate') {
    if (typeof action.url !== 'string') throw new Error('Navigate action is missing a URL.');
    const url = new URL(action.url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Navigate action URL must use http or https.');
  }
  return candidate;
}

function validatePlannerDecision(result: unknown, requestedGoal: string) {
  if (!result || typeof result !== 'object') throw new Error('Planner response was not an object.');
  const candidate = result as {
    goal?: unknown; status?: unknown; summary?: unknown; answer?: unknown; plan?: unknown;
    description?: unknown; expectedOutcome?: unknown; intent?: unknown; actionType?: unknown;
    selector?: unknown; text?: unknown; url?: unknown; amount?: unknown; pressEnter?: unknown;
  };
  if (typeof candidate.status !== 'string' || !PLANNER_STATUSES.has(candidate.status)) throw new Error('Planner returned an invalid status.');
  const status = candidate.status === 'completed' ? 'complete' : candidate.status;
  if (typeof candidate.summary !== 'string' || !candidate.summary.trim() || candidate.summary.length > 400) throw new Error('Planner returned an invalid summary.');
  if (!Array.isArray(candidate.plan) || candidate.plan.length > 6 || candidate.plan.some((step) => typeof step !== 'string' || !step.trim() || step.length > 180)) throw new Error('Planner returned an invalid plan.');
  const noActionStatus = ['complete', 'failed', 'read', 'verify'].includes(status);
  if (noActionStatus) candidate.actionType = 'none';
  if (candidate.actionType === undefined && status === 'confirm') candidate.actionType = 'none';
  if (typeof candidate.actionType !== 'string' || !['none', ...ACTIONS].includes(candidate.actionType)) throw new Error('Planner returned an invalid actionType.');
  if (typeof candidate.description !== 'string' || candidate.description.length > 240) throw new Error('Planner returned an invalid step description.');
  if (typeof candidate.expectedOutcome !== 'string' || candidate.expectedOutcome.length > 240) throw new Error('Planner returned an invalid expected outcome.');
  if (typeof candidate.intent !== 'string' || !['answer', 'summarize', 'search', 'click', 'type', 'scroll', 'navigate', 'read', 'verify'].includes(candidate.intent)) throw new Error('Planner returned an invalid step intent.');
  if (typeof candidate.answer !== 'string' || !candidate.answer.trim()) candidate.answer = candidate.summary || candidate.description || 'No additional details.';
  else candidate.answer = candidate.answer.slice(0, 1200);
  if (candidate.actionType === 'none') {
    candidate.selector = candidate.text = candidate.url = candidate.amount = candidate.pressEnter = null;
  } else {
    const action = {
      type: candidate.actionType,
      selector: candidate.selector ?? null,
      text: candidate.text ?? null,
      url: candidate.url ?? null,
      amount: candidate.amount ?? null,
      pressEnter: candidate.pressEnter ?? null,
    };
    validatePlannerAction(action);
  }
  candidate.status = status;
  candidate.goal = requestedGoal;
  return candidate;
}

function validatePlannerAction(action: { type: string; selector: unknown; text: unknown; url: unknown; amount: unknown; pressEnter: unknown }) {
  if (!ACTIONS.has(action.type)) throw new Error('Planner returned an unsupported actionType.');
  if (action.type === 'click' && (typeof action.selector !== 'string' || !action.selector.trim())) throw new Error('Click action requires a selector.');
  if (action.type === 'type' && (typeof action.selector !== 'string' || !action.selector.trim() || typeof action.text !== 'string' || action.text.length > 4000)) throw new Error('Type action requires a selector and valid text.');
  if (action.type === 'scroll' && (typeof action.amount !== 'number' || !Number.isFinite(action.amount))) throw new Error('Scroll action requires a finite amount.');
  if (action.type === 'navigate') {
    if (typeof action.url !== 'string') throw new Error('Navigate action requires a URL.');
    const url = new URL(action.url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Navigate action URL must use http or https.');
  }
  if (['back', 'forward', 'reload'].includes(action.type) && [action.selector, action.text, action.url].some((value) => value !== null)) {
    throw new Error(`${action.type} actions do not accept selector, text, or URL fields.`);
  }
}

function parsePlannerDecision(text: string, goal: string) {
  const rawText = text.trim().replace(/^```json\s*|\s*```$/g, '');
  return validatePlannerDecision(JSON.parse(rawText), goal);
}

async function generateContent(userText: string, systemInstruction?: string, image?: { mimeType: string; data: string }, responseSchema?: Record<string, unknown>, jsonObjectMode = false) {
  const groq = new Groq({ apiKey: apiKey!, timeout: requestTimeoutMs });
  const content = image
    ? [
        { type: 'text' as const, text: userText },
        { type: 'image_url' as const, image_url: { url: `data:${image.mimeType};base64,${image.data}` } },
      ]
    : userText;
  const completion = await groq.chat.completions.create({
    model: modelName,
    messages: [
      ...(systemInstruction ? [{ role: 'system' as const, content: systemInstruction }] : []),
      { role: 'user' as const, content },
    ],
    ...(systemInstruction && jsonObjectMode
      ? { response_format: { type: 'json_object' as const } }
      : systemInstruction && responseSchema
      ? { response_format: { type: 'json_schema' as const, json_schema: { name: 'browser_agent_response', strict: true, schema: responseSchema } } }
      : {}),
  });
  const text = completion.choices[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('Groq returned no usable response.');
  return { text, model: completion.model || modelName };
}

app.use((request, response, next) => {
  response.header('Access-Control-Allow-Origin', request.headers.origin ?? '*');
  response.header('Access-Control-Allow-Headers', 'Content-Type');
  response.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (request.method === 'OPTIONS') {
    response.sendStatus(204);
    return;
  }
  next();
});
app.use(express.json({ limit: '12mb' }));

app.get('/', (_request, response) => {
  response.json({ service: 'AI Powered Browsing Agent', status: 'ok', endpoint: '/api/agent' });
});

app.get('/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.get('/test', (_request, response) => {
  response.sendFile(path.join(projectDirectory, 'test.html'));
});

app.get('/agent-fixture', (_request, response) => {
  response.sendFile(path.join(projectDirectory, 'agent-fixture.html'));
});

app.get('/api/diagnostics', (_request, response) => {
  response.json({
    server: 'ok',
    apiKeyPresent: Boolean(apiKey),
    apiKeyLength: apiKey?.length ?? 0,
    model: modelName,
    requestTimeoutMs,
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/diagnostics', async (request, response) => {
  const startedAt = Date.now();
  if (!apiKey) {
    response.status(500).json({ ok: false, stage: 'configuration', error: 'GROQ_API_KEY is missing.' });
    return;
  }

  try {
    const prompt = typeof request.body?.prompt === 'string' && request.body.prompt.trim()
      ? request.body.prompt.trim().slice(0, 4000)
      : 'Reply with exactly: diagnostic ok';
    const { text, model } = await generateContent(prompt);
    response.json({
      ok: true,
      stage: 'provider',
      model,
      prompt,
      elapsedMs: Date.now() - startedAt,
      response: text,
    });
  } catch (error) {
    const providerError = error instanceof Error ? error.message : String(error);
    console.error('Diagnostics request failed:', providerError);
    response.status(502).json({
      ok: false,
      stage: 'provider',
      model: modelName,
      elapsedMs: Date.now() - startedAt,
      error: providerError,
    });
  }
});

app.post('/api/agent', async (request, response) => {
  if (!apiKey) {
    response.status(500).json({ error: 'API configuration is missing.' });
    return;
  }

  const requestText = typeof request.body?.request === 'string' ? request.body.request.trim().slice(0, 900) : '';
  const pageText = typeof request.body?.pageText === 'string' ? request.body.pageText.slice(0, 1800) : '';
  const domSnapshot = typeof request.body?.domSnapshot === 'string' ? request.body.domSnapshot.slice(0, 5000) : '';
  const allowActions = request.body?.allowActions === true;
  const image = request.body?.image;
  const hasImage = typeof image?.data === 'string' && typeof image?.mimeType === 'string';
  if (!requestText || !domSnapshot) {
    response.status(400).json({ error: 'A request and DOM snapshot are required.' });
    return;
  }

  const userMessage = `Execution mode: ${allowActions ? 'execute one safe browser action when needed' : 'text-only; action must be null'}.

User request:
${requestText}

Current page text:
${pageText}

Current DOM snapshot:
${domSnapshot}

Visual context included: ${hasImage ? 'yes; use it only to resolve details unavailable in the DOM' : 'no'}.`;

  let rawText: string;
  let model: string;
  try {
    const generated = await generateContent(userMessage, AGENT_SYSTEM_INSTRUCTION, hasImage ? image : undefined, AGENT_RESPONSE_SCHEMA);
    rawText = generated.text.trim().replace(/^```json\s*|\s*```$/g, '');
    model = generated.model;
  } catch (error) {
    const providerError = error instanceof Error ? error.message : String(error);
    console.error('Agent provider request failed:', providerError);
    if (providerError.includes('413') || providerError.includes('rate_limit_exceeded')) {
      response.status(413).json({ stage: 'provider', error: 'The request exceeds Groq’s current input-token limit. Try a shorter request or a more focused selection.' });
      return;
    }
    if (providerError.includes('timed out') || providerError.includes('aborted')) {
      response.status(504).json({ stage: 'provider', error: 'The AI request timed out. Please retry.' });
      return;
    }
    if (providerError.includes('429') || providerError.includes('503') || providerError.includes('high demand') || providerError.includes('Service Unavailable')) {
      response.status(providerError.includes('429') ? 429 : 503).json({ stage: 'provider', error: 'The AI service is busy. Please retry shortly.' });
      return;
    }
    response.status(502).json({ stage: 'provider', error: 'The AI service could not process the request.' });
    return;
  }

  try {
    const agentResult = validateAgentResult(JSON.parse(rawText), allowActions);
    response.json({ ...agentResult, model });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('Agent response interpretation failed:', detail);
    response.status(502).json({ stage: 'interpretation', error: 'The agent could not interpret this page response.' });
  }
});

app.post('/api/agent/next', async (request, response) => {
  const startedAt = Date.now();
  if (!apiKey) {
    response.status(500).json({ stage: 'configuration', error: 'API configuration is missing.' });
    return;
  }

  const goal = typeof request.body?.goal === 'string' ? request.body.goal.trim().slice(0, 900) : '';
  const pageText = typeof request.body?.pageText === 'string' ? request.body.pageText.slice(0, 1800) : '';
  const domSnapshot = typeof request.body?.domSnapshot === 'string' ? request.body.domSnapshot.slice(0, 5000) : '';
  const selectedText = typeof request.body?.selectedText === 'string' ? request.body.selectedText.slice(0, 700) : '';
  const image = request.body?.image;
  const hasImage = typeof image?.data === 'string' && typeof image?.mimeType === 'string';
  const runContext = request.body?.runContext ?? {};
  const recentSteps = Array.isArray(runContext.completedSteps)
    ? runContext.completedSteps.filter((step: unknown) => typeof step === 'string').slice(-4).map((step: string) => step.slice(0, 180))
    : [];
  const lastResult = typeof runContext.lastResult === 'string' ? runContext.lastResult.slice(0, 300) : '';
  const stepCount = Number.isInteger(runContext.stepCount) ? Math.max(0, Math.min(runContext.stepCount, 10)) : 0;
  const retryCount = Number.isInteger(runContext.retryCount) ? Math.max(0, Math.min(runContext.retryCount, 2)) : 0;
  if (!goal || !domSnapshot) {
    response.status(400).json({ stage: 'context', error: 'A goal and current DOM observation are required.' });
    return;
  }

  const userMessage = `Goal: ${goal}
Recent completed steps: ${recentSteps.length ? recentSteps.join(' | ') : 'none'}
Last action result: ${lastResult || 'none'}
Action attempts used: ${stepCount}; retries after failure: ${retryCount}

Current page: ${String(request.body?.title ?? '').slice(0, 120)}
Current URL: ${String(request.body?.url ?? '').slice(0, 240)}
Selected text: ${selectedText}
Relevant page excerpts:
${pageText}

Current DOM snapshot:
${domSnapshot}

Visual context included: ${hasImage ? 'yes' : 'no'}. Continue only from this latest observation.`;

  try {
    let generated;
    let decision;
    let firstInterpretationError: unknown;
    try {
      generated = await generateContent(userMessage, PLANNER_SYSTEM_INSTRUCTION, hasImage ? image : undefined, undefined, true);
      decision = parsePlannerDecision(generated.text, goal);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (!detail.includes('json_validate_failed') && !(error instanceof SyntaxError) && !detail.includes('Planner')) throw error;
      firstInterpretationError = error;
    }
    if (firstInterpretationError) {
      const correction = firstInterpretationError instanceof Error ? firstInterpretationError.message : 'invalid planner response';
      console.warn('Planner response was invalid; requesting one corrected JSON response:', correction);
      const repairMessage = `${userMessage}\n\nReturn a corrected JSON object that matches the system contract. The previous attempt failed validation (${correction.slice(0, 220)}). No prose or markdown.`;
      generated = await generateContent(repairMessage, PLANNER_SYSTEM_INSTRUCTION, hasImage ? image : undefined, undefined, true);
      decision = parsePlannerDecision(generated.text, goal);
    }
    response.json({ ...decision, model: generated!.model, elapsedMs: Date.now() - startedAt });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('Agent planner request failed:', detail);
    if (detail.includes('413') || detail.includes('rate_limit_exceeded')) {
      response.status(413).json({ stage: 'provider', error: 'The request exceeds Groq’s current input-token limit. Try a shorter goal or a more focused page.' });
      return;
    }
    if (detail.includes('timed out') || detail.includes('aborted')) {
      response.status(504).json({ stage: 'provider', error: 'The AI request timed out. Please retry.' });
      return;
    }
    if (detail.includes('429') || detail.includes('503') || detail.includes('high demand') || detail.includes('Service Unavailable')) {
      response.status(detail.includes('429') ? 429 : 503).json({ stage: 'provider', error: 'The AI service is busy. Please retry shortly.' });
      return;
    }
    const stage = detail.includes('Planner') || detail.includes('Agent response') ? 'interpretation' : 'provider';
    response.status(502).json({ stage, error: stage === 'interpretation' ? 'The agent could not interpret its next step.' : 'The AI service could not plan this step.' });
  }
});

app.listen(port, () => {
  console.log(`AI browsing agent server listening on http://localhost:${port}`);
});
