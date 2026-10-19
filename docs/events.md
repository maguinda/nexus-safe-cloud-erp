# Events (RabbitMQ)

Business events travel through one topic exchange, `erp.events`. Each service has its own queue and its own
binding keys. The producer writes the event to an `outbox` table in the same transaction as the business
change; a relay publishes it afterwards, so a crash never loses an event. Consumers are idempotent
(they remember the processed `eventId`) and failed messages go to a dead-letter queue.

## MilestoneApproved

- Published by: `projects`
- Routing key: `project.milestone.approved`
- Consumed by: `billing-receivables` (queue `q.billing`), which creates a draft invoice, and `analytics` (queue `q.analytics`)

```json
{
  "eventId": "6f1c2d9e-3b5a-4c71-9d2f-0a1b2c3d4e5f",
  "type": "MilestoneApproved",
  "occurredAt": "2026-10-18T05:30:00.000Z",
  "correlationId": "f2a7b9c4-1e3d-4a8b-b6c5-7d9e0f1a2b3c",
  "data": {
    "milestoneId": "m2",
    "milestoneName": "Link redundancy design",
    "projectId": "p1",
    "projectName": "Branch network upgrade",
    "amountCop": 18500000,
    "approvedBy": "laura.rios@nexus.example"
  }
}
```

Rules:
- The consumer creates **at most one** invoice per `milestoneId`; a repeated event changes nothing.
- A change to this shape must stay backward compatible (add fields, never remove or rename them).

## InvoiceDrafted

- Published by: `billing-receivables` (through its own outbox, in the same transaction that creates the draft invoice)
- Routing key: `billing.invoice.drafted`
- Consumed by: `analytics` (queue `q.analytics`)
- `correlationId` is the one of the `MilestoneApproved` event that originated the invoice, so one trace crosses projects, billing and analytics.

```json
{
  "eventId": "0b8f2c1e-5d4a-4e7b-9a63-1c2d3e4f5a6b",
  "type": "InvoiceDrafted",
  "occurredAt": "2026-10-18T05:30:00.250Z",
  "correlationId": "f2a7b9c4-1e3d-4a8b-b6c5-7d9e0f1a2b3c",
  "data": {
    "invoiceNumber": "INV-0103",
    "milestoneId": "m2",
    "projectName": "Branch network upgrade",
    "milestoneName": "Link redundancy design",
    "amountCop": 18500000,
    "taxCop": 3515000,
    "totalCop": 22015000,
    "approvedBy": "laura.rios@nexus.example"
  }
}
```

## InvoiceIssued

- Published by: `billing-receivables` (outbox, same transaction that turns the draft into an issued invoice)
- Routing key: `billing.invoice.issued`
- Consumed by: `analytics` (queue `q.analytics`)
- `correlationId` is the one of the HTTP request that issued the invoice.
- Same `data` as `InvoiceDrafted` but with `issuedBy` (email of the billing analyst, taken from the token) instead of `approvedBy`, plus `dueDate` (ISO date-time: issue date + 30 calendar days in UTC, from `domain/due-date.ts`). Adding a field is backward compatible: consumers that ignore it keep working.

## Delivery rules (all events)

- Delivery is **at least once**: a consumer can receive the same event twice and must ignore the repeat (it remembers the `eventId`).
- An invoice number produces at most one `InvoiceDrafted` and one `InvoiceIssued` (unique `(aggregate_id, type)` in the outbox).
- A refused action (403, 409) publishes nothing.
- Messages that were already waiting in the queue when a consumer starts are processed like any other (regression test `consumer-backlog.e2e.ts`).

## Analytics consumer

`analytics` has one queue, `q.analytics`, bound to the three routing keys above, with its own dead-letter queue `q.analytics.dlq`.
RabbitMQ does not order events from different publishers, so the read model is built to give the **same result in any arrival order**
(an issued invoice never goes back to draft) and to ignore repeated deliveries (it records every `eventId`).
