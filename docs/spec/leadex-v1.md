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
| Own company database | ✅ 105M, from 310M websites + LinkedIn + Google Maps + registries | ✅ **Leadex Data**: own ClickHouse database from company websites, official registries and open web data; no LinkedIn or Google Maps |
| Own people database | ✅ 536M, LinkedIn-derived (inferred) | ✅ registry officers + people on company websites + profession registries, with per-field provenance |
| Agent searches companies/people with tools | ✅ | ✅ |
| Email finding | ✅ "6 providers cross-validated" | ✅ own finder: learned domain patterns + SMTP verification |
| Email verification | ✅ | ✅ own SMTP check + catch-all detection; paid verifier optional |
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
          ClickHouse Cloud: Leadex Data (companies, people, emails,
                            domain_patterns, sources, suppression)
          leadex-ingest (Fargate, scheduled): registry + open-data imports,
                            background crawl of new company domains
          leadex-mailcheck (small EC2 host with port 25 egress): SMTP checks
          External: Anthropic (Claude), web search API, SEC EDGAR, data.gov.in,
                    GLEIF, Web Data Commons, Stripe, Instantly, Sentry
                    (optional, off by default: People Data Labs, ZeroBounce)
```

One TypeScript codebase. The HTTP Lambdas reuse RigaChat's `handle` / `streamHandle` split. The worker is the same bundle run as a long-lived SQS consumer in a Fargate container (`backend/worker.ts`), so agent runs and big lead builds have no Lambda time limit. Infrastructure lives in AWS CDK (TypeScript) under `infra/`. Errors from all three go to Sentry.

### Leadex Data: our own lead database (ClickHouse)

Leadex owns its company and people data. It is built from sources we may lawfully use (research: `docs/research/people-data-sources.md`), grows with every lead build, and never comes from LinkedIn, Google Maps or any site whose terms forbid automated collection. Industry- and country-agnostic: v1 serves any B2B segment outside the EU/EEA/UK.

**Sources (v1)**

| Layer | Source | How | Gives |
|---|---|---|---|
| Company identity | the company's own website (crawler from #3) | on demand + background | name, domain, what they sell, industry, location, size signals, technologies, team pages |
| Company identity | GLEIF LEI file | monthly bulk import | legal name, country, parent/child links |
| Company discovery | web search API (provider chosen in #8d by terms + price) | on demand per segment | candidate domains for a segment's description |
| Company + people seed | Web Data Commons schema.org extracts (`Organization`, `Person` with `jobTitle`, `worksFor`) | quarterly import, non-EU/UK only | companies and named staff that sites publish as structured data |
| Officers | SEC EDGAR (`data.sec.gov`: filings, Form 3/4/5, proxy statements) | daily incremental | US public-company executives and directors |
| Officers | India company master (data.gov.in) + director data from a licensed MCA reseller | monthly | Indian companies and directors (DIN) |
| Officers | US state business registries with bulk files (state list chosen in #8b) | per-state schedule | officers of US private companies |
| People | company websites: team, about, leadership, press and blog-author pages | on demand + background | names, titles, departments, mid-level roles |
| Profession connectors | US NPI registry (monthly full file), state licence boards, India RERA | built only when a customer segment needs that profession (Phase 1.5) | licensed professionals |

Not used: LinkedIn (any form), Google Maps scraping or storing Places API results, lists without provenance, any page disallowed by robots.txt.

**Optional fallback vendor.** `DATA_VENDOR_FALLBACK=none|pdl` (default `none`). When on, People Data Labs fills only the shortfall of a lead build, and its records are stored only as far as its licence allows (`source = 'pdl'`, `licence_scope` column). Off by default so v1 runs entirely on our own data.

**Provenance on every field.** Each fact is a row in `facts` with source, source URL, retrieval time and extraction method, so we can prove where data came from, show it in exports, and delete a person everywhere on request.

```sql
CREATE TABLE companies (
  company_id String,            -- sha256(normalized domain)
  domain String, name String, legal_name String, lei String,
  description String, industry LowCardinality(String), keywords Array(String),
  employee_band LowCardinality(String), country LowCardinality(String),
  region String, city String, technologies Array(String),
  served_markets Array(String), updated_at DateTime
) ENGINE = ReplacingMergeTree(updated_at) ORDER BY domain;

