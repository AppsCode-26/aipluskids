# Deploying the Spark Auth worker (accounts for the AI Playground)

The login window on the AI Playground talks to a Cloudflare Worker (`worker/auth-worker.js`) with a D1 (SQLite) database. Until it's deployed, the playground *fails open* — it works, but nothing is saved to accounts.

## Steps (Cloudflare dashboard, ~5 minutes)

1. **Create the database**: dash.cloudflare.com → Storage & Databases → D1 → Create → name it `spark_auth`.
2. **Create the worker**: Workers & Pages → Create → Worker → name it `spark-auth` → Deploy → "Edit code" → paste the entire contents of `worker/auth-worker.js` → Deploy.
3. **Bind the database**: worker → Settings → Bindings → Add → D1 database → Variable name `DB`, database `spark_auth`.
4. **Set the Master Admin secrets**: worker → Settings → Variables and Secrets → add two of type *Secret*:
   - `ADMIN_USERNAME` — the master admin username
   - `ADMIN_PASSWORD` — the master admin password
5. **Deploy again**, then copy the worker URL (e.g. `https://spark-auth.<your-subdomain>.workers.dev`).
6. **Point the site at it**: in `js/auth.js`, set `AUTH.workerUrl` to that URL, commit, push.

The Master Admin account is created automatically on the worker's first request (only if no admin exists yet). Admins get an **Admin** link on the playground chip → `admin.html` (user list, system stats, password resets — all enforced server-side).

## Notes

- Sessions last 7 days; tokens are stored hashed (SHA-256) in D1, passwords are PBKDF2-SHA256 (100k iterations).
- Users can only ever read/write their own Spark Chats and AI Learning Models — every query is scoped by `user_id` server-side.
- CORS is locked to aipluskids.org (plus localhost for testing) — edit `ALLOWED_ORIGINS` in the worker to change.
