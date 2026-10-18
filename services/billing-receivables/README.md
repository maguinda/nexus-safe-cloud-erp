# billing-receivables

Invoices. It **consumes `MilestoneApproved`** from RabbitMQ (queue `q.billing`, bound to exchange `erp.events` with routing key
`project.milestone.approved`) and creates a **draft invoice**. A billing analyst then issues it (`PATCH /invoices/:number/issue`).

Safety rules for the consumer (messages come from outside, so nothing is trusted):
- **Idempotent.** The `eventId` is stored in `processed_events` in the same transaction as the invoice, so a repeated delivery is ignored.
  `invoices.milestone_id` is unique, so a milestone can never get two invoices even under different event ids.
- **Strict validation** of every field (UUID, safe ids, positive integer amount, email). A message that breaks the contract goes
  to the dead-letter queue `q.billing.dlq` and does not block the rest. A transient failure is retried once and then dead-lettered.
- **Ack only after the invoice is saved.**
- Invoice numbers come from a PostgreSQL sequence (`invoice_number_seq`), unique even with several replicas.

```sh
cp .env.example .env                        # passwords must match ../../.env
export $(grep -v '^#' .env | xargs)
npx prisma migrate deploy && npx ts-node prisma/seed.ts
npm run build && npm start                  # http://localhost:4103  (Swagger at /docs, needs a JWT)
npm test                                    # unit tests
npm run test:e2e                            # needs docker compose up -d and the keys (infra/keys/gen-keys.sh)
```

Roles: `GET /invoices` -> `project_lead`, `billing_analyst` (sales gets 403); `PATCH .../issue` -> `billing_analyst` only.
