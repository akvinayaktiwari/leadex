# [Epic] Leadex v1: website URL to qualified leads and ready-to-send email drafts

## Context

Founders and small SaaS teams know their product but not who to sell it to, and building a lead list plus personal cold emails takes days. Leadex takes a website URL and, in under 90 seconds, shows what the product does, who buys it, a list of real companies and decision makers with verified emails, and a personal email draft for each. Users pay per verified lead with prepaid credits.

The reference product is explee.com, observed on 2026-10-20 with REA (`capture-browser-scenario`). Leadex rebuilds the *idea*, not the implementation: no Explee code, copy, prompts, naming or visual design is reused.

**v1 sends nothing.** It exports CSV or pushes leads and drafts into the user's own Instantly account. Managed sending (domains, mailboxes, warm-up, replies, meeting booking) is a Phase 2 epic. Decision log: `e5e4cac1` (ceiling 7/10, upgrade once paying users ask for done-for-you sending).

## Current State

- Greenfield. No `akvinayaktiwari/leadex` repo exists (checked with `gh repo view`, 2026-10-20).
- Reusable patterns from `akvinayaktiwari/RigaChat` (read 2026-10-20):
  - `backend/index.ts`: one esbuild bundle deployed as several Lambdas (BUFFERED Function URL, RESPONSE_STREAM Function URL, SQS worker) via `handle` / `streamHandle` from `hono/aws-lambda`.
  - `backend/src/lib/sqs.ts`: typed job messages with a discriminated union and `enqueueCrawlerJob()`. The worker uses batch size 1.
  - `backend/src/services/crawler-service.ts`, `crawler-worker-service.ts`: cheerio-based site crawl.
  - `backend/package.json`: hono 4, zod 3, vitest, esbuild, AWS SDK v3, aws-jwt-verify (Cognito).
- What the Explee reference shows (observed behaviour):

| Capability | Explee | Leadex v1 |
|---|---|---|
| Analyze site → product summary | ✅ | ✅ |
| Competitors | ✅ (9) | ✅ (up to 10, validated) |
| Buyer segments with criteria and share | ✅ (6) | ✅ (4-6) |
| Live step-by-step progress (SSE) | ✅ | ✅ |
| Cache per domain, anonymous preview | ✅ | ✅ |
| Own 105M-company database (ClickHouse) | ✅ | 🟡 ClickHouse cache that grows from every People Data Labs result |
| Agent searches companies/people with tools | ✅ | ✅ |
| Email finding | ✅ (user reports Hunter found their email) | ✅ waterfall: Hunter → Prospeo → Findymail |
| Email verification | unknown | ✅ ZeroBounce |
| Email drafts | ✅ | ✅ (first email + 1 follow-up) |
| Managed sending, replies, booking | ✅ | ❌ Phase 2 |
| Learning loop (cost per lead per segment) | ✅ | ✅ basic, from Instantly stats |
| Pay-as-you-go credits | ✅ | ✅ Stripe |

## Proposed Change

### Architecture

```
Next.js frontend (Cloudflare Pages + Turnstile)
   │  POST /api/analyses            GET /api/runs/:runId/events (SSE)
   ▼                                  ▼
leadex-api (Lambda, BUFFERED)    leadex-stream (Lambda, RESPONSE_STREAM)
   │ routes → services → repos        │ polls run_events every 500 ms
   │ enqueue                          │
   ▼                                  │
SQS leadex-runs ──► leadex-worker (ECS Fargate service, autoscaled on queue depth)
   (DLQ after 2 receives)            │ pipeline steps; appends events; no 15-min cap
                                     ▼
          DynamoDB: app state (users, runs, run_events, credits, integrations)
          ClickHouse Cloud: lead cache (companies, people, email_results)
          External: Anthropic (Claude), People Data Labs, Hunter,
                    Prospeo, Findymail, ZeroBounce, Stripe, Instantly, Sentry
```

One TypeScript codebase. The HTTP Lambdas reuse RigaChat's `handle` / `streamHandle` split. The worker is the same bundle run as a long-lived SQS consumer in a Fargate container (`backend/worker.ts`), so agent runs and big lead builds have no Lambda time limit. Infrastructure lives in AWS CDK (TypeScript) under `infra/`. Errors from all three go to Sentry.

