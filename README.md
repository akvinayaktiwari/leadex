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

# infrastructure
cd infra
STAGE=dev AWS_REGION=ap-south-1 FRONTEND_URL=https://<your-frontend> npx cdk synth
STAGE=dev AWS_REGION=ap-south-1 FRONTEND_URL=https://<your-frontend> npx cdk deploy
```

All configuration comes from environment variables; see `backend/.env.example` and `frontend/.env.example`.