CREATE TABLE people (
  person_key String,            -- sha256(lower(first)|lower(last)|domain)
  domain String, first_name String, last_name String, title String,
  seniority LowCardinality(String), department LowCardinality(String),
  country LowCardinality(String), is_officer UInt8, updated_at DateTime
) ENGINE = ReplacingMergeTree(updated_at) ORDER BY (domain, person_key);

CREATE TABLE facts (            -- provenance for every company/person field
  entity_type LowCardinality(String), entity_id String, field LowCardinality(String),
  value String, source LowCardinality(String), source_url String,
  method LowCardinality(String), -- registry | structured_data | page_extract | vendor
  licence_scope LowCardinality(String), retrieved_at DateTime
) ENGINE = MergeTree ORDER BY (entity_type, entity_id, field, retrieved_at);

CREATE TABLE domain_patterns (  -- learned email formats per company domain
  domain String, pattern LowCardinality(String), -- first.last | flast | first | ...
  evidence_count UInt32, mx_host String, accepts_all UInt8, checked_at DateTime
) ENGINE = ReplacingMergeTree(checked_at) ORDER BY domain;

CREATE TABLE emails (
  person_key String, email String, pattern LowCardinality(String),
  status LowCardinality(String), -- valid | invalid | catch_all | unknown
  checked_by LowCardinality(String), checked_at DateTime
) ENGINE = ReplacingMergeTree(checked_at) ORDER BY person_key;