### Lead cache (ClickHouse)

Every company, person and email result bought from a vendor is written to ClickHouse with `source`, `fetchedAt` and `vendorRecordId`. `search_companies` and `search_people` query the cache first and only call vendors for the shortfall. Over time this builds Leadex's own lead database, and repeat searches become free.

```sql
CREATE TABLE companies (
  domain String, name String, industry LowCardinality(String),
  employee_count UInt32, country LowCardinality(String), technologies Array(String),
  keywords Array(String), linkedin_url String, source LowCardinality(String),
  fetched_at DateTime
) ENGINE = ReplacingMergeTree(fetched_at) ORDER BY domain;

CREATE TABLE people (
  person_key String,  -- sha256(lower(first)|lower(last)|domain)
  domain String, first_name String, last_name String, title String,
  seniority LowCardinality(String), country LowCardinality(String),
  linkedin_url String, source LowCardinality(String), fetched_at DateTime
) ENGINE = ReplacingMergeTree(fetched_at) ORDER BY (domain, person_key);

CREATE TABLE email_results (
  person_key String, email String, finder LowCardinality(String),
  status LowCardinality(String), -- valid | invalid | catch_all | unknown
  verified_by LowCardinality(String), checked_at DateTime
) ENGINE = ReplacingMergeTree(checked_at) ORDER BY person_key;
```

Cached records older than 90 days are re-verified before delivery. Email results with `status != valid` are never delivered.

### Email-finder waterfall

For each person without a cached valid email, try the providers in order and stop at the first `valid`:

1. **Hunter** Email Finder (name + domain), with its confidence score
2. **Prospeo**
3. **Findymail**
4. Verify the winning address with **ZeroBounce**. Catch-all results are kept only if the user turns on "include risky" (off by default) and are never charged at full price.

Each provider is one repository behind a shared `EmailFinderRepository` interface, so providers can be reordered or added in `backend/src/config/email-finders.ts` without code changes elsewhere. Each provider's cost per call is logged so the order can be tuned by hit rate per dollar.

**Not built:** scraping LinkedIn, or any site whose terms forbid it. The only first-party collection is role addresses (for example `sales@`, `hello@`) found on the target company's own public pages, with robots.txt respected.

### Pipeline

Analysis (free, anonymous allowed) runs as one worker invocation. Each step appends events.

| # | Step id | Does | Model / vendor | Target |
|---|---|---|---|---|
| 1 | `crawl` | Normalize domain. Fetch homepage + up to 10 same-origin pages (nav links, /pricing, /about). Respect robots.txt. Cap 2 MB of text. | cheerio | ≤ 8 s |
| 2 | `profile` | Build a `ProductProfile` | `LLM_MODEL_FAST` | ≤ 8 s |
| 3 | `competitors` | LLM proposes 15 domains; keep those that PDL company enrich resolves *and* whose HQ country is in the profile's `servedMarkets` (or that operate globally); return up to 10. Observed gap in the reference product (2026-10-20, qdnco.com): a Bangalore-only agency got 8 of 12 competitors from Brazil, Chile or Saudi Arabia. | `LLM_MODEL_FAST` + PDL | ≤ 8 s |
| 4 | `segments` | 4-6 `IcpSegment`s with structured company filters and buyer titles | `LLM_MODEL_SMART` | ≤ 10 s |

Segments must be on screen within 30 s (p50).

Lead build (signed in, uses credits) is a second run type, `lead_build`, for chosen segments:

| # | Step id | Does |
|---|---|---|
| 5 | `prospect` | Tool-using agent (`LLM_MODEL_SMART`) with tools `search_companies`, `search_people`, `verify_emails`. Hard budgets: ≤ 8 tool calls, ≤ requested lead count + 20% candidates. |
| 6 | `qualify` | Drop records whose email domain ≠ company domain, whose company name/domain mismatch (normalized-token check), or whose verification status is not `valid`. LLM scores the fit of each survivor against its segment from 0-100; keep ≥ 60. |
| 7 | `draft` | One first email + one follow-up per lead (`LLM_MODEL_FAST`), grounded only in `ProductProfile` + lead fields. Each draft stores `personalizationBasis` (which fields were used). |
| 8 | `charge` | Debit 1 credit per delivered lead (verified email + passed qualify), in one transaction. Failed or dropped candidates cost nothing. |

