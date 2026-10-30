# Events (RabbitMQ)

Business events travel through one topic exchange, `erp.events`. Each service has its own queue and its own
binding keys. The producer writes the event to an `outbox` table in the same transaction as the business
change; a relay publishes it afterwards, so a crash never loses an event. Consumers are idempotent
(they remember the processed `eventId`) and failed messages go to a dead-letter queue.

## OverdueDetected

- Published by: `billing-receivables` (a periodic check every `OVERDUE_CHECK_MS`, 60 s by default; `OVERDUE_ENABLED=false` turns it off), in the same transaction that writes the outbox row
- Routing key: `billing.invoice.overdue`
- Consumed by: `analytics` (queue `q.analytics`), which counts it as an overdue invoice on the dashboard
- **Once per invoice, ever:** the database has a unique outbox row per (invoice, event type) and the check skips invoices that already have one. It is sent the first time the invoice is found overdue, with the days it had then (it is not repeated each day).
- **Overdue** = an ISSUED invoice whose due day (UTC calendar day) is **before** today's UTC day: on the due day itself it is not overdue yet. There are no payments in this MVP, so every issued invoice counts as receivable.

```json
{
  "eventId": "7d2c1a90-4b8e-4f31-a1c5-9e0f2b3c4d5e",
  "type": "OverdueDetected",
  "occurredAt": "2026-11-20T00:00:00.000Z",
  "correlationId": "overdue-20261120-1a2b3c4d",
  "data": {
    "invoiceNumber": "INV-0103", "milestoneId": "m2", "projectName": "Branch network upgrade", "milestoneName": "Link redundancy design",
    "clientName": "Banco Andino (example)", "amountCop": 18500000, "taxCop": 3515000, "totalCop": 22015000,
    "dueDate": "2026-11-17T15:00:00.000Z", "daysOverdue": 3
  }
}
```

- No personal data: only amounts and business names. All the events of one pass share the correlation id.

## MilestoneCreated

- Published by: `projects`, in the same transaction that creates the milestone (transactional outbox)
- Routing key: `project.milestone.created`
- Consumed by: `analytics` (queue `q.analytics`), which counts it as a **pending** milestone until a `MilestoneApproved` for the same `milestoneId` arrives

```json
{
  "eventId": "0b8f2c1e-5d4a-4e7b-9a63-1c2d3e4f5a01",
  "type": "MilestoneCreated",
  "occurredAt": "2026-10-28T12:00:00.000Z",
  "correlationId": "trace-created-0001",
  "data": { "milestoneId": "m-1a2b3c4d", "milestoneName": "Site survey", "projectId": "p1", "projectName": "Branch network upgrade", "amountCop": 12000000 }
}
```

