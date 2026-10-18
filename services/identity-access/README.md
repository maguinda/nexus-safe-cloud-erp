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
