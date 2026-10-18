# web

React 19 + TypeScript + Vite. Login, Projects (approve a milestone, watch the draft invoice appear) and Invoices (issue; 403 for sales).
Styling: CSS Modules over design tokens in `src/styles/tokens.css` (light and dark). Shared pieces live in `src/styles/ui.module.css`.

- **Security:** the JWT is kept in memory (and `sessionStorage` only to survive a reload; never `localStorage`). It is decoded only to *show* the
  role and expiry; the server verifies it and checks the role on every request. No `dangerouslySetInnerHTML`/`innerHTML` anywhere.
  The gateway sends a `Content-Security-Policy-Report-Only` header; switch it to enforcing in a separate PR after reviewing the reports.
- **Forms:** `noValidate`, own messages shown on screen, same limits as the server (email up to 254, password 1 to 128); nothing is truncated silently.

```sh
npm install --ignore-scripts
npm run dev          # http://localhost:5173, API calls proxied to the gateway on :8080 (docker compose up -d)
npm test             # unit tests (Vitest)
npx playwright install chromium webkit   # once
npm run test:e2e     # needs the stack up and seeded; see below
```

`npm run test:e2e` runs two kinds of Playwright projects:
- `functional-*` (Chromium, WebKit): they **write** demo data (approve, issue). `scripts/reset-demo.sh` restores it.
- `audit-*` (Chromium and WebKit desktop, iPhone SE, iPhone 13, Pixel 5, 320 px): they **never write** (every write request is blocked and the
  database is compared before and after). They measure page overflow, off-screen elements, tap targets (32 px) and font size (11 px) and save screenshots in `test-results/shots`.

The gateway limits logins (10 per minute); the setup logs in once per role and reuses the sessions while they are still valid.
