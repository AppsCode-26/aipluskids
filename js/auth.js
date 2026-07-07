/* ════════════════════════════════════════════════════════════
   AI + Kids — sign-in gate & account sync for the AI Playground
   ────────────────────────────────────────────────────────────
   Shows a login window (with a create-account view) in front of
   the playground. Once signed in, each user's Teachable-AI models
   and Spark chats are saved to their account via the spark-auth
   Cloudflare Worker (see worker/auth-worker.js).

   NOTE: if the auth worker is unreachable (not deployed yet, or
   offline), the gate "fails open" so the playground still works —
   data then stays in the browser only.
   ════════════════════════════════════════════════════════════ */

(function () {
  const AUTH = {
    workerUrl: 'https://spark-auth.n4dwdnrcvt.workers.dev', // ← your deployed auth worker
    tokenKey: 'aipk-auth-token',
  };

  let token = null;
  try { token = localStorage.getItem(AUTH.tokenKey); } catch (e) {}
  let user = null;
  let currentChatId = null;
  let modelId = null;          // server id of this user's Teachable-AI model
  let readyResolve;
  window.AuthReady = new Promise(res => { readyResolve = res; });
  // Pages with data-auth-gate on <body> (playground, admin) require sign-in;
  // everywhere else auth.js only renders the little account icon in the nav.
  const GATED = document.body.hasAttribute('data-auth-gate');

  /* ─── tiny API client ────────────────────────────────────── */
  async function api(path, opts) {
    opts = opts || {};
    const res = await fetch(AUTH.workerUrl + path, {
      method: opts.method || 'GET',
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        token ? { Authorization: 'Bearer ' + token } : {}
      ),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || 'Request failed'); e.status = res.status; throw e; }
    return data;
  }

  function setToken(t) {
    token = t;
    try { t ? localStorage.setItem(AUTH.tokenKey, t) : localStorage.removeItem(AUTH.tokenKey); } catch (e) {}
  }

  /* ─── overlay UI ─────────────────────────────────────────── */
  const css = `
  .aipk-gate{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;
    background:rgba(30,27,75,.55);backdrop-filter:blur(6px);padding:20px}
  .aipk-card{background:#fff;border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,.25);
    padding:34px 32px;width:100%;max-width:400px;font-family:inherit}
  .aipk-card h2{margin:0 0 4px;font-size:1.45rem;color:#1e1b4b}
  .aipk-card .aipk-sub{color:#6b7280;font-size:.92rem;margin-bottom:20px}
  .aipk-card label{display:block;font-size:.82rem;font-weight:600;color:#374151;margin:14px 0 6px}
  .aipk-card input{width:100%;box-sizing:border-box;padding:11px 13px;border:1.5px solid #d1d5db;
    border-radius:10px;font-size:.98rem;font-family:inherit}
  .aipk-card input:focus{outline:none;border-color:#6d28d9}
  .aipk-btn{width:100%;margin-top:22px;padding:12px;border:none;border-radius:10px;cursor:pointer;
    background:#6d28d9;color:#fff;font-size:1rem;font-weight:700;font-family:inherit}
  .aipk-btn:hover{background:#5b21b6}
  .aipk-msg{min-height:1.3em;margin-top:12px;font-size:.86rem;color:#dc2626}
  .aipk-switch{text-align:center;margin-top:16px;font-size:.88rem;color:#6b7280}
  .aipk-switch a{color:#6d28d9;font-weight:600;cursor:pointer;text-decoration:none}
  .aipk-acct{position:relative;display:flex;align-items:center}
  .aipk-acct-btn{display:flex;align-items:center;gap:7px;border:none;cursor:pointer;background:transparent;
    font-family:inherit;padding:4px;border-radius:999px}
  .aipk-avatar{width:34px;height:34px;border-radius:50%;background:#6d28d9;color:#fff;font-weight:700;
    font-size:.95rem;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
  .aipk-avatar--out{background:#eef0f4;color:#4b5563}
  .aipk-avatar svg{width:18px;height:18px}
  .aipk-signin-label{font-weight:600;font-size:.9rem;color:#374151;white-space:nowrap}
  .aipk-menu{position:absolute;top:calc(100% + 10px);right:0;background:#fff;border:1px solid #e5e7eb;
    border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.16);min-width:180px;padding:8px;z-index:9500}
  .aipk-menu-name{padding:8px 12px;font-weight:700;color:#1e1b4b;font-size:.92rem;border-bottom:1px solid #f3f4f6;margin-bottom:6px}
  .aipk-menu-name small{display:block;font-weight:500;color:#6b7280;font-size:.74rem;margin-top:2px}
  .aipk-menu a,.aipk-menu button{display:block;width:100%;box-sizing:border-box;text-align:left;border:none;
    background:transparent;padding:9px 12px;border-radius:8px;cursor:pointer;font-family:inherit;
    font-size:.88rem;font-weight:600;color:#374151;text-decoration:none}
  .aipk-menu a:hover,.aipk-menu button:hover{background:#f3f4f6}
  .aipk-menu .aipk-out{color:#dc2626}
  .aipk-hide{display:none!important}`;

  const overlayHtml = `
  <div class="aipk-card">
    <div id="aipk-login">
      <h2>👋 Welcome!</h2>
      <div class="aipk-sub">Sign in to use the AI Playground</div>
      <form id="aipk-login-form">
        <label>Username</label><input id="aipk-l-user" autocomplete="username" required>
        <label>Password</label><input id="aipk-l-pass" type="password" autocomplete="current-password" required>
        <button class="aipk-btn" type="submit">Sign In</button>
      </form>
      <div class="aipk-msg" id="aipk-l-msg"></div>
      <div class="aipk-switch">New here? <a id="aipk-to-reg">Create an account</a></div>
    </div>
    <div id="aipk-reg" class="aipk-hide">
      <h2>🚀 Create account</h2>
      <div class="aipk-sub">Pick a username — no email needed</div>
      <form id="aipk-reg-form">
        <label>Username (letters, numbers, _)</label><input id="aipk-r-user" autocomplete="username" required minlength="3" maxlength="30">
        <label>Password (8+ characters)</label><input id="aipk-r-pass" type="password" autocomplete="new-password" required minlength="8">
        <label>Confirm password</label><input id="aipk-r-pass2" type="password" autocomplete="new-password" required>
        <button class="aipk-btn" type="submit">Create Account</button>
      </form>
      <div class="aipk-msg" id="aipk-r-msg"></div>
      <div class="aipk-switch">Have an account? <a id="aipk-to-login">Sign in</a></div>
    </div>
  </div>`;

  let gateEl = null;

  function showGate() {
    if (gateEl) { gateEl.classList.remove('aipk-hide'); return; }
    ensureStyles();
    gateEl = document.createElement('div');
    gateEl.className = 'aipk-gate';
    gateEl.innerHTML = overlayHtml;
    document.body.appendChild(gateEl);
    const $ = id => gateEl.querySelector('#' + id);
    $('aipk-to-reg').onclick = () => { $('aipk-login').classList.add('aipk-hide'); $('aipk-reg').classList.remove('aipk-hide'); };
    $('aipk-to-login').onclick = () => { $('aipk-reg').classList.add('aipk-hide'); $('aipk-login').classList.remove('aipk-hide'); };
    $('aipk-login-form').addEventListener('submit', async e => {
      e.preventDefault(); $('aipk-l-msg').textContent = '';
      try {
        const d = await api('/api/auth/login', { method: 'POST', body: { username: $('aipk-l-user').value.trim(), password: $('aipk-l-pass').value } });
        setToken(d.token); enter(d.user);
      } catch (err) { $('aipk-l-msg').textContent = err.message; }
    });
    $('aipk-reg-form').addEventListener('submit', async e => {
      e.preventDefault(); $('aipk-r-msg').textContent = '';
      if ($('aipk-r-pass').value !== $('aipk-r-pass2').value) { $('aipk-r-msg').textContent = 'Passwords do not match.'; return; }
      try {
        const d = await api('/api/auth/register', { method: 'POST', body: { username: $('aipk-r-user').value.trim(), password: $('aipk-r-pass').value } });
        setToken(d.token); enter(d.user);
      } catch (err) { $('aipk-r-msg').textContent = err.message; }
    });
  }

  function hideGate() { if (gateEl) gateEl.classList.add('aipk-hide'); }

  /* ─── nav account widget (next to the Get Involved button) ── */

  const PERSON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

  function ensureStyles() {
    if (document.getElementById('aipk-styles')) return;
    const style = document.createElement('style');
    style.id = 'aipk-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function widgetMount() {
    let el = document.querySelector('.aipk-acct');
    if (el) { el.innerHTML = ''; return el; }
    el = document.createElement('div');
    el.className = 'aipk-acct';
    const navRight = document.querySelector('.nav__right');
    if (navRight) navRight.appendChild(el);
    else { el.style.cssText = 'position:fixed;top:14px;right:16px;z-index:9000'; document.body.appendChild(el); }
    return el;
  }

  function renderAccountWidget() {
    ensureStyles();
    const el = widgetMount();
    const name = String(user.username).replace(/[&<>"']/g, '');
    el.innerHTML =
      '<button class="aipk-acct-btn" aria-label="Your account" title="' + name + '">' +
        '<span class="aipk-avatar">' + name.charAt(0).toUpperCase() + '</span>' +
      '</button>' +
      '<div class="aipk-menu aipk-hide">' +
        '<div class="aipk-menu-name">⚡ ' + name + (user.role === 'admin' ? '<small>Master Admin</small>' : '') + '</div>' +
        (user.role === 'admin' ? '<a href="admin.html">Admin console</a>' : '') +
        '<button class="aipk-out">Sign out</button>' +
      '</div>';
    const menu = el.querySelector('.aipk-menu');
    el.querySelector('.aipk-acct-btn').onclick = e => { e.stopPropagation(); menu.classList.toggle('aipk-hide'); };
    document.addEventListener('click', () => menu.classList.add('aipk-hide'));
    el.querySelector('.aipk-out').onclick = async () => {
      try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) {}
      setToken(null); user = null; location.reload();
    };
  }

  function renderSignInWidget() {
    ensureStyles();
    const el = widgetMount();
    el.innerHTML =
      '<button class="aipk-acct-btn" aria-label="Sign in">' +
        '<span class="aipk-avatar aipk-avatar--out">' + PERSON_SVG + '</span>' +
        '<span class="aipk-signin-label">Sign in</span>' +
      '</button>';
    el.querySelector('.aipk-acct-btn').onclick = () => {
      if (GATED) showGate();                    // gate lives on this page
      else window.location.href = 'playground.html';  // sign in / sign up there
    };
  }

  function enter(u) {
    user = u;
    hideGate();
    renderAccountWidget();
    document.dispatchEvent(new CustomEvent('aipk-login', { detail: u }));
    readyResolve(u);
  }

  /* ─── data sync helpers (used by playground scripts) ─────── */

  let saveTimer = null;
  const packExamples = examples =>
    ({ examples: examples.map(e => ({ id: e.id, question: e.question, answer: e.answer })) });
  const unpackModel = m => {
    let ex = [];
    try { const p = JSON.parse(m.parameters || '{}'); if (Array.isArray(p.examples)) ex = p.examples; } catch (e) {}
    return { id: m.id, name: m.name, examples: ex, updated_at: m.updated_at };
  };

  window.AuthAPI = {
    get user() { return user; },
    api,

    /* ── Teachable AI → named bots ("AI Learning Models") ──────
       Each saved bot is one ai_models row; embeddings are
       recomputed locally on load (they're big). */

    get currentBotId() { return modelId; },

    async listBots() {
      if (!user) return [];
      try { return (await api('/api/models')).models.map(unpackModel); }
      catch (e) { return []; }
    },

    async saveBot(name, examples) {
      if (!user) return null;
      const bots = await this.listBots();
      const existing = bots.find(b => b.name.toLowerCase() === name.toLowerCase());
      const body = { name, parameters: packExamples(examples), state: examples.length ? 'ready' : 'draft' };
      const d = existing
        ? await api('/api/models/' + existing.id, { method: 'PUT', body })
        : await api('/api/models', { method: 'POST', body });
      modelId = d.model.id;
      return unpackModel(d.model);
    },

    async loadBot(id) {
      const bots = await this.listBots();
      const bot = bots.find(b => b.id === Number(id));
      if (bot) modelId = bot.id;
      return bot || null;
    },

    async loadLatestBot() {
      const bots = await this.listBots(); // already sorted by updated_at DESC
      if (!bots.length) return null;
      modelId = bots[0].id;
      return bots[0];
    },

    async deleteBot(id) {
      if (!user) return;
      await api('/api/models/' + id, { method: 'DELETE' });
      if (modelId === Number(id)) modelId = null;
    },

    /* Auto-save edits into the currently loaded/saved bot */
    autoSaveBot(examples) {
      if (!user || !modelId) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        try {
          await api('/api/models/' + modelId, { method: 'PUT', body: {
            parameters: packExamples(examples), state: examples.length ? 'ready' : 'draft' } });
        } catch (e) { console.warn('Bot sync failed:', e.message); }
      }, 800);
    },

    /* ── Spark chats → text logs, one row per conversation ───── */

    startNewChat() { currentChatId = null; },
    resumeChat(id) { currentChatId = Number(id); },

    async listChats() {
      if (!user) return [];
      try { return (await api('/api/chats')).chats; }
      catch (e) { return []; }
    },

    async saveSparkChat(history) {
      if (!user || !history || !history.length) return;
      try {
        const text = history.map(h =>
          (h.role === 'user' ? 'Kid: ' : 'Spark: ') + h.parts.map(p => p.text).join(' ')).join('\n\n');
        const firstUser = history.find(h => h.role === 'user');
        const title = (firstUser ? firstUser.parts[0].text : 'Spark chat').slice(0, 80);
        if (currentChatId) await api('/api/chats/' + currentChatId, { method: 'PUT', body: { content: text } });
        else {
          const d = await api('/api/chats', { method: 'POST', body: { title, content: text } });
          currentChatId = d.chat.id;
        }
      } catch (e) { console.warn('Chat sync failed:', e.message); }
    },
  };

  /* ─── boot ───────────────────────────────────────────────── */
  (async function boot() {
    try {
      const d = await api('/api/auth/me'); // also probes that the worker is reachable
      if (d.user) { enter(d.user); return; }
      if (token) setToken(null);
      renderSignInWidget();
      if (GATED) showGate(); else readyResolve(null);
    } catch (err) {
      if (err.status) { setToken(null); renderSignInWidget(); if (GATED) showGate(); else readyResolve(null); return; }
      // Worker unreachable (not deployed / offline): fail open so the
      // playground still works — nothing will sync to an account.
      console.warn('Auth worker unreachable — playground unlocked, no account sync.', err.message);
      readyResolve(null);
    }
  })();
})();
