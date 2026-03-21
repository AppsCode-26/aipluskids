# AI Plus Kids — Deployment Guide

## Architecture Overview

```
GitHub Pages (frontend)          Vercel (backend)
┌─────────────────────┐         ┌──────────────────────┐
│  index.html         │  fetch  │  /api/chat.js        │
│  about.html         │ ──────► │  (serverless fn)     │
│  workshops.html     │         │  calls Gemini API    │
│  contact.html       │         │  with secret key     │
│  chat.html          │         └──────────────────────┘
│  css/  js/          │                  ▲
└─────────────────────┘                  │
                                  GEMINI_API_KEY
                                  (env variable,
                                   never in code)
```

---

## Step 1 — Set Up the GitHub Repository

1. Go to [github.com](https://github.com) and sign in (or create an account).
2. Click **New repository**.
3. Name it `aipluskids` (or any name you like).
4. Set it to **Public** (required for free GitHub Pages).
5. Click **Create repository**.
6. In your terminal, from this project folder:

```bash
git init
git add .
git commit -m "Initial commit — AI Plus Kids website"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/aipluskids.git
git push -u origin main
```

---

## Step 2 — Enable GitHub Pages

1. In your GitHub repo, go to **Settings → Pages**.
2. Under **Source**, select **Deploy from a branch**.
3. Choose branch: `main`, folder: `/ (root)`.
4. Click **Save**.
5. After ~60 seconds, your site will be live at:
   `https://YOUR_USERNAME.github.io/aipluskids`

---

## Step 3 — Connect Your Custom Domain (www.aipluskids.org)

### A. Add the domain in GitHub Pages settings

1. In **Settings → Pages → Custom domain**, enter:
   ```
   www.aipluskids.org
   ```
2. Click **Save**. GitHub will verify DNS.
3. Check **Enforce HTTPS** once it becomes available (~10 min after DNS propagates).

### B. Configure DNS at your domain registrar

Log in to wherever you registered `aipluskids.org` and add these records:

| Type  | Name | Value                    |
|-------|------|--------------------------|
| A     | @    | 185.199.108.153          |
| A     | @    | 185.199.109.153          |
| A     | @    | 185.199.110.153          |
| A     | @    | 185.199.111.153          |
| CNAME | www  | YOUR_USERNAME.github.io  |

DNS changes can take up to 48 hours to propagate worldwide.

---

## Step 4 — Deploy the Serverless Backend on Vercel

### A. Install Vercel CLI

```bash
npm install -g vercel
```

### B. Deploy

From the project root:

```bash
vercel
```

Follow the prompts:
- **Set up and deploy?** → Yes
- **Which scope?** → your account
- **Link to existing project?** → No
- **Project name?** → aipluskids (or any name)
- **In which directory?** → `.` (current)
- **Override settings?** → No

### C. Set the Gemini API Key (secret — never in code)

```bash
vercel env add GEMINI_API_KEY production
```

Paste your Gemini API key when prompted. This stores it securely in Vercel's environment — it is **never** exposed to the browser.

### D. Deploy to production

```bash
vercel --prod
```

Vercel will give you a URL like:
`https://aipluskids.vercel.app`

---

## Step 5 — Point the Frontend to Your Backend

Open `js/chat.js` and update the `API_ENDPOINT` constant:

```js
// Before (relative path — works when frontend and backend share the same domain):
const API_ENDPOINT = '/api/chat';

// After (if GitHub Pages and Vercel are on different domains):
const API_ENDPOINT = 'https://aipluskids.vercel.app/api/chat';
```

Commit and push the change:

```bash
git add js/chat.js
git commit -m "Point chat to production Vercel backend"
git push
```

> **Tip:** If you later add `www.aipluskids.org` as a custom domain on Vercel too,
> you can keep the relative `/api/chat` path and serve everything from one domain.

---

## Step 6 — (Optional) Add a Custom Domain to Vercel

1. In the [Vercel Dashboard](https://vercel.com), open your project.
2. Go to **Settings → Domains**.
3. Add `api.aipluskids.org` (or `www.aipluskids.org`).
4. Add the CNAME record at your registrar pointing to `cname.vercel-dns.com`.
5. Update `API_ENDPOINT` in `js/chat.js` accordingly.

---

## Step 7 — Connect the Contact Form (Optional)

The contact form currently simulates a send. To receive real emails, use one of:

### Option A — Formspree (easiest, free tier available)
1. Sign up at [formspree.io](https://formspree.io).
2. Create a form and get your form ID (e.g. `xabcdefg`).
3. In `contact.html`, replace the fake `setTimeout` block with:

```js
const formData = new FormData(document.getElementById('contactForm'));
const response = await fetch('https://formspree.io/f/xabcdefg', {
  method: 'POST',
  body: formData,
  headers: { Accept: 'application/json' },
});
```

### Option B — EmailJS (sends from your own email)
Visit [emailjs.com](https://www.emailjs.com) for their free SDK.

---

## Security Checklist

- [x] Gemini API key stored **only** in Vercel environment variables
- [x] Key is **never** in frontend HTML, CSS, or JS files
- [x] Key is **never** committed to GitHub (`.gitignore` covers `.env`)
- [x] Gemini safety settings set to `BLOCK_LOW_AND_ABOVE` for all harm categories
- [x] System prompt enforces kid-safe responses
- [x] CORS on `/api/chat` restricted to `www.aipluskids.org`
- [x] User messages are sanitized and capped at 4,000 characters

---

## Local Development

```bash
# Install Vercel CLI
npm install -g vercel

# Create a local .env file (never commit this)
echo "GEMINI_API_KEY=your_key_here" > .env

# Run everything locally (serves static files + serverless functions)
vercel dev
```

Open `http://localhost:3000` in your browser.
