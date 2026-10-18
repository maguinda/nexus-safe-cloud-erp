# Events (RabbitMQ)

Business events travel through one topic exchange, `erp.events`. Each service has its own queue and its own
binding keys. The producer writes the event to an `outbox` table in the same transaction as the business
change; a relay publishes it afterwards, so a crash never loses an event. Consumers are idempotent
(they remember the processed `eventId`) and failed messages go to a dead-letter queue.

## MilestoneApproved

- Published by: `projects`
- Routing key: `project.milestone.approved`
- Consumed by: `billing-receivables` (queue `q.billing`), which creates a draft invoice

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
