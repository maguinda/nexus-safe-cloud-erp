# Nexus Safe-Cloud ERP (MVP)

MVP for the Software Architecture course (Equipo 2, Velocity Softworks). Three services behind one gateway,
a React frontend, PostgreSQL (one database per service) and RabbitMQ.

| Folder | What it is |
|---|---|
| `services/identity-access` | Login and JWT issuing |
| `services/projects` | Projects, milestones, approval (writes the event to an outbox) |
| `services/billing-receivables` | Consumes `MilestoneApproved` and creates draft invoices; publishes `InvoiceDrafted` and `InvoiceIssued` |
| `services/analytics` | Read models built from the events and the manager dashboard (`GET /dashboard`) |
| `web` | React + TypeScript frontend |
| `infra` | Infrastructure files (Postgres init script, later Terraform/Helm) |
| `docs` | `openapi.yaml` (API contract) and `events.md` (event contract) |

## Where things live

```
erp/
├─ services/                  the 4 microservices; each one is its own program with its own database
│  ├─ identity-access/        login and token
│  ├─ projects/               projects, milestones, approval
│  ├─ billing-receivables/    invoices, IVA, reconciliation
│  └─ analytics/              read models and the manager dashboard
├─ web/                       the screen (React)
├─ infra/                     everything that is not business code
│  ├─ gateway/nginx.conf      the gateway
│  ├─ certs/gen-certs.sh      the mTLS certificates
│  └─ keys/gen-keys.sh        the JWT keys
├─ docs/                      the API contract (openapi.yaml) and the event contract (events.md)
├─ scripts/                   test scripts and the demo reset
└─ docker-compose.yml         starts everything together
```

Inside every service the code is split in layers, so a rule never depends on the framework or the database:

```
services/<name>/
├─ src/
│  ├─ http/            receives the request and answers (routes + controllers, no logic)
│  ├─ application/     one use case per action: the story of what happens
│  ├─ domain/          the business rules, plain functions with their unit tests
│  ├─ infrastructure/  the database, RabbitMQ and other tools
│  ├─ auth/            the guard: verifies the JWT and the role
│  └─ tls.ts           mTLS: requires the caller's certificate
├─ prisma/             schema, migrations and demo seed
├─ test/               end-to-end tests against real PostgreSQL and RabbitMQ
└─ Dockerfile
```

### Where the mTLS lives

| What | Where |
|---|---|
| Create the certificates | `infra/certs/gen-certs.sh` |
| Require the caller's certificate in each service | `services/*/src/tls.ts` (the same file in the three services) |
| Start with TLS | `services/*/src/main.ts` |
| Handshake tests | `services/*/test/mtls.e2e.ts` |
| The gateway presenting its certificate | `infra/gateway/nginx.conf` |
| Pass everything to the containers | `docker-compose.yml` |

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
`andres.mora@nexus.example` (billing analyst), `camila.soto@nexus.example` (sales), `diana.vega@nexus.example` (manager: reads only the Analytics dashboard, 403 everywhere else).

## Run the infrastructure locally

```sh
cp .env.example .env      # then change the passwords
docker compose up -d      # PostgreSQL 16 and RabbitMQ 3.13
docker compose ps         # both should be "healthy"
```

Ports are published on `127.0.0.1` only. RabbitMQ management UI: http://localhost:15672.
Never commit `.env` or any `*.pem` / `*.key` file.
