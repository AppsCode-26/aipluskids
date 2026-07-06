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
  .aipk-chip{position:fixed;bottom:16px;right:16px;z-index:9000;display:flex;gap:8px;align-items:center;
    background:#fff;border:1px solid #e5e7eb;border-radius:999px;box-shadow:0 6px 20px rgba(0,0,0,.12);
    padding:8px 14px;font-size:.85rem;color:#374151;font-family:inherit}
  .aipk-chip button,.aipk-chip a{border:none;background:#f3f4f6;border-radius:999px;padding:5px 12px;cursor:pointer;
    font-size:.8rem;font-weight:600;color:#374151;font-family:inherit;text-decoration:none}
  .aipk-chip a{background:#ede9fe;color:#6d28d9}
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
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
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

  function showChip() {
    let chip = document.querySelector('.aipk-chip');
    if (chip) chip.remove();
    chip = document.createElement('div');
    chip.className = 'aipk-chip';
    chip.innerHTML = '⚡ <b>' + String(user.username).replace(/[&<>"']/g, '') + '</b>' +
      (user.role === 'admin' ? ' <a href="admin.html">Admin</a>' : '') +
      ' <button id="aipk-logout">Log out</button>';
    document.body.appendChild(chip);
    chip.querySelector('#aipk-logout').onclick = async () => {
      try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) {}
      setToken(null); user = null; chip.remove(); location.reload();
    };
  }

  function enter(u) {
    user = u;
    hideGate();
    showChip();
    document.dispatchEvent(new CustomEvent('aipk-login', { detail: u }));
    readyResolve(u);
  }

  /* ─── data sync helpers (used by playground scripts) ─────── */

  let saveTimer = null;
  window.AuthAPI = {
    get user() { return user; },
    api,

    /* Teachable AI → "AI Learning Models". Saves {question,answer} pairs
       (embeddings are recomputed locally on load — they're big). */
    saveTeachable(examples, state) {
      if (!user) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        try {
          const parameters = { examples: examples.map(e => ({ id: e.id, question: e.question, answer: e.answer })) };
          const st = state || (examples.length ? 'ready' : 'draft');
          if (modelId) await api('/api/models/' + modelId, { method: 'PUT', body: { parameters, state: st } });
          else {
            const d = await api('/api/models', { method: 'POST', body: { name: 'teachable-ai', parameters, state: st } });
            modelId = d.model.id;
          }
        } catch (e) { console.warn('Teachable sync failed:', e.message); }
      }, 800);
    },

    async loadTeachable() {
      if (!user) return null;
      try {
        const d = await api('/api/models');
        const m = d.models.find(x => x.name === 'teachable-ai');
        if (!m) return null;
        modelId = m.id;
        const params = JSON.parse(m.parameters || '{}');
        return Array.isArray(params.examples) ? params.examples : null;
      } catch (e) { return null; }
    },

    /* Spark chats → text logs, one row per conversation */
    startNewChat() { currentChatId = null; },
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
      showGate();
    } catch (err) {
      if (err.status) { setToken(null); showGate(); return; } // worker reachable, token bad
      // Worker unreachable (not deployed / offline): fail open so the
      // playground still works — nothing will sync to an account.
      console.warn('Auth worker unreachable — playground unlocked, no account sync.', err.message);
      readyResolve(null);
    }
  })();
})();
