# projects

Projects and milestones. `POST /milestones/:id/approve` (role `project_lead`) approves a milestone and, **in the same
database transaction**, writes a `MilestoneApproved` event to the `outbox_events` table. A relay publishes the
event to RabbitMQ (`erp.events`, routing key `project.milestone.approved`) afterwards.

Why an outbox: if RabbitMQ is down the approval still succeeds (200) and the event waits in the table until
RabbitMQ is back; if the process dies the event is not lost. Delivery is at-least-once, so consumers must be idempotent.

Why `SELECT ... FOR UPDATE`: two simultaneous approvals of the same milestone cannot both win; the second waits,
sees it approved and gets 409. A unique `(aggregate_id, type)` constraint on the outbox is the second safety net.

```sh
cp .env.example .env                        # passwords must match ../../.env
export $(grep -v '^#' .env | xargs)
npx prisma migrate deploy && npx ts-node prisma/seed.ts
npm run build && npm start                  # http://localhost:4102  (Swagger at /docs, needs a JWT)
npm test                                    # unit tests
npm run test:e2e                            # needs docker compose up -d and the keys (infra/keys/gen-keys.sh)
```

All routes need `Authorization: Bearer <JWT>` (RS256, verified with `infra/keys/jwt-public.pem`) except `/health`.
