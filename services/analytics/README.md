# analytics

Read models and the manager dashboard. It **consumes** business events and keeps one row per milestone (`milestone_facts`);
`GET /dashboard` (role `manager` only) answers totals, a per-project table and the recent activity from that table alone —
no other service is called and no operational database is read.

| Event | Routing key | What it fills |
|---|---|---|
| `MilestoneApproved` (projects) | `project.milestone.approved` | project, milestone, amount, who approved and when |
| `InvoiceDrafted` (billing) | `billing.invoice.drafted` | invoice number, IVA, total, draft date |
| `InvoiceIssued` (billing) | `billing.invoice.issued` | issued status and date |

- **One queue, three bindings** (`q.analytics`, dead-letter queue `q.analytics.dlq`). Delivery is at least once, so each event id is recorded in `processed_events` in the same transaction.
- **Order does not matter.** RabbitMQ does not order events from different publishers, so the merge is a pure function (`src/domain/fact.ts`): every arrival order of the three events gives the same row, and an issued invoice never goes back to draft. The row is locked (`FOR UPDATE`) while it is merged.
- **Known limit:** *pending* milestones do not appear, because projects does not publish an event when a milestone is created. The dashboard shows what was approved and what was invoiced.
- Measured locally: an event is visible in the dashboard about 50 ms after it occurs (target ≤ 60 s) and the query p95 is under 2 ms with a few rows (target < 3 s). At large scale the facts query should become a SQL aggregation.

```sh
cp .env.example .env                       # passwords must match ../../.env
npm ci --ignore-scripts && npx prisma generate
npx prisma migrate deploy && npx ts-node prisma/seed.ts   # demo read model (m1 and m4)
npm test                                   # unit tests (no database)
npm run test:e2e                           # needs docker compose up -d (stop the analytics container first: it would consume the same messages)
```

## mTLS
With `TLS_ENABLED=true` the service serves HTTPS and requires a client certificate from the internal CA whose name is in `TLS_ALLOWED_CLIENTS` (needs `TLS_CERT_PATH`, `TLS_KEY_PATH`, `TLS_CA_PATH`; it refuses to start without them). `DOCS_HTTP_PORT` (demo only) adds a plain-HTTP port for Swagger. Tests: `test/mtls.e2e.ts`.
