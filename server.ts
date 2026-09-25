import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenerativeAI, type Part } from '@google/generative-ai';

const app = express();
const port = Number(process.env.PORT) || 3001;
const apiKey = process.env.GEMINI_API_KEY;
const modelName = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const fallbackModelName = process.env.GEMINI_FALLBACK_MODEL || '';
const projectDirectory = path.dirname(fileURLToPath(import.meta.url));

function isTemporaryProviderError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('429') || message.includes('503') || message.includes('high demand') || message.includes('Service Unavailable');
}

async function generateWithFallback(input: string | Part[]) {
  const models = [modelName, fallbackModelName].filter((model, index, values) => model && values.indexOf(model) === index);
  let lastError: unknown;

  for (const currentModel of models) {
    try {
      const gemini = new GoogleGenerativeAI(apiKey!);
      const model = gemini.getGenerativeModel({ model: currentModel });
      return { result: await model.generateContent(input), model: currentModel };
    } catch (error) {
      lastError = error;
      if (!isTemporaryProviderError(error) || currentModel === models.at(-1)) throw error;
    }
  }

  throw lastError;
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

app.get('/api/diagnostics', (_request, response) => {
  response.json({
    server: 'ok',
    apiKeyPresent: Boolean(apiKey),
    apiKeyLength: apiKey?.length ?? 0,
    model: modelName,
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/diagnostics', async (request, response) => {
  const startedAt = Date.now();
  if (!apiKey) {
    response.status(500).json({ ok: false, stage: 'configuration', error: 'GEMINI_API_KEY is missing.' });
    return;
  }

  try {
    const prompt = typeof request.body?.prompt === 'string' && request.body.prompt.trim()
      ? request.body.prompt.trim().slice(0, 4000)
      : 'Reply with exactly: diagnostic ok';
    const { result, model } = await generateWithFallback(prompt);
    response.json({
      ok: true,
      stage: 'provider',
      model,
      prompt,
      elapsedMs: Date.now() - startedAt,
      response: result.response.text(),
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

  const requestText = typeof request.body?.request === 'string' ? request.body.request.trim() : '';
  const pageText = typeof request.body?.pageText === 'string' ? request.body.pageText.slice(0, 20000) : '';
  const domSnapshot = typeof request.body?.domSnapshot === 'string' ? request.body.domSnapshot.slice(0, 30000) : '';
  const allowActions = request.body?.allowActions === true;
  const image = request.body?.image;
  const hasImage = typeof image?.data === 'string' && typeof image?.mimeType === 'string';
  if (!requestText || !domSnapshot) {
    response.status(400).json({ error: 'A request and DOM snapshot are required.' });
    return;
  }

  const instruction = `You are a browser assistant. Analyze the page structure and text, then help with the user's request.${hasImage ? ' Use the screenshot only to resolve visual details that the page structure cannot explain.' : ''}
Return ONLY valid JSON with this shape:
{"answer":"short helpful answer","action":null}
or:
{"answer":"what you plan to do","action":{"type":"click|type|scroll|open_url","selector":"optional CSS selector","text":"optional text","url":"optional URL","amount":"optional integer","pressEnter":true}}
Rules: ${allowActions ? 'You may suggest one browser action. For search requests, use type on the search input and set pressEnter true so the page submits the search.' : 'Do not suggest a browser action; provide the solution as text only and set action to null.'} Prefer visible, specific selectors. Do not suggest destructive actions, purchases, sending messages, deleting data, or form submissions.

User request: ${requestText}

Page text:
${pageText}

DOM snapshot:
${domSnapshot}`;

  try {
    const content: Part[] = [{ text: instruction }];
    if (hasImage) content.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
    const { result, model } = await generateWithFallback(content);
    const rawText = result.response.text().trim().replace(/^```json\s*|\s*```$/g, '');
    response.json({ ...JSON.parse(rawText), model });
  } catch (error) {
    const providerError = error instanceof Error ? error.message : String(error);
    console.error('Agent request failed:', providerError);
    if (isTemporaryProviderError(error)) {
  			response.status(providerError.includes('429') ? 429 : 503).json({ error: 'The AI service is busy. Please retry shortly.' });
      return;
    }
    response.status(502).json({ error: 'The agent could not process this page.' });
  }
});

app.listen(port, () => {
  console.log(`AI browsing agent server listening on http://localhost:${port}`);
});
