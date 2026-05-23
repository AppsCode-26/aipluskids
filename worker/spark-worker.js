/* ════════════════════════════════════════════════════════════
   Spark proxy — Cloudflare Worker for AI + Kids
   ────────────────────────────────────────────────────────────
   Holds the Gemini API key SERVER-SIDE so it never appears in the
   website's source or in the public GitHub repo.

   DEPLOY (Cloudflare dashboard):
   1. dash.cloudflare.com → Workers & Pages → Create → Worker
   2. Name it e.g. "spark-proxy", click Deploy, then "Edit code"
   3. Paste this entire file, click Deploy
   4. Settings → Variables and Secrets → Add → type "Secret":
        Name:  GEMINI_API_KEY
        Value: <your NEW Gemini key from aistudio.google.com>
      Save, then Deploy again.
   5. Copy your Worker URL (e.g. https://spark-proxy.<you>.workers.dev)
      and paste it into js/spark.js as WORKER_URL.
   ════════════════════════════════════════════════════════════ */

const MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent`;

// Only these origins may call the worker
const ALLOWED_ORIGINS = [
  'https://www.aipluskids.org',
  'https://aipluskids.org',
  'http://localhost:3000',
];

const SYSTEM_INSTRUCTION = `You are Spark, a friendly and enthusiastic AI learning assistant for AI + Kids,
a nonprofit that teaches K–8 students about artificial intelligence.

Your personality:
- Warm, encouraging, and age-appropriate for children in grades K–8
- Patient and clear — use simple language, short sentences, and relatable examples
- Curious and enthusiastic about learning and technology
- Honest about what you don't know or what AI can't do

Your rules:
1. Always prioritize child safety. Never produce content that is violent, sexual, scary, or harmful.
2. If a child asks something inappropriate, gently redirect: "That's not something I can help with, but let's talk about something cool instead!"
3. Never ask for or encourage sharing personal information (full name, address, school, phone number, etc.).
4. Be honest that you are an AI and can make mistakes — encourage kids to verify important facts.
5. Promote responsible AI use: help kids think and learn, rather than doing their work for them.
6. When helping with homework, guide with hints and explanations rather than giving direct answers.
7. Keep responses concise and easy to read — use short paragraphs, and use markdown bullet lists ("- ") or **bold** when it helps.
8. Celebrate curiosity! Every question is a great question.

Topics you love: AI, technology, science, creative writing, learning tips, how things work.
Topics to avoid or gently redirect: anything unsafe, political, adult, or outside your role.`;

const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_LOW_AND_ABOVE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_LOW_AND_ABOVE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_LOW_AND_ABOVE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_LOW_AND_ABOVE' },
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env) {
    const origin  = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, headers);
    }
    if (!env.GEMINI_API_KEY) {
      return json({ error: 'Server is not configured (missing GEMINI_API_KEY).' }, 500, headers);
    }

    // parse + validate body
    let history;
    try {
      ({ history } = await request.json());
    } catch {
      return json({ error: 'Invalid JSON body.' }, 400, headers);
    }
    if (!Array.isArray(history) || history.length === 0) {
      return json({ error: 'A non-empty "history" array is required.' }, 400, headers);
    }

    // sanitize history, cap message length
    const contents = history
      .filter(e =>
        e && (e.role === 'user' || e.role === 'model') &&
        Array.isArray(e.parts) && typeof e.parts[0]?.text === 'string')
      .map(e => ({ role: e.role, parts: [{ text: e.parts[0].text.slice(0, 4000) }] }));

    if (contents.length === 0 || contents[contents.length - 1].role !== 'user') {
      return json({ error: 'History must end with a user message.' }, 400, headers);
    }

    const body = {
      system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents,
      generationConfig: {
        temperature: 0.75,
        maxOutputTokens: 1024,
        topP: 0.95,
        thinkingConfig: { thinkingBudget: 0 },
      },
      safetySettings: SAFETY_SETTINGS,
    };

    const geminiRes = await fetch(`${GEMINI_URL}?alt=sse&key=${env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!geminiRes.ok) {
      const detail = (await geminiRes.text()).slice(0, 300);
      return json({ error: 'AI service error.', status: geminiRes.status, detail }, 502, headers);
    }

    // Stream Gemini's SSE straight back to the browser
    return new Response(geminiRes.body, {
      headers: {
        ...headers,
        'Content-Type':  'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    });
  },
};
