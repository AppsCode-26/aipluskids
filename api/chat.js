/**
 * AI Plus Kids — Serverless Chat Endpoint
 * Deploy on Vercel (or Netlify with minor adjustments).
 *
 * Environment variable required:
 *   GEMINI_API_KEY  — set this in your Vercel project settings.
 *                     NEVER put the key in frontend code.
 *
 * POST /api/chat
 * Body: { history: [{role, parts:[{text}]}] }
 *   - "history" includes the new user message as the last item.
 */

const GEMINI_MODEL   = 'gemini-2.0-flash';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent`;

// Kid-safe system prompt — shapes every response
const SYSTEM_INSTRUCTION = `You are Spark, a friendly and enthusiastic AI learning assistant for AI Plus Kids,
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
7. Keep responses concise and easy to read — use bullet points, simple lists, and short paragraphs.
8. Celebrate curiosity! Every question is a great question.

Topics you love: AI, technology, science, creative writing, learning tips, how things work.
Topics to avoid or gently redirect: anything unsafe, political, adult, or outside your role.`;

const ALLOWED_ORIGIN = 'https://www.aipluskids.org';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin',  ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY environment variable is not set.');
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  const { history } = req.body || {};

  if (!Array.isArray(history) || history.length === 0) {
    return res.status(400).json({ error: 'Invalid request: history array is required.' });
  }

  // Validate and sanitize history entries
  const sanitizedHistory = history
    .filter(entry =>
      entry &&
      (entry.role === 'user' || entry.role === 'model') &&
      Array.isArray(entry.parts) &&
      entry.parts.length > 0 &&
      typeof entry.parts[0].text === 'string'
    )
    .map(entry => ({
      role: entry.role,
      parts: [{ text: entry.parts[0].text.slice(0, 4000) }], // cap message length
    }));

  if (sanitizedHistory.length === 0) {
    return res.status(400).json({ error: 'No valid messages in history.' });
  }

  // Ensure history ends with a user message
  if (sanitizedHistory[sanitizedHistory.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'Last message must be from user.' });
  }

  const requestBody = {
    system_instruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }],
    },
    contents: sanitizedHistory,
    generationConfig: {
      temperature:     0.75,
      maxOutputTokens: 1024,
      topP:            0.95,
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_LOW_AND_ABOVE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_LOW_AND_ABOVE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_LOW_AND_ABOVE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_LOW_AND_ABOVE' },
    ],
  };

  try {
    const geminiRes = await fetch(`${GEMINI_API_URL}?key=${apiKey}&alt=sse`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(requestBody),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini API error:', geminiRes.status, errText);
      return res.status(502).json({ error: 'AI service unavailable. Please try again.' });
    }

    // Stream SSE back to the browser
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    // CORS headers already set at top of handler

    const reader  = geminiRes.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete last line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(jsonStr);
          const token  = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (token) {
            res.write(`data: ${JSON.stringify({ token })}\n\n`);
          }

          // Check for finish reason
          const finishReason = parsed?.candidates?.[0]?.finishReason;
          if (finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') {
            // Safety block or other stop — send a safe message
            res.write(`data: ${JSON.stringify({ token: "\n\nI can't help with that, but I'm happy to answer other questions!" })}\n\n`);
          }
        } catch (_) {
          // Ignore JSON parse errors on partial SSE chunks
        }
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    console.error('Unexpected error in /api/chat:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'An unexpected error occurred.' });
    } else {
      res.end();
    }
  }
}
