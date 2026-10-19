# identity-access

Login and JWT issuing. `POST /auth/login` checks the password (bcrypt) and returns an RS256 token with the
user's role. Other services verify the token with the public key only (`infra/keys/jwt-public.pem`).

```sh
sh ../../infra/keys/gen-keys.sh            # once: creates the RSA key pair (git-ignored)
cp .env.example .env                       # change the values
export $(grep -v '^#' .env | xargs)
npx prisma migrate deploy && npx ts-node prisma/seed.ts   # table + 3 demo users
npm run build && npm start                 # http://localhost:4101  (Swagger at /docs)
npm test                                   # unit tests
npm run test:e2e                           # needs the infra running (docker compose up -d)
```

Structure: `src/domain` and `src/application` have no framework imports (hexagonal core);
`src/infrastructure` holds the adapters (Prisma, bcrypt, jsonwebtoken); `src/http` holds the controller.

## mTLS
With `TLS_ENABLED=true` the service serves HTTPS and requires a client certificate from the internal CA whose name is in `TLS_ALLOWED_CLIENTS` (needs `TLS_CERT_PATH`, `TLS_KEY_PATH`, `TLS_CA_PATH`; it refuses to start without them). `DOCS_HTTP_PORT` (demo only) adds a plain-HTTP port for Swagger. Tests: `test/mtls.e2e.ts` (real handshake; it generates throwaway certificates).
