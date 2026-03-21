/* =====================================================
   AI Plus Kids — Chat Interface
   Calls the serverless /api/chat endpoint (Vercel).
   The Gemini API key lives ONLY in the backend env var.
   ===================================================== */

// ── Config ─────────────────────────────────────────
// LOCAL DEV  → keep as '/api/chat' (run `vercel dev` from the project root)
// PRODUCTION → change to your full Vercel URL once deployed, e.g.:
//   const API_ENDPOINT = 'https://aipluskids.vercel.app/api/chat';
// GitHub Pages serves the frontend; Vercel serves the backend on a different
// domain, so a relative path won't work in production.
// After deploying to Vercel, paste your Vercel URL above and push to GitHub.
const API_ENDPOINT = 'https://aipluskids.vercel.app/api/chat';

// ── State ──────────────────────────────────────────
let isLoading = false;
const conversationHistory = []; // [{role, parts}] sent to backend

// ── DOM refs ───────────────────────────────────────
const messagesEl = document.getElementById('chatMessages');
const inputEl    = document.getElementById('chatInput');
const sendBtn    = document.getElementById('sendBtn');

// ── Auto-resize textarea ───────────────────────────
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
});

// ── Send on Enter (Shift+Enter = newline) ──────────
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

sendBtn.addEventListener('click', handleSend);

// ── Chip quick-prompts ─────────────────────────────
function sendChip(btn) {
  inputEl.value = btn.textContent;
  handleSend();
}

// ── Main send handler ──────────────────────────────
async function handleSend() {
  const text = inputEl.value.trim();
  if (!text || isLoading) return;

  // Clear the intro screen on first real message
  const intro = messagesEl.querySelector('.intro-message');
  if (intro) intro.remove();

  // Append user bubble
  appendMessage('user', text);
  conversationHistory.push({ role: 'user', parts: [{ text }] });

  inputEl.value = '';
  inputEl.style.height = 'auto';
  setLoading(true);

  // Show typing indicator
  const typingId = appendTyping();

  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history: conversationHistory }),
    });

    removeTyping(typingId);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Server error ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/event-stream')) {
      // ── Streaming response (SSE) ─────────────────
      await handleStream(response);
    } else {
      // ── JSON response (fallback) ─────────────────
      const data = await response.json();
      const reply = data.reply || 'Sorry, I didn\'t get a response. Please try again!';
      appendMessage('ai', reply);
      conversationHistory.push({ role: 'model', parts: [{ text: reply }] });
    }

  } catch (err) {
    removeTyping(typingId);
    console.error('Chat error:', err);

    let userMsg = 'Oops! Something went wrong. Please try again in a moment.';
    if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
      userMsg = '🔌 Unable to connect. Make sure the backend is running and try again.';
    }
    appendMessage('ai', userMsg, true);
  }

  setLoading(false);
  scrollToBottom();
}

// ── Handle SSE streaming ───────────────────────────
async function handleStream(response) {
  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText  = '';

  // Create a streaming bubble
  const bubbleId = 'stream-' + Date.now();
  appendStreamBubble(bubbleId);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;
        try {
          const parsed = JSON.parse(data);
          const token  = parsed.token || '';
          fullText += token;
          updateStreamBubble(bubbleId, fullText);
          scrollToBottom();
        } catch (_) { /* ignore parse errors on partial chunks */ }
      }
    }
  }

  conversationHistory.push({ role: 'model', parts: [{ text: fullText }] });
}

// ── DOM helpers ────────────────────────────────────
function appendMessage(role, text, isError = false) {
  const wrapper = document.createElement('div');
  wrapper.className = `message ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = role === 'user' ? '😊' : '✨';

  const inner = document.createElement('div');

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  if (isError) bubble.style.borderColor = '#fca5a5';
  bubble.textContent = text;

  const time = document.createElement('div');
  time.className = 'msg-time';
  time.textContent = formatTime(new Date());

  inner.appendChild(bubble);
  inner.appendChild(time);

  wrapper.appendChild(avatar);
  wrapper.appendChild(inner);
  messagesEl.appendChild(wrapper);
  scrollToBottom();
  return wrapper;
}

function appendStreamBubble(id) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message ai';
  wrapper.id = id;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = '✨';

  const inner = document.createElement('div');

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.textContent = '';

  const time = document.createElement('div');
  time.className = 'msg-time';
  time.textContent = formatTime(new Date());

  inner.appendChild(bubble);
  inner.appendChild(time);
  wrapper.appendChild(avatar);
  wrapper.appendChild(inner);
  messagesEl.appendChild(wrapper);
  scrollToBottom();
}

function updateStreamBubble(id, text) {
  const el = document.getElementById(id);
  if (el) el.querySelector('.msg-bubble').textContent = text;
}

function appendTyping() {
  const id = 'typing-' + Date.now();
  const wrapper = document.createElement('div');
  wrapper.className = 'message ai typing-indicator';
  wrapper.id = id;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = '✨';

  const inner = document.createElement('div');
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';

  inner.appendChild(bubble);
  wrapper.appendChild(avatar);
  wrapper.appendChild(inner);
  messagesEl.appendChild(wrapper);
  scrollToBottom();
  return id;
}

function removeTyping(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function setLoading(state) {
  isLoading = state;
  sendBtn.disabled = state;
  inputEl.disabled = state;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
