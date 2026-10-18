# Nexus Safe-Cloud ERP (MVP)

MVP for the Software Architecture course (Equipo 2, Velocity Softworks). Three services behind one gateway,
a React frontend, PostgreSQL (one database per service) and RabbitMQ.

| Folder | What it is |
|---|---|
| `services/identity-access` | Login and JWT issuing |
| `services/projects` | Projects, milestones, approval (writes the event to an outbox) |
| `services/billing-receivables` | Consumes `MilestoneApproved` and creates draft invoices |
| `web` | React + TypeScript frontend |
| `infra` | Infrastructure files (Postgres init script, later Terraform/Helm) |
| `docs` | `openapi.yaml` (API contract) and `events.md` (event contract) |

## Run the infrastructure locally

```sh
cp .env.example .env      # then change the passwords
docker compose up -d      # PostgreSQL 16 and RabbitMQ 3.13
docker compose ps         # both should be "healthy"
```

Ports are published on `127.0.0.1` only. RabbitMQ management UI: http://localhost:15672.
Never commit `.env` or any `*.pem` / `*.key` file.
