/* ════════════════════════════════════════════════════════════
   Spark Auth — Cloudflare Worker for AI + Kids
   ────────────────────────────────────────────────────────────
   User accounts, sessions, per-user Spark Chats and AI Learning
   Models, plus a Master Admin API. Backed by a D1 (SQLite) database.

   DEPLOY (Cloudflare dashboard) — see worker/AUTH_DEPLOY.md
   Quick version:
   1. Workers & Pages → Create → Worker → name it "spark-auth" → Deploy
   2. "Edit code" → paste this file → Deploy
   3. Storage & Databases → D1 → Create database → name "spark_auth"
   4. Worker → Settings → Bindings → Add → D1 database:
        Variable name: DB          Database: spark_auth
   5. Worker → Settings → Variables and Secrets → add two SECRETS:
        ADMIN_USERNAME  = your master admin username
        ADMIN_PASSWORD  = your master admin password
   6. Deploy. Copy the worker URL into js/auth.js as AUTH.workerUrl.
   ════════════════════════════════════════════════════════════ */

const ALLOWED_ORIGINS = [
  'https://www.aipluskids.org',
  'https://aipluskids.org',
  'http://localhost:3000',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
];

const SESSION_DAYS = 7;
const PBKDF2_ITERS = 100000;
const MODEL_STATES = ['draft', 'training', 'ready', 'archived'];
const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;

/* ─── crypto helpers (WebCrypto — no dependencies) ─────────── */

const enc = new TextEncoder();

function toHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function randomToken() {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}
async function sha256Hex(s) {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}
async function pbkdf2(password, saltHex, iters) {
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(h => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iters }, key, 256);
  return toHex(bits);
}
async function hashPassword(password) {
  const saltHex = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await pbkdf2(password, saltHex, PBKDF2_ITERS);
  return `${PBKDF2_ITERS}:${saltHex}:${hash}`;
}
async function verifyPassword(password, stored) {
  try {
    const [iters, saltHex, hash] = stored.split(':');
    const candidate = await pbkdf2(password, saltHex, parseInt(iters, 10));
    // constant-time-ish compare
    if (candidate.length !== hash.length) return false;
    let diff = 0;
    for (let i = 0; i < hash.length; i++) diff |= candidate.charCodeAt(i) ^ hash.charCodeAt(i);
    return diff === 0;
  } catch { return false; }
}

/* ─── responses / CORS ─────────────────────────────────────── */

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}
function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

/* ─── schema & seeding ─────────────────────────────────────── */

let migrated = false;
async function migrate(env) {
  if (migrated) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at INTEGER NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS spark_chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      parameters TEXT NOT NULL DEFAULT '{}',
      state TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')))`),
  ]);
  // Seed the single Master Admin from worker secrets (only if none exists)
  const admin = await env.DB.prepare("SELECT id FROM users WHERE role='admin'").first();
  if (!admin && env.ADMIN_USERNAME && env.ADMIN_PASSWORD) {
    const hash = await hashPassword(env.ADMIN_PASSWORD);
    await env.DB.prepare("INSERT OR IGNORE INTO users (username,password_hash,role) VALUES (?,?,'admin')")
      .bind(env.ADMIN_USERNAME, hash).run();
  }
  migrated = true;
}

/* ─── auth helpers ─────────────────────────────────────────── */