CREATE TABLE suppression (      -- do-not-contact and deletion requests
  kind LowCardinality(String),  -- person | email | domain
  value_hash String, reason LowCardinality(String), created_at DateTime
) ENGINE = ReplacingMergeTree(created_at) ORDER BY (kind, value_hash);
```

**Search order in a lead build:** (1) Leadex Data, (2) on-demand discovery for the shortfall: web search → crawl candidate sites → profile → extract people → find emails, all written back to Leadex Data, (3) fallback vendor only if enabled. Repeat searches get cheaper and faster as the database grows.

**Freshness:** company profiles re-crawled after 90 days when touched by a build; registry imports on their schedule; emails re-checked after 60 days before delivery. People not seen on any source for 180 days are marked stale and not delivered.

### People extraction from websites

For each company, the crawler fetches team/about/leadership/contact/press pages (same robots.txt and SSRF rules as #3; ≤ 15 pages, ≤ 10 s). `LLM_MODEL_FAST` extracts `{name, title, department, sourceUrl}` with a zod schema. Rules: only people shown as working at this company; no personal social links; skip pages behind login; every person keeps the URL and quote they came from. Schema.org `Person` markup on the page is used first when present.

### Email finder (own)

For each person without a fresh `valid` email:

1. **Learn the pattern:** from addresses the company publishes on its own pages (contact, press, footer) and from earlier verified emails at the domain, pick the domain's pattern (`first.last`, `flast`, `first`, `firstl`, …).
2. **Generate** up to 3 candidates in pattern order.
3. **Check** each on `leadex-mailcheck`: MX lookup → SMTP `RCPT TO` without sending (no `DATA`) → stop at the first accept. Before that, probe one random address on the domain; if it is accepted the domain is catch-all and results are `catch_all`, never `valid`.
4. **Write back** the email, its status and the domain pattern.

`leadex-mailcheck` runs on a small EC2 instance with port 25 egress approved by AWS (AWS blocks port 25 by default), a dedicated IP with PTR/HELO on a Leadex-owned domain, and per-domain rate limits (≤ 1 probe per domain per 30 s, ≤ 3 candidates per person). If a mail server greylists or rate-limits us, the result is `unknown` and the person is retried later, not delivered. A paid verifier (`EMAIL_VERIFIER_FALLBACK=none|zerobounce`, default `none`) can double-check `unknown` results.

Catch-all emails are delivered only when the user turns on "include risky" (off by default) and are never charged at full price.

### Privacy and data-subject rights

- Public page `/privacy/remove-me`: anyone can ask to be removed (email, or name + company domain). Verified by a link to that email. Removal deletes the person's rows and `facts`, and adds a hashed entry to `suppression` so the person is never re-collected. SLA: 30 days, target 72 h.
- Every lead export and push includes `source` and `retrieved_at` per row. The first email template the drafter writes includes a short line saying how we found the contact (required in some markets, good practice everywhere).
- India: registry data is used under DPDP s. 3(c)(ii) (published under a legal obligation); website data only where the person published it themselves. **Legal review required before launch** (`docs/research/people-data-sources.md`, legal section).

### Pipeline

Analysis (free, anonymous allowed) runs as one worker invocation. Each step appends events.

| # | Step id | Does | Model / vendor | Target |
|---|---|---|---|---|
| 1 | `crawl` | Normalize domain. Fetch homepage + up to 10 same-origin pages (nav links, /pricing, /about). Respect robots.txt. Cap 2 MB of text. | cheerio | ≤ 8 s |
| 2 | `profile` | Build a `ProductProfile` | `LLM_MODEL_FAST` | ≤ 8 s |
| 3 | `competitors` | LLM proposes 15 domains; keep those that resolve to a live site in Leadex Data (or a quick homepage fetch) *and* whose country is in the profile's `servedMarkets` (or that operate globally); return up to 10. Observed gap in the reference product (2026-10-20, qdnco.com): a Bangalore-only agency got 8 of 12 competitors from Brazil, Chile or Saudi Arabia. | `LLM_MODEL_FAST` + Leadex Data / crawl | ≤ 8 s |
| 4 | `segments` | 4-6 `IcpSegment`s with structured company filters and buyer titles | `LLM_MODEL_SMART` | ≤ 10 s |

Segments must be on screen within 30 s (p50).

Lead build (signed in, uses credits) is a second run type, `lead_build`, for chosen segments:

| # | Step id | Does |
|---|---|---|
| 5 | `prospect` | Tool-using agent (`LLM_MODEL_SMART`) with tools `search_companies` (Leadex Data), `discover_companies` (web search → crawl → profile, for the shortfall), `find_people` (Leadex Data + website extraction), `find_emails` (own finder). Hard budgets: ≤ 12 tool calls, ≤ requested lead count + 30% candidates, ≤ 200 new domains crawled per build. |
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
- Packs live in `backend/src/config/credit-packs.ts`. Initial values are 250 for $49 and 1,000 for $149. Confirm them before launch so gross margin is ≥ 60% at the measured cost per lead: web search + crawl + LLM extraction + mailcheck infra (+ fallback vendor when enabled) (see acceptance criterion 9).

### Repositories (each wraps exactly one external system)

| File | Wraps |
|---|---|
| `backend/src/repositories/llm-repository.ts` | Anthropic Messages API. `LlmRepository` interface so another provider can be added later. Models come from `LLM_MODEL_SMART` / `LLM_MODEL_FAST`. |
| `backend/src/repositories/lead-data-repository.ts` | ClickHouse Cloud: Leadex Data (companies, people, facts, domain_patterns, emails, suppression) |
| `backend/src/repositories/web-search-repository.ts` | the chosen web search API, behind `WebSearchRepository` |
| `backend/src/repositories/mailcheck-repository.ts` | HTTP client for `leadex-mailcheck` (MX + SMTP RCPT checks) |
| `backend/src/repositories/registries/{sec-edgar,gleif,india-company-master,mca-director,us-state-*}-repository.ts` | one official source or licensed reseller each, behind `RegistryRepository` |
| `backend/src/repositories/open-data/web-data-commons-repository.ts` | schema.org extract files (download + parse) |
| `backend/src/repositories/fallback/pdl-repository.ts` | optional People Data Labs gap-filler behind `LeadVendorRepository` (off by default) |
| `backend/src/repositories/fallback/zerobounce-repository.ts` | optional verifier for `unknown` results (off by default) |
| `backend/src/repositories/site-fetch-repository.ts` | HTTP fetch + robots.txt |
| `backend/src/repositories/instantly-repository.ts` | Instantly: validate key, list campaigns, add leads |
| `backend/src/repositories/stripe-repository.ts` | Checkout session, webhook verify |
| `backend/src/repositories/*-table-repository.ts` | one per DynamoDB table |

External endpoint paths, field names and terms of use are verified against each source's current docs while implementing their child issue, and pinned in a fixture-backed contract test.

### Environment variables

`AWS_REGION, ANTHROPIC_API_KEY, LLM_MODEL_SMART, LLM_MODEL_FAST, WEB_SEARCH_API_URL, WEB_SEARCH_API_KEY, SEC_USER_AGENT, MCA_PROVIDER_API_URL, MCA_PROVIDER_API_KEY, MAILCHECK_URL, MAILCHECK_TOKEN, MAILCHECK_HELO_DOMAIN, DATA_VENDOR_FALLBACK, PDL_API_KEY (only if fallback = pdl), EMAIL_VERIFIER_FALLBACK, ZEROBOUNCE_API_KEY (only if verifier fallback = zerobounce), INGEST_BUCKET, CLICKHOUSE_URL, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD, SENTRY_DSN, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, TURNSTILE_SECRET, KMS_KEY_ID, COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, SQS_RUNS_QUEUE_URL, FRONTEND_URL, PIPELINE_VERSION, TABLE_USERS, TABLE_ANALYSES, TABLE_RUNS, TABLE_RUN_EVENTS, TABLE_LEADS, TABLE_CREDIT_LEDGER, TABLE_INTEGRATIONS, TABLE_RATE_LIMITS`

### Compliance (v1)

- People records located in the EU, EEA or UK are neither collected nor returned in v1 (enforced in ingestion and in `/api/leads`). A GDPR-ready mode is Phase 2.
- Generated drafts always end with an `{{unsubscribe}}` placeholder that the user's sending tool fills in.
- Terms state that the user is the sender and is responsible for CAN-SPAM compliance. Exported CSVs include the data source and retrieval date per row.
- Collection rules: robots.txt respected; crawler domain blocklist includes linkedin.com, google.com/maps and any site whose terms forbid automated collection; only business-role data (no home addresses, personal phones, personal social profiles).
- Data-subject requests handled through `/privacy/remove-me` (see "Privacy and data-subject rights"). California (CPRA) access and deletion requests use the same flow.
- **Before launch:** legal review of sources and lawful basis for India (DPDP Act 2023 + Rules 2025) and US (CAN-SPAM, CPRA).

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
| 8 | Leadex Data store: ClickHouse schema (companies, people, facts, domain_patterns, emails, suppression), `lead-data-repository`, provenance writes, EU/UK guard, `leadex-ingest` Fargate task skeleton | High | 2 d / 2 h | 1 |
| 8a | Company layer: on-demand discovery (web search repo, provider chosen by terms + price), batch crawl + profile of candidate domains (reuses #3), GLEIF import | High | 5 d / 5 h | 3, 8 |
| 8b | People layer: website people extraction (team/about/press pages, schema.org first), SEC EDGAR officers, India company master + licensed director data, first US state bulk registries, Web Data Commons `Person` import | High | 5 d / 5 h | 8, 8a |
| 8c | Own email finder: pattern learning, candidate generation, `leadex-mailcheck` EC2 service (port 25 approval, PTR/HELO, per-domain rate limits, catch-all detection), optional ZeroBounce for `unknown` | High | 4 d / 4 h | 8 |
| 8d | Optional fallback vendor (PDL) behind `LeadVendorRepository`, off by default, licence-scoped storage; contract tests | Medium | 1 d / 1 h | 8 |
| 8e | Privacy: `/privacy/remove-me` with email verification, deletion across tables + suppression, provenance in CSV/push, crawler blocklist | High | 2 d / 2 h | 8 |
| 9 | `prospect` agent + `qualify` step | High | 3 d / 3 h | 4, 8a, 8b, 8c |
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
    └─> #8 ─┬─> #8a (also #3) ─> #8b ───────┤
            ├─> #8c ────────────────────────┘
            ├─> #8d (optional)
            └─> #8e (before any real lead is delivered)
```

### Sequencing rationale

The run engine (#2) carries every later step. Steps written before it exists would need rework to emit events. Free analysis (#3-#6) ships first because it is the top of the funnel and can be tested with real users before any data spend. Leadex Data (#8-#8c) can start in parallel with the frontend: the company layer reuses the #3 crawler, and the email finder needs only the store. Port 25 approval from AWS can take days, so request it on day one of #8c. Credits (#7) must exist before any paid build (#9). Privacy (#8e) must ship before the first real lead is delivered. Learning (#13) needs real send data, so it goes last.

## Acceptance Criteria

1. `POST /api/analyses` for an uncached domain shows the first `step` event in the client within 2 s, and all segments within 30 s p50 / 60 s p95, measured over the 20 eval fixture sites.
2. The same domain requested again within 30 days returns `cached: true`, and the full event replay finishes in under 3 s with 0 LLM, crawl or external data calls (asserted by repository call counters in an integration test).
3. An SSE disconnect followed by a reconnect with `Last-Event-ID: n` delivers exactly the events with seq > n: no gaps, no duplicates.
4. A 4th anonymous analysis from one IP in one UTC day returns `429 { code: 'rate_limited' }`. Missing or invalid Turnstile returns `400`.
5. A lead build for 50 leads delivers its first leads within 90 s p50 when Leadex Data already holds matching companies, and within 5 min p50 when every company must be discovered and crawled. Every delivered lead has `emailStatus: 'valid'`, email domain = company domain, and fitScore ≥ 60.
6. In the 50-lead hand-check, ≥ 70% (35/50) of leads are judged a match for their segment by the reviewer.
7. Credits: a build delivering k leads debits exactly k credits. A user with balance < requested gets `402` and no crawl, search, mailcheck or vendor call is made. Concurrent builds can never drive the balance below 0 (conditional-write test with 5 parallel debits).
8. A Stripe webhook replayed 3 times with the same event id grants credits once.
9. Measured cost per analysis run ≤ $0.50, and per delivered lead ≤ 40% of the lowest pack's price per credit. Both are logged per run in `leadex_runs.costUsd`.
10a. A second identical lead search within 90 days is served at least 80% from Leadex Data, with discovery, crawl or fallback calls only for the shortfall (asserted by repository call counters).
10b. Email finder: a catch-all domain never yields `valid` (fixture SMTP server that accepts everything); the finder stops at the first accepted candidate; no domain gets more than 1 probe per 30 s (clock-controlled test); `DATA` is never sent (protocol transcript assertion).
10c. Every delivered company and person field has a `facts` row with source, source URL and retrieval time; a delivered lead without provenance fails the build (integration test).
10d. A confirmed `/privacy/remove-me` request removes the person from `people`, `facts` and `emails`, and a later ingestion or crawl that finds them again does not re-create them (suppression test).
10e. The crawler never requests a blocklisted host (linkedin.com, Google Maps) or a robots.txt-disallowed path (fixture test).
10. No record with country in EU/EEA/UK is ever stored or returned by `/api/leads` (test with seeded fixtures that include such records).
11. Instantly push of 50 leads reports `pushed + skipped = 50`. A key that fails validation is rejected with `422` and is not stored.
12. Each test in the Testing Plan states its card: `protects=<observable>; fails_when=<wrong result it rejects>; no_claim=<what green does not prove>`.
13. No layer skips another. A lint rule or test fails if any `routes/` file imports from `repositories/`, or any `services/` file imports an SDK client directly.
14. Business goal, tracked and not gating the merge: 10 paying users within 30 days of launch.

## Testing Plan

| Layer | What | Count |
|---|---|---|
| Unit | domain normalization, segment → search query mapping, email pattern inference and candidate generation, people-extraction schema, qualify rules (domain match, EU exclusion, score threshold), credit math, SSE framing, zod schemas with repair | +40 |
| Contract | each external repository against recorded fixtures (web search, SEC EDGAR, GLEIF, India company master, MCA provider, Web Data Commons, mailcheck, Instantly, Stripe, Anthropic; PDL/ZeroBounce when enabled) | +14 |
| Integration | analysis end to end with stubbed externals; Leadex Data hit vs discovery; fake SMTP server (accept, reject, catch-all, greylist); remove-me + suppression; SSE resume; rate limit; lead build with debits; concurrent debit; webhook idempotency | +16 |
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
- Paid paths are gated by the `LEAD_BUILDS_ENABLED` env flag; set it to `false` to stop all lead builds, crawling for builds and SMTP checks instantly. `INGEST_ENABLED=false` stops scheduled imports.
- Credit ledger entries are append-only. Corrections are compensating entries, never deletes.

## Effort Estimate

About 45 human-days total (≈ 9-10 weeks solo), or about 45 hours of focused CC sessions plus review, AWS port-25 approval and the legal review.
Breakdown: scaffold 3 d, run engine 2 d, analysis steps 4 d, frontend 3 d, cache and limits 1 d, auth and credits 3 d, **Leadex Data 19 d** (store 2, company layer 5, people layer 5, email finder 4, fallback vendor 1, privacy 2), agent and qualify 3 d, drafts and charge 2 d, export and Instantly 2 d, evals 1 d, learning loop 2 d. Compared with the vendor plan (32 d), owning the data adds about 13 days.

Running cost moves from per-record vendor fees to: web search API calls, LLM extraction (`LLM_MODEL_FAST`, about one call per crawled page set), ClickHouse Cloud, one small EC2 host for mailcheck, and an MCA director-data licence. Measured per run in `leadex_runs.costUsd` (acceptance criterion 9).

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
| `backend/src/config/email-patterns.ts` | supported email patterns and their default order |
| `backend/src/config/crawler-blocklist.ts` | hosts never crawled (linkedin.com, Google Maps, …) |
| `backend/ingest.ts` | `leadex-ingest` entry point (scheduled registry and open-data imports) |
| `mailcheck/` | `leadex-mailcheck` service (EC2): MX + SMTP RCPT checks, rate limits, catch-all probe |
| `frontend/app/privacy/remove-me/page.tsx` | data-subject removal request |
| `infra/clickhouse/001_leadex_data.sql` | ClickHouse schema above |

## Out of Scope (v1)

- Sending email, mailbox or domain provisioning, warm-up, reply handling, meeting booking (Phase 2 epic)
- LinkedIn outreach
- Teams or workspaces with multiple seats; agency white-label
- Profession connectors (NPI, state licence boards, RERA): Phase 1.5, built when a customer segment needs them
- Any LinkedIn-derived or Google-Maps-scraped data, in any form
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

- Teardown: `docs/research/explee-teardown.md` (data sources in section 11)
- Lead data sources and legal notes: `docs/research/people-data-sources.md`
- Explee public API reference (for comparison only): `docs/research/explee-api/`
- Decision 2026-10-29: Leadex owns its lead database (no PDL dependency in v1, no LinkedIn data ever); PDL kept only as an optional, off-by-default gap-filler
- Reverse-engineering captures of explee.com (2026-10-20), local only, not committed: `flow2.json`, `account-flow.json`, `console-tour2.json`, `agent-session-events.json`
- Decisions: `e5e4cac1` (no sending in v1), `1ed1b03b` (name, market, repo), `f0574faa` (hybrid stack)
