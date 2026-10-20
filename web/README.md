# web

React 19 + TypeScript + Vite. Login, Projects (create and approve milestones, watch the draft invoice appear), Invoices (search, filter by status, sort, due-date chips, issue; cards on phones; 403 for sales), and for the manager the Dashboard (Analytics) and Users (create users, change roles).
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
npm run format:css   # Prettier for the stylesheets (format:css:check only verifies); config in .prettierrc.json
```

`npm run test:e2e` runs two kinds of Playwright projects:
- `functional-*` (Chromium, WebKit): they **write** demo data (approve, issue). `scripts/reset-demo.sh` restores it.
- `audit-*` (Chromium and WebKit desktop, iPhone SE, iPhone 13, Pixel 5, 320 px): they **never write** (every write request is blocked and the
  database is compared before and after). They measure page overflow, off-screen elements, tap targets (32 px), buttons closer than 8 px to a field and font size (11 px) and save screenshots in `test-results/shots`.

The gateway limits logins (10 per minute); the setup logs in once per role and reuses the sessions while they are still valid.