async function currentUser(req, env) {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const tokenHash = await sha256Hex(auth.slice(7).trim());
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.role, u.created_at FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`)
    .bind(tokenHash, Date.now()).first();
  return row || null;
}

async function createSession(env, userId) {
  const token = randomToken();
  await env.DB.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)')
    .bind(await sha256Hex(token), userId, Date.now() + SESSION_DAYS * 864e5).run();
  return token;
}

function validCredentials(username, password) {
  if (!USERNAME_RE.test(username || '')) return 'Username must be 3-30 characters (letters, numbers, underscore).';
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) return 'Password must be 8-128 characters.';
  return null;
}

const pub = u => ({ id: u.id, username: u.username, role: u.role, created_at: u.created_at });

/* ─── router ───────────────────────────────────────────────── */

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });

    try {
      await migrate(env);
      const url = new URL(req.url);
      const p = url.pathname.replace(/\/+$/, '');
      const m = req.method;
      const body = (m === 'POST' || m === 'PUT') ? await req.json().catch(() => ({})) : {};

      /* ---- auth ---- */
      if (p === '/api/auth/register' && m === 'POST') {
        const err = validCredentials(body.username, body.password);
        if (err) return json({ error: err }, 400, origin);
        const exists = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(body.username).first();
        if (exists) return json({ error: 'Username already taken.' }, 409, origin);
        const hash = await hashPassword(body.password);
        const r = await env.DB.prepare("INSERT INTO users (username,password_hash,role) VALUES (?,?,'user')")
          .bind(body.username, hash).run();
        const id = r.meta.last_row_id;
        const token = await createSession(env, id);
        const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
        return json({ user: pub(u), token }, 201, origin);
      }

      if (p === '/api/auth/login' && m === 'POST') {
        const u = body.username
          ? await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(body.username).first()
          : null;
        const ok = u && await verifyPassword(String(body.password || ''), u.password_hash);
        if (!ok) return json({ error: 'Invalid username or password.' }, 401, origin);
        const token = await createSession(env, u.id);
        return json({ user: pub(u), token }, 200, origin);
      }

      const user = await currentUser(req, env);

      if (p === '/api/auth/logout' && m === 'POST') {
        const auth = req.headers.get('Authorization') || '';
        if (auth.startsWith('Bearer ')) {
          await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
            .bind(await sha256Hex(auth.slice(7).trim())).run();
        }
        return json({ ok: true }, 200, origin);
      }

      if (p === '/api/auth/me' && m === 'GET') return json({ user: user ? pub(user) : null }, 200, origin);

      /* ---- everything below requires login ---- */
      if (!user) return json({ error: 'Not authenticated' }, 401, origin);

      /* ---- spark chats ---- */
      if (p === '/api/chats' && m === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT * FROM spark_chats WHERE user_id = ? ORDER BY updated_at DESC').bind(user.id).all();
        return json({ chats: results }, 200, origin);
      }
      if (p === '/api/chats' && m === 'POST') {
        if (!body.title || typeof body.title !== 'string' || body.title.length > 200)
          return json({ error: 'Title is required (max 200 chars).' }, 400, origin);
        const r = await env.DB.prepare('INSERT INTO spark_chats (user_id,title,content) VALUES (?,?,?)')
          .bind(user.id, body.title, String(body.content || '')).run();
        const row = await env.DB.prepare('SELECT * FROM spark_chats WHERE id = ?').bind(r.meta.last_row_id).first();
        return json({ chat: row }, 201, origin);
      }
      let mm = p.match(/^\/api\/chats\/(\d+)$/);
      if (mm && m === 'PUT') {
        const r = await env.DB.prepare(
          `UPDATE spark_chats SET title = COALESCE(?, title), content = COALESCE(?, content),
           updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
          .bind(body.title ?? null, body.content ?? null, mm[1], user.id).run();
        if (!r.meta.changes) return json({ error: 'Chat not found.' }, 404, origin);
        const row = await env.DB.prepare('SELECT * FROM spark_chats WHERE id = ?').bind(mm[1]).first();
        return json({ chat: row }, 200, origin);
      }
      if (mm && m === 'DELETE') {
        const r = await env.DB.prepare('DELETE FROM spark_chats WHERE id = ? AND user_id = ?').bind(mm[1], user.id).run();
        return r.meta.changes ? json({ ok: true }, 200, origin) : json({ error: 'Chat not found.' }, 404, origin);
      }

      /* ---- ai learning models ---- */
      if (p === '/api/models' && m === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT * FROM ai_models WHERE user_id = ? ORDER BY updated_at DESC').bind(user.id).all();
        return json({ models: results }, 200, origin);
      }
      if (p === '/api/models' && m === 'POST') {
        if (!body.name || typeof body.name !== 'string' || body.name.length > 100)
          return json({ error: 'Model name is required (max 100 chars).' }, 400, origin);
        if (body.state && !MODEL_STATES.includes(body.state))
          return json({ error: `State must be one of: ${MODEL_STATES.join(', ')}` }, 400, origin);
        let params = '{}';
        try { params = JSON.stringify(typeof body.parameters === 'string' ? JSON.parse(body.parameters) : (body.parameters ?? {})); }
        catch { return json({ error: 'Parameters must be valid JSON.' }, 400, origin); }
        const r = await env.DB.prepare('INSERT INTO ai_models (user_id,name,parameters,state) VALUES (?,?,?,?)')
          .bind(user.id, body.name, params, body.state || 'draft').run();
        const row = await env.DB.prepare('SELECT * FROM ai_models WHERE id = ?').bind(r.meta.last_row_id).first();
        return json({ model: row }, 201, origin);
      }
      mm = p.match(/^\/api\/models\/(\d+)$/);
      if (mm && m === 'PUT') {
        if (body.state && !MODEL_STATES.includes(body.state))
          return json({ error: `State must be one of: ${MODEL_STATES.join(', ')}` }, 400, origin);
        let params = null;
        if (body.parameters !== undefined) {
          try { params = JSON.stringify(typeof body.parameters === 'string' ? JSON.parse(body.parameters) : body.parameters); }
          catch { return json({ error: 'Parameters must be valid JSON.' }, 400, origin); }
        }
        const r = await env.DB.prepare(
          `UPDATE ai_models SET name = COALESCE(?, name), parameters = COALESCE(?, parameters),
           state = COALESCE(?, state), updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
          .bind(body.name ?? null, params, body.state ?? null, mm[1], user.id).run();
        if (!r.meta.changes) return json({ error: 'Model not found.' }, 404, origin);
        const row = await env.DB.prepare('SELECT * FROM ai_models WHERE id = ?').bind(mm[1]).first();
        return json({ model: row }, 200, origin);
      }
      if (mm && m === 'DELETE') {
        const r = await env.DB.prepare('DELETE FROM ai_models WHERE id = ? AND user_id = ?').bind(mm[1], user.id).run();
        return r.meta.changes ? json({ ok: true }, 200, origin) : json({ error: 'Model not found.' }, 404, origin);
      }

      /* ---- admin (Master account only) ---- */
      if (p.startsWith('/api/admin/')) {
        if (user.role !== 'admin') return json({ error: 'Admin access required' }, 403, origin);

        if (p === '/api/admin/users' && m === 'GET') {
          const { results } = await env.DB.prepare(`
            SELECT u.id, u.username, u.role, u.created_at,
              (SELECT COUNT(*) FROM spark_chats c WHERE c.user_id = u.id) AS chat_count,
              (SELECT COUNT(*) FROM ai_models a WHERE a.user_id = u.id) AS model_count
            FROM users u ORDER BY u.created_at ASC`).all();
          return json({ users: results }, 200, origin);
        }
        if (p === '/api/admin/stats' && m === 'GET') {
          const stats = await env.DB.prepare(`SELECT
            (SELECT COUNT(*) FROM users) AS total_users,
            (SELECT COUNT(*) FROM spark_chats) AS total_chats,
            (SELECT COUNT(*) FROM ai_models) AS total_models,
            (SELECT COUNT(*) FROM sessions WHERE expires_at > ${Date.now()}) AS active_sessions`).first();
          return json({ stats }, 200, origin);
        }
        mm = p.match(/^\/api\/admin\/users\/(\d+)\/chats$/);
        if (mm && m === 'GET') {
          const target = await env.DB.prepare('SELECT id, username FROM users WHERE id = ?').bind(mm[1]).first();
          if (!target) return json({ error: 'User not found.' }, 404, origin);
          const { results } = await env.DB.prepare(
            'SELECT id, title, content, created_at, updated_at FROM spark_chats WHERE user_id = ? ORDER BY updated_at DESC')
            .bind(target.id).all();
          return json({ username: target.username, chats: results }, 200, origin);
        }
        mm = p.match(/^\/api\/admin\/users\/(\d+)\/reset-password$/);
        if (mm && m === 'POST') {
          const target = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(mm[1]).first();
          if (!target) return json({ error: 'User not found.' }, 404, origin);
          let newPassword = body.newPassword || randomToken().slice(0, 12);
          if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128)
            return json({ error: 'Password must be 8-128 characters.' }, 400, origin);
          await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
            .bind(await hashPassword(newPassword), target.id).run();
          await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id).run();
          return json({ ok: true, username: target.username, temporaryPassword: newPassword }, 200, origin);
        }
      }

      return json({ error: 'Not found' }, 404, origin);
    } catch (err) {
      return json({ error: 'Server error: ' + (err && err.message) }, 500, origin);
    }
  },
};
