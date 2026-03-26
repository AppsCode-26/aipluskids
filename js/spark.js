/* ─── Spark — AI + Kids Chat Widget ─────────────────── */

const GEMINI_API_KEY = 'AIzaSyAz5ezzRAidUbiJVsxA7CMzdCFoHK0f9Tk';
const GEMINI_MODEL   = 'gemini-2.0-flash';
const GEMINI_API_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent`;

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

/* ── state ── */
const chatHistory = [];          // { role, parts:[{text}] }
let   isStreaming = false;

/* ── DOM refs (set on init) ── */
let chatPanel, chatMessages, chatInput, chatSend, chatToggle, chatBadge;

/* ── helpers ── */
function scrollBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addBubble(role, text) {
  const div = document.createElement('div');
  div.className = `spark-bubble spark-${role}`;
  div.textContent = text;
  chatMessages.appendChild(div);
  scrollBottom();
  return div;
}

/* ── stream a Gemini response ── */
async function sendMessage(userText) {
  if (isStreaming || !userText.trim()) return;
  isStreaming = true;
  chatSend.disabled = true;

  // user bubble
  addBubble('user', userText);
  chatHistory.push({ role: 'user', parts: [{ text: userText }] });

  // bot bubble (will be filled progressively)
  const botDiv = addBubble('model', '');
  botDiv.innerHTML = '<span class="spark-dot"></span><span class="spark-dot"></span><span class="spark-dot"></span>';

  const body = {
    system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: chatHistory,
    generationConfig: { temperature: 0.7, maxOutputTokens: 512 }
  };

  try {
    const res = await fetch(`${GEMINI_API_URL}?alt=sse&key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error(`API ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    botDiv.textContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      // SSE lines that start with "data: "
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          const json = JSON.parse(line.slice(6));
          const token = json?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (token) { full += token; botDiv.textContent = full; scrollBottom(); }
        } catch (_) { /* partial JSON, skip */ }
      }
    }

    if (!full) full = "Hmm, I didn't get a response. Try asking again!";
    botDiv.textContent = full;
    chatHistory.push({ role: 'model', parts: [{ text: full }] });

  } catch (err) {
    console.error('Spark error:', err);
    botDiv.textContent = "Oops! Something went wrong. Please try again in a moment.";
  }

  isStreaming = false;
  chatSend.disabled = false;
  chatInput.focus();
  scrollBottom();
}

/* ── build chat panel (no floating widget) ── */
function initSpark() {
  // panel
  chatPanel = document.createElement('div');
  chatPanel.className = 'spark-panel';
  chatPanel.innerHTML = `
    <div class="spark-header">
      <div class="spark-header-left">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L14 8H20L15 12L17 18L12 14L7 18L9 12L4 8H10L12 2Z"/></svg>
        <span>Spark</span>
      </div>
      <button class="spark-close" aria-label="Close chat">&times;</button>
    </div>
    <div class="spark-messages"></div>
    <form class="spark-form">
      <input type="text" class="spark-input" placeholder="Ask Spark anything..." autocomplete="off"/>
      <button type="submit" class="spark-send" aria-label="Send">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </form>`;

  document.body.appendChild(chatPanel);

  chatMessages = chatPanel.querySelector('.spark-messages');
  chatInput    = chatPanel.querySelector('.spark-input');
  chatSend     = chatPanel.querySelector('.spark-send');
  const chatClose = chatPanel.querySelector('.spark-close');
  const chatForm  = chatPanel.querySelector('.spark-form');

  // welcome message
  addBubble('model', "Hi there! I'm Spark, your AI learning buddy. Ask me anything about AI, science, or how things work!");

  // footer link opens panel
  document.querySelectorAll('.spark-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      chatPanel.classList.add('open');
      chatInput.focus();
    });
  });

  chatClose.addEventListener('click', () => {
    chatPanel.classList.remove('open');
  });

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    sendMessage(text);
  });
}

document.addEventListener('DOMContentLoaded', initSpark);
