# Leadex

AI outbound agent: paste a website URL, get qualified leads with verified emails and ready-to-send drafts.

- Spec: [docs/spec/leadex-v1.md](docs/spec/leadex-v1.md) (epic #1)
- Reference teardown: [docs/research/explee-teardown.md](docs/research/explee-teardown.md)

## Layout

```
backend/   Hono app (TypeScript strict). routes → services → repositories.
  index.ts    API Lambda (Function URL, BUFFERED)
  stream.ts   SSE Lambda (Function URL, RESPONSE_STREAM)
  worker.ts   Fargate SQS consumer (pipeline runs, no time limit)
  tools/      layering checker used by tests/architecture.test.ts
frontend/  Next.js App Router, static export for Cloudflare Pages
infra/     AWS CDK stack: 8 DynamoDB tables, SQS + DLQ, KMS, Lambdas, Fargate worker
```

## Requirements

Node 20.19+ (CI and Lambda use Node 22, see `.nvmrc`), npm 10+, Docker (worker image only).

## Commands

```bash
npm ci
npm run typecheck      # all workspaces, strict
npm test               # backend + infra (includes the layering check)
npm run build          # backend bundles + frontend static export

# local API (copy backend/.env.example to backend/.env first)
npm run dev --workspace backend          # http://localhost:8787/api/health

# local frontend (copy frontend/.env.example to frontend/.env.local)
npm run dev --workspace frontend         # http://localhost:3000

# backend tests against DynamoDB Local (otherwise those 4 tests skip)
docker run -d -p 8000:8000 amazon/dynamodb-local:2.6.1
DYNAMODB_ENDPOINT=http://localhost:8000 npm test --workspace backend

# infrastructure
cd infra
export STAGE=dev AWS_REGION=ap-south-1 FRONTEND_URL=https://<your-frontend> LLM_MODEL_SMART=claude-opus-5-5 LLM_MODEL_FAST=claude-opus-5-5
npx cdk synth
npx cdk deploy
```

Before the first deploy of a stage, create its app secret once. The worker reads `ANTHROPIC_API_KEY` from it; the ingest task reads the ClickHouse connection:

```bash
aws secretsmanager create-secret --name leadex/dev/app --secret-string \
  '{"ANTHROPIC_API_KEY":"<key>","CLICKHOUSE_URL":"https://<host>:8443","CLICKHOUSE_USER":"<user>","CLICKHOUSE_PASSWORD":"<password>"}'
```

If the secret already exists, add the three `CLICKHOUSE_*` keys with `aws secretsmanager put-secret-value` (it replaces the whole JSON, so include `ANTHROPIC_API_KEY` too).

### Leadex Data (ClickHouse)

Leadex's own lead database runs on ClickHouse Cloud, created by hand (not in CDK). The database name is `leadex_<stage>`. Apply the schema in `infra/clickhouse/` before the first deploy and after adding a migration:

```bash
CLICKHOUSE_URL=... CLICKHOUSE_USER=... CLICKHOUSE_PASSWORD=... CLICKHOUSE_DATABASE=leadex_dev \
  npm run migrate:clickhouse --workspace backend
```

The daily import task (`leadex-ingest`, 03:00 IST) is deployed with its schedule disabled. Deploy with `INGEST_ENABLED=true` to turn it on once sources exist (#22, #23).

Local development and tests use a ClickHouse container (see `backend/.env.example`); the ClickHouse tests run when `CLICKHOUSE_URL` is set and are required in CI.

All configuration comes from environment variables; see `backend/.env.example` and `frontend/.env.example`.
