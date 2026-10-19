# identity-access

Login, JWT issuing and user administration. `POST /auth/login` checks the password (bcrypt) and returns an RS256 token with the
user's role. Other services verify the token with the public key only (`infra/keys/jwt-public.pem`).

```sh
sh ../../infra/keys/gen-keys.sh            # once: creates the RSA key pair (git-ignored)
cp .env.example .env                       # change the values
export $(grep -v '^#' .env | xargs)
npx prisma migrate deploy && npx ts-node prisma/seed.ts   # table + 4 demo users
npm run build && npm start                 # http://localhost:4101  (Swagger at /docs)
npm test                                   # unit tests
npm run test:e2e                           # needs the infra running (docker compose up -d)
```

Structure: `src/domain` and `src/application` have no framework imports (hexagonal core);
`src/infrastructure` holds the adapters (Prisma, bcrypt, jsonwebtoken); `src/http` holds the controller.

## User administration (manager only)
| Route | What it does |
|---|---|
| `GET /users` | Lists users (never passwords or hashes) |
| `POST /users` | Creates a user with a role and an initial password (201) |
| `PATCH /users/:id/role` | Changes a role (applies from the next sign-in) |

Rules, all checked in the code and several again in the database:
- **Only a manager**, and the caller's role is **re-read from the database** on every action (a token lives 15 minutes, so a manager demoted a moment ago would otherwise keep access).
- Emails are stored in lower case (`CHECK (email = lower(email))` + unique): `Ana@x.co` and `ana@x.co` are the same person (409).
- Password: at least 12 characters, at most 72 bytes (bcrypt ignores the rest), not containing the email or its name part, at least 4 different characters. Only a bcrypt hash is stored and nothing sensitive is returned or logged.
- You cannot change **your own role**, and the **last manager** can never lose the role. A role change takes the lock on every manager row first (`SELECT … FOR UPDATE`), so two managers demoting each other at the same time cannot leave the system without a manager (tested with 30 rounds).
- Bodies accept only the documented fields (an extra `passwordHash` or `id` is a 400); writes are rate limited per client (`USERS_WRITE_RATE_LIMIT`, 30 per minute).
- Not built yet: `UserCreated` / `RoleChanged` events (identity has no outbox yet), changing your own password, deactivating a user, token revocation.

## mTLS
With `TLS_ENABLED=true` the service serves HTTPS and requires a client certificate from the internal CA whose name is in `TLS_ALLOWED_CLIENTS` (needs `TLS_CERT_PATH`, `TLS_KEY_PATH`, `TLS_CA_PATH`; it refuses to start without them). `DOCS_HTTP_PORT` (demo only) adds a plain-HTTP port for Swagger. Tests: `test/mtls.e2e.ts` (real handshake; it generates throwaway certificates).
