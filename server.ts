import 'dotenv/config';
import express from 'express';
import { GoogleGenerativeAI, type Part } from '@google/generative-ai';

const app = express();
const port = Number(process.env.PORT) || 3001;
const apiKey = process.env.GEMINI_API_KEY;
const modelName = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

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
{"answer":"what you plan to do","action":{"type":"click|type|scroll|open_url","selector":"optional CSS selector","text":"optional text","url":"optional URL","amount":"optional integer"}}
Rules: ${allowActions ? 'You may suggest one browser action.' : 'Do not suggest a browser action; provide the solution as text only and set action to null.'} Prefer visible, specific selectors. Do not suggest destructive actions, purchases, sending messages, deleting data, or form submissions.

User request: ${requestText}

Page text:
${pageText}

DOM snapshot:
${domSnapshot}`;

  try {
    const gemini = new GoogleGenerativeAI(apiKey);
    const model = gemini.getGenerativeModel({ model: modelName });
    const content: Part[] = [{ text: instruction }];
    if (hasImage) content.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
    const result = await model.generateContent(content);
    const rawText = result.response.text().trim().replace(/^```json\s*|\s*```$/g, '');
    response.json(JSON.parse(rawText));
  } catch (error) {
    console.error('Agent request failed:', error);
    response.status(502).json({ error: 'The agent could not process this page.' });
  }
});

app.listen(port, () => {
  console.log(`AI browsing agent server listening on http://localhost:${port}`);
});
