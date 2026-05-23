/* ════════════════════════════════════════════════════════════
   Spark — AI + Kids learning assistant
   Full-page chat engine powered by Google Gemini
   ════════════════════════════════════════════════════════════ */

const SPARK = {
  apiKey: 'AIzaSyBGzs8GS4ObpciID2WvL85PfNHCGeM3kvc',
  model:  'gemini-2.5-flash',
  get url() {
    return `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:streamGenerateContent`;
  },
};

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

const WELCOME =
  "Hi there! I'm **Spark**, your AI learning buddy. I can explain how AI works, help with science questions, spark creative ideas, and share learning tips. What would you like to explore today?";

const STARTERS = [
  'What is artificial intelligence?',
  'How does a computer learn?',
  'Help me write a short story',
  'Give me a fun science fact',
  'How can I use AI safely?',
];

/* ─── tiny, safe markdown renderer ─────────────────────────── */
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function renderMarkdown(text) {
  const lines = escapeHtml(text).split('\n');
  let html = '';
  let listType = null; // 'ul' | 'ol' | null

  const closeList = () => { if (listType) { html += `</${listType}>`; listType = null; } };

  const inline = (s) => s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\*)([^*]+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/`([^`]+?)`/g, '<code>$1</code>');

  for (let raw of lines) {
    const line = raw.trimEnd();
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);

    if (ul) {
      if (listType !== 'ul') { closeList(); html += '<ul>'; listType = 'ul'; }
      html += `<li>${inline(ul[1])}</li>`;
    } else if (ol) {
      if (listType !== 'ol') { closeList(); html += '<ol>'; listType = 'ol'; }
      html += `<li>${inline(ol[1])}</li>`;
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList();
      html += `<p>${inline(line)}</p>`;
    }
  }
  closeList();
  return html || `<p>${inline(escapeHtml(''))}</p>`;
}

/* ─── Spark chat controller ────────────────────────────────── */
class SparkChat {
  constructor(root) {
    this.root      = root;
    this.stream    = root.querySelector('[data-spark-stream]');
    this.form      = root.querySelector('[data-spark-form]');
    this.input     = root.querySelector('[data-spark-input]');
    this.sendBtn   = root.querySelector('[data-spark-send]');
    this.clearBtn  = root.querySelector('[data-spark-clear]');
    this.prompts   = root.querySelector('[data-spark-prompts]');

    this.history   = [];
    this.busy      = false;

    this.bindEvents();
    this.reset();
  }

  bindEvents() {
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });

    // Enter to send, Shift+Enter for newline
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.submit();
      }
    });

    // auto-grow textarea
    this.input.addEventListener('input', () => this.autoGrow());

    if (this.clearBtn) {
      this.clearBtn.addEventListener('click', () => this.reset());
    }

    if (this.prompts) {
      this.prompts.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-prompt]');
        if (!chip) return;
        this.input.value = chip.dataset.prompt;
        this.autoGrow();
        this.submit();
      });
    }
  }

  autoGrow() {
    this.input.style.height = 'auto';
    this.input.style.height = Math.min(this.input.scrollHeight, 160) + 'px';
  }

  reset() {
    this.history = [];
    this.stream.innerHTML = '';
    this.addMessage('bot', WELCOME);
    this.renderStarters();
    this.input.value = '';
    this.autoGrow();
    this.input.focus();
  }

  renderStarters() {
    if (!this.prompts) return;
    this.prompts.innerHTML = STARTERS
      .map(p => `<button type="button" class="spark-chip" data-prompt="${escapeHtml(p)}">${escapeHtml(p)}</button>`)
      .join('');
    this.prompts.style.display = 'flex';
  }

  hideStarters() {
    if (this.prompts) this.prompts.style.display = 'none';
  }

  addMessage(role, text) {
    const row = document.createElement('div');
    row.className = `spark-msg spark-msg--${role}`;

    if (role === 'bot') {
      row.innerHTML = `
        <div class="spark-avatar" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L14 8H20L15 12L17 18L12 14L7 18L9 12L4 8H10L12 2Z"/></svg>
        </div>
        <div class="spark-text"></div>`;
      row.querySelector('.spark-text').innerHTML = renderMarkdown(text);
    } else {
      row.innerHTML = `<div class="spark-text"></div>`;
      row.querySelector('.spark-text').textContent = text;
    }

    this.stream.appendChild(row);
    this.scrollDown();
    return row.querySelector('.spark-text');
  }

  showTyping() {
    const row = document.createElement('div');
    row.className = 'spark-msg spark-msg--bot';
    row.innerHTML = `
      <div class="spark-avatar" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L14 8H20L15 12L17 18L12 14L7 18L9 12L4 8H10L12 2Z"/></svg>
      </div>
      <div class="spark-text"><span class="spark-typing"><i></i><i></i><i></i></span></div>`;
    this.stream.appendChild(row);
    this.scrollDown();
    return row;
  }

  scrollDown() {
    this.stream.scrollTop = this.stream.scrollHeight;
  }

  setBusy(state) {
    this.busy = state;
    this.sendBtn.disabled = state;
    this.input.disabled = state;
  }

  async submit() {
    const text = this.input.value.trim();
    if (!text || this.busy) return;

    this.hideStarters();
    this.addMessage('user', text);
    this.history.push({ role: 'user', parts: [{ text }] });

    this.input.value = '';
    this.autoGrow();
    this.setBusy(true);

    const typingRow = this.showTyping();
    let target = null;

    try {
      const reply = await this.streamReply((token, full) => {
        if (!target) {
          typingRow.remove();
          target = this.addMessage('bot', '');
        }
        target.innerHTML = renderMarkdown(full);
        this.scrollDown();
      });

      if (!target) {
        typingRow.remove();
        target = this.addMessage('bot', '');
      }
      const finalText = reply || "Hmm, I didn't catch that. Could you try asking again?";
      target.innerHTML = renderMarkdown(finalText);
      this.history.push({ role: 'model', parts: [{ text: finalText }] });

    } catch (err) {
      console.error('Spark error:', err);
      typingRow.remove();
      const msg = this.errorMessage(err);
      this.addMessage('bot', msg);
      // drop the failed user turn so retry stays clean
      this.history.pop();
    } finally {
      this.setBusy(false);
      this.input.focus();
      this.scrollDown();
    }
  }

  errorMessage(err) {
    const m = String(err && err.message || err);
    if (m.includes('429')) return "I'm getting a lot of questions right now! Please wait a moment and try again.";
    if (m.includes('40'))  return "Something went wrong reaching my brain. Please try again in a moment.";
    if (m.toLowerCase().includes('failed to fetch') || m.toLowerCase().includes('network'))
      return "I can't connect right now. Please check your internet connection and try again.";
    return "Oops! Something went wrong. Please try again in a moment.";
  }

  /* Stream a response from Gemini, calling onToken(token, fullSoFar) */
  async streamReply(onToken) {
    const body = {
      system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: this.history,
      generationConfig: {
        temperature: 0.75,
        maxOutputTokens: 1024,
        topP: 0.95,
        thinkingConfig: { thinkingBudget: 0 },  // disable thinking for fast, kid-friendly answers
      },
      safetySettings: SAFETY_SETTINGS,
    };

    const res = await fetch(`${SPARK.url}?alt=sse&key=${SPARK.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`API ${res.status}`);

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';   // holds incomplete SSE lines across chunks
    let full   = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();   // keep the (possibly incomplete) last line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === '[DONE]') continue;

        try {
          const json   = JSON.parse(payload);
          const token  = json?.candidates?.[0]?.content?.parts?.[0]?.text;
          const reason = json?.candidates?.[0]?.finishReason;
          if (token) { full += token; onToken(token, full); }
          if (reason && reason !== 'STOP' && reason !== 'MAX_TOKENS') {
            full += "\n\nI can't help with that, but I'm happy to answer other questions!";
            onToken('', full);
          }
        } catch (_) { /* partial JSON across chunks — ignore */ }
      }
    }
    return full;
  }
}

/* ─── boot ──────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const root = document.querySelector('[data-spark-root]');
  if (root) new SparkChat(root);
});
