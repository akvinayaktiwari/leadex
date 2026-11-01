# Harvey (ethanplusai/harvey) vs Leadex

Read 2026-11-01 from the public repo (MIT licence, Python, ~3.8k stars, last push 2026-10-31). Ideas below may be reused; any ported code keeps Harvey's MIT notice.

## What it is

A self-hosted sales agent for one technical user: a 15-minute loop that discovers local businesses, profiles their sites, finds the owner, guesses and verifies an address, writes short sequences, sends from the user's own mailbox (approval by default, optional autopilot), reads replies and books meetings. Model calls run on the user's Claude or ChatGPT subscription through the CLI.

## Where it differs from Leadex

| | Harvey | Leadex |
|---|---|---|
| Delivery | local tool, one user | hosted, multi-customer |
| Company discovery | live per run: OpenStreetMap (free, thin coverage, ODbL licence) or Google-derived SERP/Maps APIs (DataForSEO, Serper, Scavio) | our own database built ahead from open data (Common Crawl ranks, registries) |
| Sending | yes, own mailbox; replies and booking | not in v1 (CSV / Instantly) |
| Models | user's subscription via CLI | Claude API (a SaaS cannot run on customers' personal subscriptions) |
| Pricing | free | pay per verified lead |

Not adopted: SERP/Maps scraping APIs (same terms question as web search, see spec "Why not a web search API"); OpenStreetMap as a stored source until its ODbL share-alike obligations are reviewed.

## Adopted into Leadex issues

| Idea from Harvey | Where |
|---|---|
| **SMTP probing is weak against Google Workspace and Microsoft 365**: they accept any recipient from an unknown IP, so `RCPT TO` proves nothing there. Test this on day one and treat those MX providers as "unverifiable by SMTP". | #24 |
| Learn the address pattern from addresses the site publishes (decode Cloudflare email protection, `data-user`/`data-domain`, `name [at] domain [dot] com`); an address two named people could own is format evidence only; never verify a candidate another named person could own; a lone ambiguous address (`kmorrow@`) teaches nothing. | #24 |
| Honest status per address: `verified` / `catch_all` / `guess` / `invalid`; only deliverable ones are delivered. | #24 (matches criterion 10b) |
| Public job-board feeds (Greenhouse, Lever, Ashby, Workable) linked from the company's own site: open roles as a buying signal, "not hiring" recorded when the board is empty. | #22 profiler |
| Cheap site signals from HTML already fetched: ad pixels (Google Ads, Meta), technologies, missing schema.org markup, stale blog, page count, agency credit in the footer scored by wording ("Website by" 0.9, bare link 0.75, unlabelled link not recorded). | #22 profiler |
| Startup signals only from the company's own words ("we went through Y Combinator", "we raised a $4M seed"), never from customer/audience lines or third-party directories. | #22 profiler |
| Owner detection: follow the site's own menu to people pages (≤ 6); read cards, sentences ("owned and operated by …") and schema.org `founder`/`employee`; exclude testimonials, other organisations' officers, former/late owners; title match by whole word; at most 2 people per company. | #23 |
| When no person is named, use a general mailbox the company publishes (`office@`, `info@`, `hello@`), never guessed, verified like any other address, greeting the team. | #23, #24 |
| Do-not-contact semantics: a domain covers its subdomains, an address covers its plus-tags; a malformed entry is an error, not silently ignored. | #26 |
| Cohorts as a query over confirmed signals (must have / must not have / numeric range) with a live count. | #12 (ClickHouse makes this cheap) |
