# AI + Kids Website — Deployment Package

## Files Included
- `index.html` — About page (homepage)
- `programs.html` — Programs page
- `impact.html` — Impact page
- `contact.html` — Contact / Get Involved page
- `styles.css` — All styles (shared across all pages)
- `nav.js` — Mobile navigation + scroll animations

## Deployment Options

### Option 1 – GitHub Pages (Free, Recommended)
1. Create a free account at [github.com](https://github.com)
2. Create a new repository named `aipluskids` (or any name)
3. Upload all files to the repository
4. Go to Settings → Pages → set Source to "main branch / root"
5. Your site will be live at `https://yourusername.github.io/aipluskids`

### Option 2 – Netlify (Free, Drag & Drop)
1. Go to [netlify.com](https://netlify.com) and sign up free
2. Drag the entire folder onto the Netlify dashboard
3. Site is live instantly with a free `.netlify.app` domain

### Option 3 – Vercel (Free)
1. Go to [vercel.com](https://vercel.com) and sign up free
2. Import the folder or connect your GitHub repo
3. Site deploys automatically

## Custom Domain
Once you have a domain (e.g., `aipluskids.org`), update the DNS records to point to wherever you host. All hosting services above support custom domains for free.

## Customization Notes
- All colors are controlled via CSS variables at the top of `styles.css`
- Fonts loaded from Google Fonts (Fraunces + DM Sans) — free
- The contact form currently shows a success message on submit. To actually receive emails, connect to a form service like [Formspree](https://formspree.io) or [Netlify Forms](https://docs.netlify.com/forms/setup/)

## Formspree Setup (to receive form submissions)
1. Go to [formspree.io](https://formspree.io) and create a free account
2. Create a new form and get your form ID
3. In `contact.html`, update the `<form>` tag:
   ```html
   <form class="contact-form" action="https://formspree.io/f/YOUR_FORM_ID" method="POST">
   ```
4. Remove the JavaScript submit handler at the bottom of `contact.html`