Export and push are user actions after the run: CSV download, or push to an Instantly campaign with the user's own API key.

### Data model (DynamoDB, on-demand)

| Table | PK | SK | Notes |
|---|---|---|---|
| `leadex_users` | `userId` (Cognito sub) | — | email, createdAt, freeCreditsGranted |
| `leadex_analyses` | `domain` | `pipelineVersion` | cached result: profile, competitors, segments, status, createdAt, expiresAt (TTL 30 d) |
| `leadex_runs` | `runId` | — | type `analysis` \| `lead_build`, domain, userId?, status, createdAt, error? |
| `leadex_run_events` | `runId` | `seq` (number) | `RunEvent`. TTL 7 d. |
| `leadex_leads` | `userId` | `leadId` | lead + drafts + segmentId + runId |
| `leadex_credit_ledger` | `userId` | `ts#entryId` | +grant/+purchase/-debit, balance snapshot. Debit uses a conditional write on `leadex_users.creditBalance >= n`. |
| `leadex_integrations` | `userId` | `provider` | Instantly API key, KMS-encrypted (same pattern as RigaChat `lib/kms.ts`) |
| `leadex_rate_limits` | `key` (ip#day / device#day) | — | anonymous analyses; TTL 2 d |

### Core types (`backend/src/types/`)

```ts
export type RunType = 'analysis' | 'lead_build'
export type RunStatus = 'queued' | 'running' | 'done' | 'failed'
export type StepId = 'crawl' | 'profile' | 'competitors' | 'segments'
  | 'prospect' | 'qualify' | 'draft' | 'charge'

export type RunEvent =
  | { seq: number; ts: string; kind: 'step'; step: StepId; state: 'started' | 'completed' | 'failed'; label: string; durationMs?: number }
  | { seq: number; ts: string; kind: 'artifact'; step: StepId; artifact: 'profile' | 'competitor' | 'segment' | 'lead_batch'; data: unknown }
  | { seq: number; ts: string; kind: 'agent_note'; text: string }
  | { seq: number; ts: string; kind: 'end'; status: 'done' | 'failed'; error?: { code: string; message: string } }
// `data: unknown` is validated per artifact by zod schemas in lib/schemas.ts before writing.

export interface ProductProfile {
  domain: string
  name: string
  oneLiner: string            // ≤ 160 chars
  valueProps: string[]        // 3-6
  category: string
  pricingSignals: string[]    // e.g. "free trial", "per seat"
  servedMarkets: string[]     // ISO-3166 alpha-2, or ['GLOBAL']; inferred from site copy, address, currency, phone formats
}

export interface CompanyFilters {
  industries: string[]
  employeeMin: number
  employeeMax: number
  countries: string[]         // ISO-3166 alpha-2
  keywords: string[]
  technologies: string[]
}

export interface IcpSegment {
  segmentId: string
  name: string
  useCase: string
  pain: string
  criteria: string[]          // 2-4
  buyerTitles: string[]       // 2-6
  filters: CompanyFilters
  sharePct: number            // all segments sum to 100
}

export interface Lead {
  leadId: string
  segmentId: string
  company: { domain: string; name: string; employeeCount?: number; industry?: string; country?: string }
  person: { firstName: string; lastName: string; title: string; email: string; linkedinUrl?: string }
  emailStatus: 'valid'
  fitScore: number            // 60-100
  drafts: { first: EmailDraft; followUp: EmailDraft }
}

export interface EmailDraft { subject: string; body: string; personalizationBasis: string[] }
```

### API (Hono, zod-validated)

| Method | Path | Auth | Request → Response |
|---|---|---|---|
| POST | `/api/analyses` | optional | `{ url }` → `202 { runId, cached: boolean }`. Uses the cache if a completed analysis exists for (domain, pipelineVersion) younger than 30 d. Anonymous: 3/day per IP and per device id; Cloudflare Turnstile token required. |
| GET | `/api/runs/:runId/events` | optional (lead_build needs owner) | SSE. `id:` = seq. Honors `Last-Event-ID`. Heartbeat comment every 15 s. Closes after an `end` event or 840 s. |
| GET | `/api/analyses/:domain` | none | latest cached analysis or 404 |
| POST | `/api/lead-builds` | required | `{ domain, segmentIds: string[], leadCount: 10-500 }` → `202 { runId }`, or `402 { code: 'insufficient_credits', balance, required }` |
| GET | `/api/leads?runId=` | required | `{ leads: Lead[] }` |
| GET | `/api/leads/export.csv?runId=` | required | CSV stream |
| PUT | `/api/integrations/instantly` | required | `{ apiKey }` → validates with one read call, stores KMS-encrypted |
| POST | `/api/leads/push` | required | `{ runId, campaignId }` → `{ pushed, skipped }` |
| GET | `/api/credits` | required | `{ balance, ledger: [...] }` |
| POST | `/api/credits/checkout` | required | `{ packId }` → `{ checkoutUrl }` (Stripe Checkout) |
| POST | `/api/webhooks/stripe` | Stripe signature | grants credits idempotently on event id |

### Credits and pricing

- 1 credit = 1 delivered lead (verified email + passed qualify). Analysis is free.
- New account: 25 free credits, granted once per Cognito user and once per verified email domain.
- Packs live in `backend/src/config/credit-packs.ts`. Initial values are 250 for $49 and 1,000 for $149. Confirm them before launch so gross margin is ≥ 60% at the measured PDL + ZeroBounce + LLM cost per lead (see acceptance criterion 9).

### Repositories (each wraps exactly one external system)

| File | Wraps |
|---|---|
| `backend/src/repositories/llm-repository.ts` | Anthropic Messages API. `LlmRepository` interface so another provider can be added later. Models come from `LLM_MODEL_SMART` / `LLM_MODEL_FAST`. |
| `backend/src/repositories/company-data-repository.ts` | People Data Labs company search + enrich |
| `backend/src/repositories/people-data-repository.ts` | People Data Labs person search |
| `backend/src/repositories/email-verification-repository.ts` | ZeroBounce batch validate |
| `backend/src/repositories/email-finders/{hunter,prospeo,findymail}-repository.ts` | one email-finder API each, behind `EmailFinderRepository` |
| `backend/src/repositories/lead-cache-repository.ts` | ClickHouse Cloud (companies, people, email_results) |
| `backend/src/repositories/site-fetch-repository.ts` | HTTP fetch + robots.txt |
| `backend/src/repositories/instantly-repository.ts` | Instantly: validate key, list campaigns, add leads |
| `backend/src/repositories/stripe-repository.ts` | Checkout session, webhook verify |
| `backend/src/repositories/*-table-repository.ts` | one per DynamoDB table |

Vendor endpoint paths and field names are verified against each vendor's current docs while implementing their child issue, and pinned in a fixture-backed contract test.

### Environment variables

`AWS_REGION, ANTHROPIC_API_KEY, LLM_MODEL_SMART, LLM_MODEL_FAST, PDL_API_KEY, HUNTER_API_KEY, PROSPEO_API_KEY, FINDYMAIL_API_KEY, ZEROBOUNCE_API_KEY, CLICKHOUSE_URL, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD, SENTRY_DSN, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, TURNSTILE_SECRET, KMS_KEY_ID, COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, SQS_RUNS_QUEUE_URL, FRONTEND_URL, PIPELINE_VERSION, TABLE_USERS, TABLE_ANALYSES, TABLE_RUNS, TABLE_RUN_EVENTS, TABLE_LEADS, TABLE_CREDIT_LEDGER, TABLE_INTEGRATIONS, TABLE_RATE_LIMITS`

### Compliance (v1)

- People records located in the EU, EEA or UK are excluded by default (`countries` filter enforced server-side). A GDPR-ready mode is Phase 2.
- Generated drafts always end with an `{{unsubscribe}}` placeholder that the user's sending tool fills in.
- Terms state that the user is the sender and is responsible for CAN-SPAM compliance. Exported CSVs include the data source and retrieval date per row.

## Child Issues

| # | Title | Priority | Effort (human / CC) | Depends on |
|---|---|---|---|---|
| 1 | Repo scaffold: Hono app, 2 Lambda handlers + Fargate worker entry, CDK stack (tables, SQS+DLQ, KMS, ECS service), Next.js app on Cloudflare, Sentry, CI (tsc, vitest), `.env.example` | Critical | 3 d / 3 h | — |
| 2 | Run engine: runs + run_events repos, worker dispatch, SSE endpoint with Last-Event-ID resume and heartbeat | Critical | 2 d / 2 h | 1 |
| 3 | `crawl` + `profile` steps | Critical | 2 d / 2 h | 2 |
| 4 | `competitors` + `segments` steps, zod-validated LLM output with 1 repair retry | Critical | 2 d / 2 h | 3 |
| 5 | Frontend: URL input, live analysis view rendering events as they arrive, segment picker (original design) | Critical | 3 d / 3 h | 2 |
| 6 | Domain cache, anonymous rate limits, Turnstile | High | 1 d / 1 h | 2 |
| 7 | Auth (Cognito) + credits ledger + Stripe Checkout + webhook | High | 3 d / 3 h | 1 |
| 8 | Lead data repos (PDL company/person, ZeroBounce) with contract tests | High | 2 d / 2 h | 1 |
| 8a | ClickHouse lead cache: schema, cache-first search, write-through on every vendor result, 90-day re-verify | High | 2 d / 2 h | 8 |
| 8b | Email-finder waterfall: Hunter → Prospeo → Findymail → ZeroBounce, config-driven order, per-provider cost logging | High | 2 d / 2 h | 8 |
| 9 | `prospect` agent + `qualify` step | High | 3 d / 3 h | 4, 8a, 8b |
| 10 | `draft` + `charge` steps | High | 2 d / 2 h | 7, 9 |
| 11 | Leads table UI, CSV export, Instantly integration + push | High | 2 d / 2 h | 10 |
| 12 | Eval harness: 20 fixture sites → segment quality; 50-lead hand-check sheet | Medium | 1 d / 1 h | 4, 9 |
| 13 | Learning loop v1: pull Instantly campaign stats daily, show reply rate and cost per positive reply per segment | Medium | 2 d / 2 h | 11 |

### Dependency graph

```
#1 ─┬─> #2 ─┬─> #3 ─> #4 ─┬─────────────> #9 ─> #10 ─> #11 ─> #13
    │       ├─> #5        │                 ▲      ▲
    │       └─> #6        └─> #12 (also #9) │      │
    ├─> #7 ────────────────────────────────────────┘
    └─> #8 ─┬─> #8a ────────────────────────┤
            └─> #8b ────────────────────────┘
```

### Sequencing rationale

The run engine (#2) carries every later step. Steps written before it exists would need rework to emit events. Free analysis (#3-#6) ships first because it is the top of the funnel and can be tested with real users before any data spend. Credits (#7) must exist before any paid data call (#9), so no vendor spend can happen without a balance. Learning (#13) needs real send data, so it goes last.

## Acceptance Criteria

1. `POST /api/analyses` for an uncached domain shows the first `step` event in the client within 2 s, and all segments within 30 s p50 / 60 s p95, measured over the 20 eval fixture sites.
2. The same domain requested again within 30 days returns `cached: true`, and the full event replay finishes in under 3 s with 0 LLM or vendor calls (asserted by repository call counters in an integration test).
3. An SSE disconnect followed by a reconnect with `Last-Event-ID: n` delivers exactly the events with seq > n: no gaps, no duplicates.
4. A 4th anonymous analysis from one IP in one UTC day returns `429 { code: 'rate_limited' }`. Missing or invalid Turnstile returns `400`.
5. A lead build for 50 leads delivers its first leads within 90 s p50. Every delivered lead has `emailStatus: 'valid'`, email domain = company domain, and fitScore ≥ 60.
6. In the 50-lead hand-check, ≥ 70% (35/50) of leads are judged a match for their segment by the reviewer.
7. Credits: a build delivering k leads debits exactly k credits. A user with balance < requested gets `402` and no vendor call is made. Concurrent builds can never drive the balance below 0 (conditional-write test with 5 parallel debits).
8. A Stripe webhook replayed 3 times with the same event id grants credits once.
9. Measured cost per analysis run ≤ $0.50, and per delivered lead ≤ 40% of the lowest pack's price per credit. Both are logged per run in `leadex_runs.costUsd`.
10a. A second identical lead search within 90 days is served at least 80% from the ClickHouse cache, with vendor calls only for the shortfall (asserted by repository call counters).
10b. The waterfall stops at the first `valid` result. A person found by Hunter never triggers a Prospeo or Findymail call (fixture test), and every delivered email has a ZeroBounce `valid` status.
10. No record with country in EU/EEA/UK is ever returned by `/api/leads` (test with seeded vendor fixtures that include such records).
11. Instantly push of 50 leads reports `pushed + skipped = 50`. A key that fails validation is rejected with `422` and is not stored.
12. Each test in the Testing Plan states its card: `protects=<observable>; fails_when=<wrong result it rejects>; no_claim=<what green does not prove>`.
13. No layer skips another. A lint rule or test fails if any `routes/` file imports from `repositories/`, or any `services/` file imports an SDK client directly.
14. Business goal, tracked and not gating the merge: 10 paying users within 30 days of launch.

## Testing Plan

| Layer | What | Count |
|---|---|---|
| Unit | domain normalization, filter → vendor query mapping, qualify rules (domain match, EU exclusion, score threshold), credit math, SSE framing, zod schemas with repair | +30 |
| Contract | each vendor repository against recorded fixtures (PDL, ZeroBounce, Instantly, Stripe, Anthropic) | +10 |
| Integration | analysis end to end with stubbed vendors; cache hit; SSE resume; rate limit; lead build with debits; concurrent debit; webhook idempotency | +12 |
| E2E | paste URL → see segments → sign up → buy pack (Stripe test mode) → build 10 leads → export CSV | +2 |
| Eval | 20 fixture sites: segment JSON valid + rubric score; 50-lead manual sheet | 1 harness |

## Rules for the implementing agent

1. Acceptance criteria are the `protects / fails_when / no_claim` profile of each test: the observable it protects, the wrong result it rejects, and what green does not prove. Never "make the tests pass".
2. Real code and real tests land in the same change. A placeholder, a stub assertion or a test deferred to a follow-up is not done.
3. Any change to a test, validator, CI step, timeout, tolerance, threshold, snapshot or suppression pragma is reported on its own line in your summary with its justification, before any other result.
4. A reported command names the command and its observed result (exit status, counts, the failing line). A command you did not run is not reported, and stderr is never silenced in a command you cite.
5. Your report is a claim until the parent re-executes it: say what you verified, what you reused, and what you could not check.
6. Follow the global rules: TypeScript strict, no `any`, typed inputs and outputs, functions ≤ 40 lines, kebab-case files, all config in env vars, no silent catch blocks.
7. Do not reuse Explee's code, UI copy, prompts, step names or visual design.

## Rollback Plan

- Each child issue ships behind its own deploy. Lambda versions with aliases let you roll back with `aws lambda update-alias` to the previous version.
- Paid paths are gated by the `LEAD_BUILDS_ENABLED` env flag; set it to `false` to stop all vendor spend instantly.
- Credit ledger entries are append-only. Corrections are compensating entries, never deletes.

## Effort Estimate

About 32 human-days total (≈ 6-7 weeks solo), or about 32 hours of focused CC sessions plus review and vendor account setup.
Breakdown: scaffold 3 d, lead cache 2 d, email waterfall 2 d, run engine 2 d, analysis steps 4 d, frontend 3 d, cache and limits 1 d, auth and credits 3 d, data repos 2 d, agent and qualify 3 d, drafts and charge 2 d, export and Instantly 2 d, evals 1 d, learning loop 2 d.

## Files Reference

| File | Change |
|---|---|
| `infra/lib/leadex-stack.ts` | CDK: 8 tables, SQS + DLQ, KMS key, 3 Lambdas, Function URLs |
| `backend/index.ts` | `handler`, `streamingHandler`, `workerHandler` (RigaChat pattern) |
| `backend/src/routes/{analyses,runs,lead-builds,leads,integrations,credits,webhooks}-routes.ts` | HTTP only |
| `backend/src/services/{analysis,run-engine,pipeline-steps/*,lead-build,credit,export,integration,learning}-service.ts` | logic |
| `backend/src/repositories/*` | see Repositories table |
| `backend/src/lib/{sqs,kms,sse,schemas,domain,turnstile}.ts` | utilities |
| `backend/src/types/index.ts` | types above |
| `backend/src/config/credit-packs.ts` | pack definitions |
| `frontend/app/{page,analysis/[domain]/page,leads/page,billing/page,settings/page}.tsx` | Next.js App Router pages |
| `frontend/src/hooks/use-run-events.ts` | EventSource with resume |
| `backend/worker.ts` | Fargate SQS consumer entry point |
| `backend/src/config/email-finders.ts` | waterfall order and per-call cost |
| `infra/clickhouse/001_lead_cache.sql` | ClickHouse schema above |

## Out of Scope (v1)

- Sending email, mailbox or domain provisioning, warm-up, reply handling, meeting booking (Phase 2 epic)
- LinkedIn outreach
- Teams or workspaces with multiple seats; agency white-label
- Our own company or people database
- EU/UK prospect data
- Bring-your-own lead upload
- Public API for customers
- Non-English sites or emails

## Phase 2 outline (separate epic, informed by `docs/research/explee-teardown.md`)

Not part of v1. Recorded here so v1 choices don't block it.

| Area | Leadex Phase 2 design | Why (vs reference) |
|---|---|---|
| Sending identity | Customer-owned lookalike domains, registered in the customer's name, 3-5 mailboxes each, warm-up through a provider API. The sender display name is always a real person on the customer's team, on 100% of sends. | Reference sends from a shared pool of made-up personas and keeps the persona name on ~10% of sends even after the user sets a real name |
| Schedule | Per-country send windows in the lead's local time; smart weekends (Fri/Sat in Gulf states) | Reference does this well; keep it |
| Sequence | First email + up to 2 follow-ups, 3-day gap, stop on reply; "instructions" and "my copy" modes; preview on real leads before launch | Keep the pattern; make preview mandatory |
| Review gate | Lead list and the first 10 drafts need explicit approval. No auto-approve timer; reminders at 12 h and 48 h | Reference auto-approves after 12 h |
| Reply handling | Classifier: `hot`, `out_of_office` (defer to return date), `not_interested`, `email_changed` (add new contact), `recipient_gone` (suppress), `auto_ack`, `self_reply`, plus `unsubscribe` (suppress immediately) | Reference taxonomy is solid; add explicit unsubscribe |
| Auto-reply | Off by default. Can be turned on only when the facts KB has pricing + capabilities. Every factual sentence must cite a KB doc id, and replies with uncited claims go to a human queue | Reference: on by default even with an empty KB |
| Spend safety | Monthly cap required at checkout; auto-recharge opt-in; one daily budget shared by all campaigns, shown as a monthly estimate | Reference: auto-recharge on, monthly cap null |
| Lead search agent | Sub-agent with `query_leads` (SQL over the ClickHouse cache), `run_python` (sandboxed), `score_rows` (batched LLM criteria scoring) and `web_search`. Persist the learned segment → category/title vocabulary per vertical so later runs skip discovery. Target: under 5 min per campaign. | Reference: ~27 min and ~70 tool calls per campaign |
| Steering | Chat box per campaign that sends messages into the running agent session; event log paged by `since=seq` | Reference pattern; keep |
| Integrations | HubSpot first, then public `GET /api/v1/hot-leads?since=` with API keys, then a copyable "agent prompt" | Cheap to match |
| Lead statuses | Configurable vocabulary (default Hot, Demo, Won, Lost, Unqualified) | Same |

## Related

- Teardown: `docs/research/explee-teardown.md`
- Reverse-engineering captures of explee.com (2026-10-20), local only, not committed: `flow2.json`, `account-flow.json`, `console-tour2.json`, `agent-session-events.json`
- Decisions: `e5e4cac1` (no sending in v1), `1ed1b03b` (name, market, repo), `f0574faa` (hybrid stack)
