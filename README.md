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

The daily import task (`leadex-ingest`, 03:00 IST) is deployed with its schedule disabled. Deploy with `INGEST_ENABLED=true` to turn it on.

Company discovery starts from the Common Crawl domain-level web graph. Set `CC_DOMAIN_RANKS_URL` to the release's `*-domain-ranks.txt.gz` (a new release appears each quarter) and `INGEST_CC_MAX_DOMAINS` (default 2,000,000). The job streams the file, keeps the best-linked domains after dropping EU/EEA/UK ccTLDs and government/education suffixes, and stops reading once it has enough; a release that is already imported is not downloaded again. Locally: `INGEST_ENABLED=true INGEST_CC_MAX_DOMAINS=2000 node backend/dist/ingest.mjs` after `npm run build:ingest`.

The company profiler then crawls those domains best-linked first (skipping the platform/CDN list in `backend/src/config/platform-domains.ts`), reads technologies, ad pixels, schema.org business details, agency credits and job-board links from the HTML, and asks `LLM_MODEL_FAST` for a profile in which every field cites the page it came from. A company is stored only with an allowed country taken from the site's own markup or from a quote the code finds on the cited page; everything else is recorded in `domain_crawl_status` with a reason. It is off until `INGEST_PROFILE_MAX_PER_RUN` is above 0.

Measure cost before turning it on:

```bash
INGEST_ENABLED=true INGEST_CC_MAX_DOMAINS=5000 node backend/dist/ingest.mjs     # import domains
LLM_FAST_INPUT_USD_PER_MTOK=<price> LLM_FAST_OUTPUT_USD_PER_MTOK=<price> \
  npm run profile:sample --workspace backend -- --limit 1000                    # prints outcomes, tokens, cost per company
```

In AWS, deploy with `INGEST_PROFILE_MAX_PER_RUN=<n>` (the ingest task reads `ANTHROPIC_API_KEY` from the stage app secret).

Local development and tests use a ClickHouse container (see `backend/.env.example`); the ClickHouse tests run when `CLICKHOUSE_URL` is set and are required in CI.

All configuration comes from environment variables; see `backend/.env.example` and `frontend/.env.example`.