- The read model does not depend on arrival order: if the approval arrives first, the milestone is not pending (a late creation only records when it was born).
- Milestones that existed before this event (the demo seed) are loaded into the read model by the analytics seed; the ones created through the API are known from this event on.

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
    "clientName": "Banco Andino (example)",
    "amountCop": 18500000,
    "approvedBy": "laura.rios@nexus.example"
  }
}
```

- `clientName` (new, optional): the client of the project. Billing uses it to find the fiscal data of the client for the SANDBOX electronic invoice. The fiscal data itself (NIT, email, address) **never travels on the bus**. Old events without it are valid (`null`); billing cleans it (control characters out, spaces collapsed, up to 120 characters) instead of refusing the event.

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

## StockChanged and EquipmentPurchased

- Published by: `procurement`, in the **same transaction** that moves the stock (transactional outbox, relay to `erp.events`).
- `StockChanged` → routing key `procurement.stock.changed`: after receiving a purchase order or adjusting the stock by hand. `data`: `itemId`, `itemName`, `delta` (negative when stock goes down), `onHand` (the stock AFTER the change), `reason` (`purchase_received` or `adjustment`), `note` (the order number or the reason typed).
- `EquipmentPurchased` → routing key `procurement.equipment.purchased`: only when an order for an item of kind `equipment` is received (once per order). `data`: `orderNumber` (`PO-0001`), `orderId`, `supplierName`, `itemName`, `quantity`, `unitPriceCop`, `totalCop`. It is there for Operations to add the new equipment to the fleet (not consumed yet).
- A purchase order is **pending until it is received**: creating it publishes nothing and does not move the stock. Receiving the same order twice, or at the same time, raises the stock once (the second answer is 409).
- No personal data: business names, quantities and amounts.

`procurement` also **consumes** `ThresholdBreached` (queue `q.procurement`, dead-letter queue `q.procurement.dlq`) to suggest the spare parts that serve the measure of a device in alert. It keeps the latest 200 alerts; invalid messages go to the dead-letter queue.

## ThresholdBreached

- Published by: `operations`, in the **same transaction** that stores the readings of an ingestion batch (transactional outbox, relay to `erp.events`)
- Routing key: `ops.threshold.breached`. Consumed by: `notifications` (the manager sees it in the bell).
- **When:** a device gets WORSE, measured against the state saved on the device: `normal → warning`, `normal → alert` or `warning → alert`. **Once per device and batch, never per reading**: 50 alert readings in one batch warn once, with the worst reading (the latest of the worst severity). Getting better (`alert → normal`) lowers the saved state **without** warning, so the next time it worsens it warns again.
- **Order and repeats:** only readings NEWER than the last one already counted take part (a late batch is stored but changes nothing); repeated readings do not count. The state is read inside a row lock (`FOR UPDATE`, devices locked in id order, BEFORE inserting), so two batches at the same time cannot warn twice. One event per reading at most (the outbox has a unique key on `deviceId:recordedAt` + type).
- **Initial state:** it comes from the last reading of each device when the service is migrated or seeded, so deploying it does not make every device that was already in alert warn at once.

```json
{
  "eventId": "3c5e8a10-1d2b-4c3d-8e9f-0a1b2c3d4e5f",
  "type": "ThresholdBreached",
  "occurredAt": "2026-11-05T14:00:00.000Z",
  "correlationId": "req-1a2b3c4d",
  "data": { "deviceId": "TEMP_MON_OF1", "deviceName": "TEMP_MON_OF1", "location": "Medellín", "readingKind": "TEMP", "status": "ALERT", "value": 31.5, "unit": "°C", "recordedAt": "2026-11-05T13:59:00.000Z" }
}
```

No personal data. Notifications requires `deviceName` ≤ 120, `location` ≤ 120, `readingKind` ≤ 60, `status` ≤ 40, a finite `value` and `unit` ≤ 20 characters; extra fields (`deviceId`, `recordedAt`) are ignored.

## EngineerAllocated and OverAllocationDetected

- Published by: `technical-capacity`, in the **same transaction** that saves the allocation (transactional outbox, relay to `erp.events`)
- `EngineerAllocated` → routing key `capacity.engineer.allocated` (consumed by `projects` for the project team and by `analytics` for the profitability)
- `OverAllocationDetected` → routing key `capacity.overallocation.detected`, consumed by `notifications` (manager and sales see it in the bell). It is published ONLY when the manager accepts, on purpose, an allocation that takes an engineer over 100% on some day (`allowOverallocation`); without that, the API answers 409 and nothing is saved or published.
- One event of each type per allocation (the outbox has a unique key on allocation + type). No personal data: the engineer's name is a business name, never an email.

```json
{
  "eventId": "9d1f2a30-6b7c-4d8e-9f01-a2b3c4d5e6f7",
  "type": "OverAllocationDetected",
  "occurredAt": "2026-11-05T14:00:00.000Z",
  "correlationId": "req-1a2b3c4d",
  "data": { "allocationId": "…uuid…", "engineerName": "Ana Torres", "allocationPercent": 130, "periodStart": "2026-11-05", "periodEnd": "2026-11-12" }
}
```

`allocationPercent` is the **highest load** the engineer reaches (an integer over 100) and the period is the one of the new allocation. `EngineerAllocated` data: `allocationId`, `engineerName`, `projectName`, `percent`, `periodStart`, `periodEnd`, `dailyCostCop`. `dailyCostCop` is the daily cost the manager had written for the engineer **when the allocation was made** (whole pesos, or `null` if there was none); it is a snapshot, so changing the cost later does not rewrite old allocations. Only `analytics` uses it; `projects` ignores it. It is the one field of salary nature: the REST API shows it only to the manager.

### AllocationRemoved

- Published by `technical-capacity` in the same transaction that deletes an allocation. Routing key `capacity.allocation.removed`; data `{ allocationId, projectName }`. Deleting something that does not exist publishes nothing.
- Consumed by `projects` (the engineer leaves the project team) and `analytics` (the cost leaves the profitability). Both take a database lock per allocation id and keep a mark of the removed id, so **the order of arrival does not matter**: a removal that arrives before its allocation is remembered and the allocation never shows up.

## Analytics consumer: audit log

- `analytics` has a second queue, `q.analytics.audit` (dead-letter queue `q.analytics.audit.dlq`), bound to **`#`**: it sees every event on the exchange, including types that do not exist yet. It stores one row per event in `audit_entries`: event id, type, `occurredAt`, a short summary built only from known fields of each type, and the **actor** when the event says it (`approvedBy`, `issuedBy` or `registeredBy`; the last one was added to `PaymentReceived`).
- Events that carry no actor (allocations, stock, thresholds) have `actor = null` and the screen says "the event does not say": it does **not** guess. Adding an actor to those events is a possible later change.
- The key is the event id (a repeated event is one row and is acknowledged as a duplicate). The table is **append-only** (a trigger refuses UPDATE, DELETE and TRUNCATE; tests and the demo reset use the session flag `erp.allow_audit_delete`). `GET /audit?type=&limit=` (manager only).

