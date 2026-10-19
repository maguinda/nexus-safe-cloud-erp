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

## Run the whole stack (containers + gateway)

```sh
sh infra/keys/gen-keys.sh                 # once: JWT key pair (git-ignored)
sh infra/certs/gen-certs.sh               # once: internal CA + mTLS certificates (git-ignored)
cp .env.example .env                      # then change the passwords
docker compose up -d --build              # postgres, rabbitmq, 3 services, nginx gateway
./scripts/reset-demo.sh                   # demo data back to its initial state
node scripts/e2e-flow.mjs                 # whole flow through the gateway
```

### mTLS between the gateway and the services
The services are **not** reachable over plain HTTP. Each one serves HTTPS and requires a client certificate signed by the internal CA (`infra/certs/gen-certs.sh`) **and** whose name is in its allow-list (`TLS_ALLOWED_CLIENTS`: the gateway, plus the service itself for its healthcheck). A compromised service cannot call another one, even from inside the network. The JWT is still verified on every route: mTLS proves *which service* is calling, the JWT proves *which user*.

`docker-compose.docs.yml` (demo only) opens a second plain-HTTP port per service on `127.0.0.1` so Swagger opens in a browser; the JWT stays mandatory there. Without that file the door does not exist. After recreating a service container, run `docker compose restart gateway` (nginx caches the upstream addresses).

The only published port is the gateway, `127.0.0.1:8080`. Services have no published ports; the gateway exposes just
`POST /auth/login`, `/projects`, `/milestones`, `/invoices`, `/health`. It does not authenticate: every service verifies the JWT again.
For the demo, Swagger of each service: `docker compose -f docker-compose.yml -f docker-compose.docs.yml up -d`
then http://localhost:4101/docs, :4102/docs, :4103/docs.

The web app is served by the same gateway: open http://localhost:8080. Tests: `cd web && npm run test:e2e` (see `web/README.md`).

Demo logins (password in `.env`, `DEMO_PASSWORD`): `laura.rios@nexus.example` (project lead),
`andres.mora@nexus.example` (billing analyst), `camila.soto@nexus.example` (sales).

## Run the infrastructure locally

```sh
cp .env.example .env      # then change the passwords
docker compose up -d      # PostgreSQL 16 and RabbitMQ 3.13
docker compose ps         # both should be "healthy"
```

Ports are published on `127.0.0.1` only. RabbitMQ management UI: http://localhost:15672.
Never commit `.env` or any `*.pem` / `*.key` file.