## Analytics consumer: profitability

- `GET /profitability` (manager only) = for each project, issued invoices **without VAT** minus the labor cost. Labor cost = `percent / 100 × working days (Monday to Friday) already elapsed × dailyCostCop`, for each allocation, counting only the days up to today.
- Allocations without a daily cost add 0 and are counted in `uncostedAllocations`, so the screen warns that the margin looks better than it is. The link with the project is by value (project name).

## PaymentReceived

- Published by: `billing-receivables`, in the **same transaction** that stores the payment (transactional outbox, relay to `erp.events`). Routing key: `billing.payment.received`. Consumed by: `analytics` (the dashboard shows what was collected and stops counting a fully paid invoice as overdue).
- `registeredBy` (the email of the billing analyst, taken from the verified token) is only used by the audit log.
- One event per payment (the outbox aggregate is the payment id, because an invoice can have several payments). Payments are append-only: the database refuses UPDATE, DELETE and TRUNCATE.
- Only an **issued** invoice receives payments, and the sum can never pass the invoice total: the invoice row is locked and the paid total is read inside the lock, so two payments at the same time cannot add up above it (409 naming the balance).
- `paidCop` is the total paid AFTER this payment (it only goes up), so a consumer can merge with a maximum and gets the same result in any order or when the event is repeated. `paidInFull` is true when `balanceCop` is 0.
- A fully paid invoice does not become overdue; one paid in part still does. If an `OverdueDetected` was already sent, it is not taken back: the consumer decides (analytics ignores overdue for invoices paid in full).

```json
{
  "eventId": "6a1f0c52-2d3b-4c9e-8f10-1a2b3c4d5e6f",
  "type": "PaymentReceived",
  "occurredAt": "2026-11-25T14:00:00.000Z",
  "correlationId": "req-1a2b3c4d",
  "data": { "invoiceNumber": "INV-0103", "milestoneId": "m2", "projectName": "Branch network upgrade", "milestoneName": "Link redundancy design", "clientName": "Banco Andino (example)",
            "totalCop": 22015000, "paymentId": "…uuid…", "paymentCop": 10000000, "paidCop": 10000000, "balanceCop": 12015000, "paidInFull": false, "method": "transfer", "paidAt": "2026-11-25T14:00:00.000Z" }
}
```

The only person in the event is `registeredBy` (the staff email of the analyst, as `approvedBy` and `issuedBy` in the invoice events); amounts and business names otherwise. The reference typed by the analyst stays in billing's database.

## Projects consumer (project team)

- `projects` binds its own queue `q.projects.team` (dead-letter queue `q.projects.team.dlq`) to `capacity.engineer.allocated` and stores one row per allocation in `project_team` (engineer name, project name, percent, period). Nothing else of the event is kept (no costs, no personal data).
- Idempotent by the allocation id (`INSERT ... ON CONFLICT DO NOTHING`): a repeated event is acknowledged as a duplicate and never reaches the dead-letter queue. An invalid event (percent outside 1..100, markup in a name, impossible dates, not JSON) goes to the dead-letter queue and blocks nothing.
- The project is linked by value: `GET /projects/:projectId/team` returns the rows whose project name equals the project's name (roles project_lead, billing_analyst, manager).

## Notifications consumer

`notifications` has its own queue `q.notifications` (dead-letter queue `q.notifications.dlq`) bound to three routing keys. It saves ONE notification per event (idempotent by `eventId`, in one transaction with the processed-event mark) and keeps only what the screen shows: the kind, the severity, who sees it and the few values needed to write the text. **No personal data is stored** (no emails, no client names).

| Event | Routing key | Published by | Who sees it | Severity |
|---|---|---|---|---|
| `OverdueDetected` | `billing.invoice.overdue` | billing-receivables (built) | billing_analyst, manager | warning |
| `ThresholdBreached` | `ops.threshold.breached` | operations | manager | `ALERT` → critical, otherwise warning |
| `OverAllocationDetected` | `capacity.overallocation.detected` | technical-capacity | manager, sales | warning |

`ThresholdBreached` data: `deviceName`, `location`, `readingKind`, `status` (`ALERT`/`WARNING`), `value` (number), `unit`. `OverAllocationDetected` data: `engineerName`, `allocationPercent` (an integer over 100), `periodStart`, `periodEnd` (`YYYY-MM-DD`). Invalid messages (bad types, limits, size over 16 KB) go to the dead-letter queue and change nothing.

## Analytics consumer

`analytics` has one queue, `q.analytics`, bound to the three routing keys above, with its own dead-letter queue `q.analytics.dlq`.
RabbitMQ does not order events from different publishers, so the read model is built to give the **same result in any arrival order**
(an issued invoice never goes back to draft) and to ignore repeated deliveries (it records every `eventId`).
