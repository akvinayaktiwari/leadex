# Explee teardown (reference product for Leadex)

Observed 2026-10-20 with REA (`rea-agents@6.7.0`): an anonymous run on consolto.com, then a signed-in run on our own project, qdnco.com (project 51876).
Everything here is **observed behaviour** (network calls, responses, UI text) unless marked *inferred*.
Leadex must not copy Explee's code, UI copy, prompts or visual design. This file records *what* it does so we can decide *what we do better*.

Raw captures stay out of git, in the session scratchpad: `flow2.json`, `account-flow.json`, `console-tour.json`, `ob*-out.json`. Stripe bodies and client secrets have been redacted.

---

## 1. Stack and vendors

| Layer | Explee | Evidence | Leadex decision |
|---|---|---|---|
| Frontend | Next.js (Turbopack, App Router, RSC `_rsc` fetches, server actions as `POST` to page URLs) | REA bundle fingerprint; `text/x-component` responses | Next.js on Cloudflare (same idea) |
| Edge/CDN | Cloudflare (RUM, email obfuscation) | `/cdn-cgi/rum`, `email-decode.min.js` | Cloudflare |
| Backend compute | Container service on AWS ECS us-west-2 (event collector `fh-*.ecs.us-west-2.on.aws`) | network host | Lambda for HTTP/SSE + Fargate worker |
| Lead DB | ClickHouse (own 105M companies / 536M people) | agent timings `clickhouse_query`, `generate_sql`; pricing copy "536M people profiles" | ClickHouse cache that grows from vendor data |
| AI agent | Claude with tool use | tool IDs `toolu_*` in agent stream | Claude |
| Auth | Logto-style OIDC on `auth.explee.com`, passwordless email code | `/oidc/auth`, `/api/experience/verification/verification-code[/verify]`, `/api/experience/submit` | Cognito email OTP (already in RigaChat) |
| Payments | Stripe Elements + SetupIntent, saved card, auto-recharge | `create-elements-checkout` → `seti_*`, `activate-subscription` | Stripe Checkout, prepaid packs, **auto-recharge off by default** |
| Anti-bot | hCaptcha (in Stripe), `human-pass` check | `/api/human-pass` → `{mode:"off",has_pass:false}` | Cloudflare Turnstile |
| Errors | Sentry | `sentry-trace`, `baggage` headers | Sentry |
| Support | Self-hosted widget `support.explee.com`, JWT per visitor | `/api/support-app/widget-token` | Crisp/Intercom later |
| Analytics | Amplitude, GA4/GTM, Plausible (self-hosted), Cloudflare RUM | storage keys, hosts | PostHog (one tool) |
| Ad pixels | Meta (+ server CAPI `/api/capi`), TikTok (+ `/api/tiktok`), LinkedIn, X, Reddit, Google Ads, OpenAI ads pixel | hosts | Meta + Google + LinkedIn only, server-side |
| Visitor de-anonymisation | Snitcher, HappierLeads, ipapi | hosts, storage keys | Later: an "identify your website visitors" feature for *our* customers |
| Affiliates | Pushlap Growth, Referly; in-app referral $25/$25, affiliate 20% × 12 months | `/app-auto-gtm/referral` | Referral v2 |

## 2. Funnel

1. **Landing:** paste a URL. Live typeahead `GET /api/companies/search?q=` returns `{name, domain, desc, explee_id}` from their own DB.
2. **Anonymous research page** `/auto-gtm/company/{domain}/explore?phase=…`. Phases seen: `research_company` → `research_company_loading` → `research_competitors_loading` → `research_segments`.
3. **Sign-in wall** (email code) only when you want to act on leads.
4. **8-step onboarding** at `/app-auto-gtm/onboarding/{domain}?step=…`:

| Step | `step=` | Screen | What it writes |
|---|---|---|---|
| 1-2 | (research) | company + competitors | — |
| 3 | `confirm` | "Did we get you right?": product one-liner + markets (🇮🇳 India), each with Yes/Edit | sets `confirm_required:false` |
| 4 | `budget` | daily budget slider $10-$200, default **$20 "Typical"**; live projection of emails/day, positive replies/month, meetings/month | `PATCH /api/app-auto-gtm/projects/{id}/budget {daily_budget_usd, surface}` → `{daily_budget_usd, campaign_floor_usd, monthly_cap_usd:null, month_spent_usd, monthly_cap_reached}` |
| 5 | `campaigns` | one toggle per segment (all 6 on) | segments → `status: searching` |
| 6 | `booking` | sender name: "Automatic, matches each mailbox" (rotated **made-up personas**, e.g. "Finn Turner", "Leo Brooks", "Mia Bennett") or "My name", which requires first + last name and is "used on ~90% of emails; the rest keep the mailbox name". Booking link: Calendly/Cal.com detected. | *pending* |
| 7 | `facts` | "Tell auto-replies about your project": structured facts that ground AI auto-replies. Sections: **Pricing** ("plans and prices, what each plan includes, free trial or discounts, billing options"), **Capabilities & integrations** ("what the product does, key features, supported integrations, limits"), **Proof & case studies**. Each section has Save/Cancel. All optional. | `POST /api/app-auto-gtm/projects/{id}/project-docs {doc_type: 'pricing' \| 'capabilities' \| 'proof', title, content}` → `{id (uuid), doc_type, title, content}`; list via `GET …/project-docs` → `{docs:[…]}` |
| 8 | `hdyhau` | "How did you hear about us?" (X, Google, ChatGPT/AI tool, LinkedIn, Cold email, Instagram, Facebook, Reddit, Friend, Other) → "Go to dashboard" | attribution only; no launch gate |

**Onboarding takeaway:** campaigns start searching at step 5, *before* the user has given a sender name (step 6) or any facts for replies (step 7). The wizard never shows a final "review and launch" screen. Sending is gated per campaign by a lead-list review, but that review **auto-approves after 12 hours** (see 7a).

**Accuracy gap:** the research step summarised qdnco.com as "15 static creatives/month" and "Bangalore only". The live site (pricing page updated 2026-10-13) says unlimited creatives within the agreed scope and also serves Dubai. The wrong claim went straight into a generated cold email. *Inferred:* their crawl is stale or summarises an older page version. Leadex must show the crawl date and source URL for every product claim and let the user correct it before any draft is generated.

5. **Console** `/app-auto-gtm/p/{projectId}` (locked behind onboarding): Dashboard · Inbox · Sent · Project docs · Email sequence · Sending schedule · Targeting · Integrations · Suppress list · Own domains & mailboxes · one page per campaign (segment) · New campaign · Refer and earn.

## 3. Research agent (from the SSE stream)

`POST /api/agent/ensure/{segmentKey}` → `{run_id, status, created}`. **Runs are cached per domain and shared across visitors.** The consolto.com run was created 2026-09-29 and replayed to us, and the stream logs other visitors' `draft_shown` events.

`GET /api/agent/{run_id}/stream` (SSE `data: {json}` lines). Event types: `step_update{step,status,message,elapsed_ms}`, `segment_ready`, `domain_ready`, `start{task}`, `tool_call{tool,input,description,intent}`, `tool_result`, `text`, `done`, `finished`, `preview_ready{step,count}`, `stream_end`.

Steps and timings (consolto.com):

| Step | Output | Time |
|---|---|---|
| fetch | company record from own DB | 0.1 s |
| determinants | 4 "what it does" statements | 6.4 s |
| search_queries | 3 search phrases (parallel) | — |
| competitors | 9-15 domains | 4 s |
| segments | 6 ICP segments | <0.1 s |
| infra | 12 lookalike outreach domains checked available | <0.1 s |
| targeting | decision maker + geo per segment | 8.3 s |
| agent loop | `search_companies(filters)` → `search_people(job_titles, geo, people_per_company)` → self-critique text | ~35 s |

Results tables: `GET /api/agent/{run_id}/file/_companies.parquet?limit=` and `_people.parquet` (JSON `{columns, rows}` despite the name). Email discovery: `GET /api/agent/{run_id}/enrich_emails/stream`.

**Quality gaps observed**
- qdnco.com is Bangalore-only, but 8 of 15 competitors are in Brazil, Chile, Saudi Arabia or Vietnam. There is no served-market filter.
- consolto.com: the agent itself reported "match quality is poor" (domain/name mismatches such as homedepot.com described as a 27-person distribution centre).

## 4. Data model (from `GET /api/app-auto-gtm/projects/{id}`)

**Project:** `id, domain, company_name, description, competitors[], info{industry, location, geo_country, logo_url, product_description_200w, founded}, autopilot_enabled (true), auto_reply_enabled (true), auto_reply_delay_minutes (1440), paused_for_review, reply_cc_emails[], reply_instructions, owner_email, target_url, default_template, followup_rules{max_touches:2, delay_days:3, stop_on_reply:true}, target_geo, target_company_size, schedule{days[mon..fri,sun], days_source, use_system_schedule}` plus top-level `confirm_required, confirm_arm`.

**Segment (= campaign):** `id, key, name, description, pain, use_case, positive_criterias[], example_clients[], decision_maker, target_geo, target_company_size, daily_limit_usd, status, status_reason, status_display{value,label,tone,animated,hint,detail,manual_start_blocked,sending_paused_by_budget,no_matches}, people_count, language ('auto'), instructions, followup_instructions, followup_rules, template_source{1,2}, has_own_template{1,2}, booking_link_source, own_booking_url, created_by, second_touch_by, settings{...}`.

**Settings inheritance pattern (worth copying as an idea):** each setting is stored as `{shape, source, effective, own, project}`. A segment inherits project values unless it has `own`, and the UI shows `effective`.

Segment status lifecycle seen: `starting` ("Launched — warming up") → `searching` ("Agent is finding companies and people…").

## 5. Pricing and billing

`GET /api/app-auto-gtm/pricing`:
- 1 credit = $0.01. **1 email = 4 credits = $0.04.** You pay per email *sent*, not per lead.
- Daily budget $10-$200, default $10 (API) / $20 (onboarding UI), 21 sending days/month.
- Projection assumptions: reply rate 0.25-0.45%, meeting rate 0.06-0.24% per email.
- Tiers: Light ≤$15, Typical ≤$25, Growth ≤$50, Power.
- Plan `classic_4` "Classic": max 2 follow-ups, custom sender name, HubSpot, white label; **no CSV export, no deep email search**.
- Checkout sends `auto_recharge: true`. With a saved card, spend continues automatically once the $30 free credit is used.
- `monthly_cap_usd` exists but is `null` by default.

## 6. Email generation

`POST /api/draft/generate {segment_id, person_profile_url, company_domain, first_name, last_name, title, company_name, company_description}` → `{draft_id, cached, subject, body, highlights[], language_used, language_reason}`.
Observed draft: about 90 words, a 2-word subject, an opener about the prospect's company and role, a one-line pitch, a low-friction offer ("two or three written ideas"), and a question CTA. **It was signed with an invented first name ("Ishaan at QD & Co.").**

### 6a. Email preview pipeline (Email sequence → "Apply instructions")

1. `POST /segments/{id}/my-copy/check {subject, body, lead_id}` → validation `errors[]` / `warnings[]`, plus available **variables with fill rates** computed over the campaign's leads: `first_name` 100%, `company` 99.4%, `job_title` 99.7%, `company_city` 83.2%, `sender_first_name`, `sender_company`. The default template mixes merge fields with AI slots:
   ```
   Subject: {{sender_company}} x {{company}}
   Hi {{first_name|there}},
   {{ai: one sentence about what their company does, based on their website}}
   {{ai: one sentence on how our offer could help them}}
   Worth a quick chat?
   ```
2. `POST /segments/{id}/moderate-brief {touch, instructions}` → `{moderation_status, moderation_category}`: the user's instructions are checked first.
3. `POST /segments/{id}/preview-emails/draft {lead_id, instructions, followup_instructions, language, touches:[1], copy_mode:"ai"}` → per touch: `subject, body, sender_name, language_used, language_reason, cache_hit` and **`highlights[]`**, each with `{text, kind: research|instructions, title, explanation, sources[]}`, so every personalised sentence is traced to a data field or an instruction.
4. `POST /segments/{id}/moderate-preview {subject, body_text, guard}`: the generated email is checked again before it's shown.

Observed draft (Commercial Developers campaign, after the pitch fix): about 100 words; opener cites the lead's named project and city from the company description; one-sentence pitch; offer of "three short written ideas"; reply-only CTA; signed "Sai at QD & Co." (derived from sender name "V Sai Kavshik").
**Fit issue:** the Commercial Developers campaign pitched "office and investor buyers, plus retail property leads" to a residential township developer. The campaign's segment keywords were inserted even though the lead's profile didn't match them.

### 6b. Lead pool (Apartment promoters campaign, at review)

`GET /segments/{id}/leads?people_offset&people_limit&companies_offset&companies_limit` → `{meta:{companies_count, people_count, …_shown}, companies[], people[]}`. `GET /segments/{id}/leads/breakdown` → `{geo_people, geo_companies, job_titles, sizes}`.
- 19,648 people at 12,294 companies, 100% India (no city focus).
- Titles: Director 9,318, Managing Director 3,443, Founder 2,222, CEO 1,116, Sales Manager 638…
- Sizes: 1-10 employees 6,134; 11-50 4,699; 51-200 1,099; 201-1,000 312; larger 30.
- Stale-employer records are visible (e.g. a person listed under a builder whose headline names a different current employer).
- At $0.04/email and $10/day, about 250 emails/day; the $30 credit covers about 750 emails, under 4% of the pool. *Inferred:* the pool is sized for months of sending, not for precision.

Review UI: "Found N unique leads. Review and approve to start outreach. Auto-approve is off. Describe what to change below, or approve when ready." [Approve] plus a free-text change request to the agent. `review.auto_approve_cancelled_at` was set about 20 min after the list was ready, so the 12 h auto-approve can be cancelled (trigger not identified).

### 6c. Live sending (observed 2026-10-20, from 14:28 UTC)

- The first sends came about 15 min after approval. 7 first-touch emails were sent in 8 min across Prelaunch Teams (5) and Plotted developers (2); 0 bounces; $0.04 each (`month_spent_usd` 0.16 after 4).
- **Sender domains are Explee's shared network, unrelated to the customer:** `letsbuzzhq.co`, `joinlift.digital`, `joincyclebase.com`, `letswarmzone.com`, `hellodriftline.com`, `line-lift.com`. Rotated per send; one domain was used twice in 7 sends. The email body says "Sai at QD & Co." but the From address has nothing to do with QD & Co.
- Subjects are 2-3 words, topical: "Plotted layouts", "Pre-launch demand", "Upcoming Launch", "Launch demand".
- `GET /projects/{id}/inbox/contacts?tab=sent` → `{contacts[], has_more, next_offset, total_count}`. Contact fields: `lead_name, to_email, email_revealed (false = recipient address hidden from the customer), mailbox_email, segment_id/name, send_status, sent_count, first_touch_count, follow_up_count, latest_subject, latest_sent_at, last_send_bounced, reply_count, our_reply_count, latest_reply_at, reply_from_name, latest_intent, latest_user_intent, lead_temperature, manual_status, needs_reply, has_scheduled_auto_reply, erased`.
- Budget after launch: `campaign_floor_usd: 4`. *Inferred:* a minimum daily spend reserved per active campaign.
- Pause while sending: `POST /api/agent-chat/segments/{id}/pause {}` → `{accepted:true}`; status "Paused · Stage: Outreach", button Resume. "Stop" only exists before outreach.

### 6d. Day 2 (checked 2026-10-21 08:06 UTC)

- Volume ramped overnight: 13 first-touch emails on 10-20, then 123 on 10-21 before 08:06 UTC. Total 136, 0 follow-ups yet, 0 bounces, `queued: 5`.
- Per campaign: Commercial Developers 29, Plotted developers 28, Villa developers 39, Brokerage Firms 35, Prelaunch Teams 5 (listening, i.e. paused). The UI shows a per-campaign pace hint ("~4 emails/day") that doesn't match actual volume (29 in a day).
- Spend $5.44 of the $10 daily budget, balance $24.52 of $30. At $0.04/email the daily cap allows about 250 sends a day across campaigns.
- 2 replies (1.5%), both from Villa developers, both classified `intent: not_interested`, `temperature: cold`, `need_reply: false`. No auto-reply was queued for them.
- New sender domain seen: `lineturn.co`, with the From display name set to the customer's sender name.
- Data bug: in `dashboard.last_replies[]`, `company_name` holds the lead's email address. The real company is in `company_display`.
- `dashboard` also returns `setup_steps` (project_docs, geography, booking_link, follow_ups, reply_copies) with `done` flags. This is their post-launch checklist nudging users to add docs and reply copy.

### 6e. Day 4: replies and threads (checked 2026-10-23 ~12:25 UTC)

- **Totals:** 360 emails, all first touch, 0 follow-ups. 3 human replies (0.8%), 1 hot lead, 2 bounces (one each on 10-22 and 10-23), 0 auto-replies. Daily volume 13 / 125 / 115 / 107 (10-20 to 10-23). Spend $14.40, balance $15.56; at about $4.30-5/day the free credit runs out around 10-26, then auto-recharge charges the card (`monthly_cap_usd` still null).
- **Daily budget is split per campaign:** `daily_budget_usd` per segment is 3 / 2 / 2 (+ Brokerage), within the $10 project budget and `campaign_floor_usd: 4`. Actual spend (~$4.50/day) is well under $10. *Inferred:* the per-campaign split, not the project budget, limits volume.
- **No follow-ups yet, as expected:** `delay_days: 3`; the first sends (10-20 ~14:30 UTC) became due after India's 7 PM IST cutoff on 10-23, and Saturday is not a sending day. *Prediction:* the first follow-ups go out Sunday 10-25 from 8 AM IST.
- **Thread endpoint:** `GET /segments/{id}/outreach/thread/{personId}` → `{thread:[…]}`. Per message: `msg_type (sent|reply), subject, body_text, body_html, from_email, to_email, cc, message_id, in_reply_to, references, ts, intent, mailbox_id, from_display_name, wire_from_name, from_name_rotated, mailbox_status, rerouted_from, manual_reply, dkim_result, dkim_signed_by, dkim_checked_at, has_signed_eml, attachments, send_status, failure_reason`. Opening a thread also calls `inbox/contact?person=`, `inbox/lead/{personId}?why_fits=` (person + company card and a one-line "why it fits"), `segments/{id}/leads/{personId}/status`, `outreach/materials?project_id=` (attachments library, empty) and `outreach/auto-reply/{personId}` (not GET; probably POST to generate or schedule).
- **Mailbox vendors are visible in `mailbox_id`:** `icemail:v@gofreshanchor.com`, `inboxkit:v@clear-anchor.com`, `inboxkit:v@orbit-ignite.com`. Explee buys pre-warmed cold-email mailboxes from **Icemail** and **InboxKit** (both resell Google/Microsoft mailboxes for outreach). The local part is the sender's first initial (`v@`) on every domain, and the display name is the customer's sender name (`from_name_rotated: false`).
- **Replies are threaded on the original mailbox:** the reply to a hot lead went out from the same mailbox as the first email, with correct `In-Reply-To`/`References` and `Re:` subject. Inbound replies get a **DKIM check** (`dkim_result: pass`, signer recorded) and the signed .eml is stored (`has_signed_eml`). *Inferred:* this is evidence for disputes and spoof filtering.
- **Hot-lead case (Villa developers):** first email at 08:04 IST offered "a few short written ideas" on the lead's named project. The reply was a one-word "Ok" plus signature, 1 h 44 min later; the classifier marked it `hot_lead`, temperature hot, and set lead status Hot. The answer went out **26 h later** (10-23 12:08 IST) with `manual_reply: true`, CC to the owner's email (`reply_cc_emails`), and the UI line "Joined the conversation: <owner email>". It delivered three concrete positioning bullets built from the company description (acre size, amenities, local catchments) plus the Cal.com booking link. Because `total_auto_replies` is 0 and `manual_reply` is true, this was sent through the inbox composer, which pre-fills an AI suggestion (see 6f), not by the auto-reply job.
- **Email-changed case:** the first email went to a finance manager; an automatic "contact person changed" notice came back **2 seconds** later naming a successor and their email. Explee classified it `email_changed`, retired the old address, added the successor as a new contact, and sent them a **fresh first-touch email the next day from a different domain** with a new subject, no thread and no mention of the handoff. The successor was also in finance, not marketing, so the decision-maker filter didn't run on the new contact.
- **Classifier gaps:** a one-word "Ok" counts as hot, and an instant system notice counts as a human handoff. Neither is wrong for the outcome, but the confidence isn't shown anywhere.
- **Recipient addresses** are revealed (`email_revealed: true`) only on contacts that replied.

### 6f. Sending pool and reply mechanics (aggregated in-tab over all 360 sent contacts, plus the inbox JS bundle)

**Pool.** 105 distinct sender domains for 360 emails (most used 2-6 times, at most 3 per domain per day). Every mailbox is `v@<domain>` (the sender's first initial). TLDs: .com 261, .org 33, .co 23, .digital 20, .site 19, .ink 4. Names are random two-word brandables (`connectcyclecore.com`, `launchtidequartz.com`). 97 of the 105 domains sent for more than one campaign. All 360 `send_status: sent`; 2 bounces (Commercial Developers 1, Plotted developers 1).

**Timing.** 295 of 360 (82%) went out in the 08:00 IST hour and 31 more at 09:00. The queue drains in a burst when the India window opens, not spread through the day. About 30 sends fell outside 8 AM-7 PM IST; the 10-20 sends at 19:58-20:06 IST are among them. *Inferred:* the rest are leads whose country resolves to a different window (the schedule is per lead country). Not verified per lead.

**Reply UI → API (from the bundle):**

| Action | Call | Notes |
|---|---|---|
| Open a thread | `GET /segments/{id}/outreach/thread/{personId}` | response also carries `scheduled_auto_reply`, `reply_blocked_reason`, `draft_on_click`, `needs_intent_feedback`, `intent_feedback` |
| AI suggested reply | `POST /segments/{id}/outreach/auto-reply/{personId}` | fired automatically when a thread opens with no scheduled auto-reply (5 min cache); fills the composer. With `draft_on_click`, only on click |
| Send a reply | `POST /segments/{id}/outreach/send {person_id, body_text, material_ids?, cc_emails?}` | stored as `manual_reply: true`; subject is `Re: <last subject>`, sent from the thread's mailbox |
| Scheduled auto-reply: send now | `POST …/auto-reply/{id}/send-now` | skips the 24 h delay |
| Scheduled auto-reply: cancel | `DELETE …/auto-reply/{id}` | the cancelled body is moved into the composer for editing |
| Correct the classifier | `POST …/thread/{personId}/intent-feedback {label}` | `not_relevant` → lead status Unqualified |
| Other | `outreach/cc/validate {cc_emails}`, `outreach/materials` (file attachments, moderated), `replies/{id}/original.eml`, `sent/{id}/retry`, `save-followup-rules {rules}`, `projects/{id}/reply-preview {instructions, person_id}` (reply-copy tester), `notification-preferences`, `reply-recipients` | |

**So for the hot-lead case (6e):** `manual_reply: true` plus the auto-fetched suggestion means someone opened the thread, got Explee's AI draft pre-filled, and pressed Send (or edited and sent). The auto-reply job never fired, which fits `total_auto_replies: 0`.

**Debug endpoints shipped to the client:** the production bundle includes `/api/app-auto-gtm/_debug/sender/{lead-inject-reply, lead-advance-touch, lead-reset, lead-send, segment-drain}` (inject a fake reply with a chosen intent, force the next touch, drain a segment). *Inferred:* these are server-gated to staff, but their names and payloads are public. Not tested.

### 6g. Day 10: follow-ups, auto-replies, credit exhausted (checked 2026-10-29 ~12:50 IST)

**Totals (all time):** 750 emails to 539 people: 539 first touches + 211 follow-ups. 11 replies (5 hot, 5 not interested, 1 email changed), 7 bounced. Daily: 10-23 107, 10-24 (Sat) 0, 10-25 234, 10-26 132, 10-27 24, then 0.

**Credit ran out on 10-27.** Spend hit exactly $30.00; balance $0, `is_empty: true`. Every active campaign is now `status_reason: billing_pause` ("Sending stopped — unpaid balance. Top up your balance to resume."), state `listening` (still ingests replies). No card was charged: `credits-activity` holds only the $30 trial bonus. *Inferred:* no card on file, so auto-recharge had nothing to charge. Cost per hot lead: $30 / 5 = **$6**.

**Follow-ups** (in-tab aggregate over 60 of the 211 follow-up threads, no PII exported):
- Exactly 1 follow-up per lead so far (`max_touches: 2` means first + 1 follow-up). 1 thread had 3 sends, the email-changed case below.
- **Same mailbox, same thread every time:** 60/60 from the first email's mailbox, `Re: <first subject>`, `In-Reply-To` set.
- **Gap:** 3.0 days in 37/60, 4-6 days in the rest, the delay being pushed past non-sending days (Saturday) and the 7 PM cutoff.
- **Timing:** 51/60 in the 08:00 IST hour, the same morning burst as first touches. The first follow-ups went out Sunday 10-25 as predicted; that day sent 234 emails (~$9.36), almost the full $10 budget, because follow-ups and new first touches queued together.
- **Copy:** 35-59 words (median 47), plain text, no links. Pattern: "Quick follow-up on my last note." → **one new, specific fact** about the lead (plot size and RERA status with the buyer-city gap; website traffic growth of +165%) → a soft yes/no question ("Is that on your radar this quarter? A short no is fine too.") → full sender name. The follow-up uses a different research fact from the first email rather than repeating it.

**Auto-replies are now live.** `auto_reply_delay_minutes` is **240** (was 1440 on 10-23); *open question:* whether the user changed it. 2 hot replies got an auto-reply exactly **4.0 h** later (`manual_reply: false`):
- Lead asked for a phone call → auto-reply pushed a booking link instead ("Easiest way to get that call set up is to pick any slot"). It used **`cal.link/…`**, a short link, not the project's `cal.com` URL. *Inferred:* click tracking; not verified.
- Lead said "Pls do send" → a long auto-reply with 3 numbered ideas (ads, landing pages + CRM routing, …), built from the project description.
- 3 other hot replies were answered **manually** (5.1 h, 25.5 h, 26.3 h). One was a pricing answer ("priced per campaign … dated written quote … media spend paid directly to Meta and Google"), which suggests the owner wrote or edited it, since the facts KB is empty.
- `dashboard.total_auto_replies` still says 0 even though 2 auto-replies went out: a counter bug.
- `not_interested` replies get no answer and no further follow-ups (`stop_on_reply`).
- Email-changed: the new contact got a first touch 24 h later and a follow-up 3 days after that, the normal sequence restarted for the successor.

**Classifier:** "Ok", "Pls do send", "All matter. Do stare [state] the cost" and "Please call me" all → `hot_lead`. "We have an in-house agency" / "already doing it" / "No" → `not_interested`. No misclassifications seen in 11.

### 6h. Deliverability: how the rotating senders avoid spam (DNS + RDAP on 15 of the 105 domains, 2026-10-29)

| Measure | What we found |
|---|---|
| **Many domains, low volume each** | 105 domains for 750 emails; max 8 sends per domain over 10 days, ≤3 per domain per day. One mailbox per domain (`v@`). Follow-ups reuse the domain, so no new domains were needed. *Unknown:* how many other customers share each mailbox. |
| **Real mailbox providers, not a bulk SMTP** | 14/15 domains have MX `smtp.google.com` and SPF `include:_spf.google.com`, i.e. **Google Workspace** inboxes. 1 (`go-cascade.com`) runs on **Amazon SES** with its own inbound MX and `-all`. Inboxes are bought from cold-email mailbox resellers, visible in `mailbox_id`: **icemail**, **inboxkit**, **zapmail**. |
| **Full authentication** | Every sampled domain has SPF, a Google DKIM key (`google._domainkey`), and **DMARC at `p=reject` or `p=quarantine`, pct=100**, with rua/ruf reports to a mailbox on the same domain. Inbound replies are DKIM-checked too (6e). |
| **Aged / warmed domains** | Registered 2026-06-29 to 2026-09-24, so 1-4 months old before first use on 10-20. Registrars Spaceship, Dynadot, NameSilo (cheap, bulk-friendly); DNS on shared **ClouDNS** nameservers (`pns61/62`, `pns71/72`) or Cloudflare. Domain age plus provider warm-up is the main reputation lever. |
| **Brandable names, no website** | Random two-word names (`get-`, `join-`, `hello-`, `try-`, `use-`, `lets-` + word) across .com/.org/.co/.digital/.site/.ink. None serve a website (no A record, or a Cloudflare A that doesn't answer). *Gap:* a recipient who checks the domain finds nothing, which hurts trust and can hurt reputation with some filters. |
| **Spam-safe content** | Plain text only (`body_html: null` on sends): no HTML, no tracking pixel, **no links in first touches or follow-ups**. The only link appears after a positive reply. 35-100 words, no attachments. |
| **Human sending pattern** | Per-country business hours, Mon-Fri + Sun, ≤3/day per domain, replies threaded on the same mailbox, follow-ups stop on any reply. *Caveat:* the 08:00 burst (82% of sends in one hour) is not human-like. |
| **Bounce control** | 7 bounces in 750 (0.9%), consistent with addresses being verified before sending. |
| **Name consistency** | From display name = the customer's sender name on every send (`from_name_rotated: false`), signature matches. The **domain** never matches the brand in the signature ("QD & Co." from `@gethotgrove.com`). |

**What we can't see from outside:** List-Unsubscribe headers (sent .eml isn't exposed), per-mailbox daily caps across all customers, and the warm-up network itself.

**For Leadex:** copy the authentication setup (SPF + DKIM + DMARC reject), plain-text no-link first touches, per-domain caps, threaded follow-ups and inbound DKIM checks. Do differently: domains tied to the customer's brand (#17), a one-page site on every sending domain naming the real company, sends spread across the window instead of a burst at window open, and a List-Unsubscribe header on every send.

## 7. Sending infrastructure (partial)

- Pre-warmed mailboxes owned by Explee, rotated per send. The sender display name defaults to a persona per mailbox.
- Lookalike domains generated per customer (e.g. `getconsolto.io`, `meetconsolto.com`, `tryconsolto.dev`), checked for availability.
- "Own domains & mailboxes" page exists (bring your own domain, BYOD). Bundle endpoints: `/api/app-auto-gtm/outreach/{domains,mailboxes,byod/subscriptions}`, `/sending-identity`, `/reply-recipients`, `/spent-today`, `/billing/{balance,postpaid,usage-daily,credits-activity,linkedin-seats,vat}`.
- LinkedIn channel is behind an experiment flag: `/linkedin/access → {live:false, arm:"control", included_seats:0}`.

## 7a. Lead-finding agent internals (from `/api/agent-chat/sessions/{id}/events`)

One "Commercial Developers" campaign run: **27 min, 223 events, 69 tool calls**.

**Orchestration.** `agent.turn_queued {flow_run_id, work_queue_name: "agent-chat-interactive"}`. *Inferred:* agent turns run as **Prefect** flows on a work queue. The user's "Steer the campaign…" chat box sends messages into the same session. The automated kickoff message is `Run the full pipeline for campaign "<name>" end-to-end: research, competitors, find companies & people.`

**Plan.** `plan.set` → steps `research`, `competitors`, `find_people`, `outreach`, then `plan.step_update{step_id,status}`. Research and competitors are reused from the project cache ("Skipping research_company and find_competitors — both are already cached").

**Event kinds:** `session.started{company,segment}`, `plan.set`, `plan.step_update`, `agent.turn_queued/started`, `message.user{automated,text}`, `message.assistant.delta`, `subagent.started{name,label,step_id,default_artifact_type}`, `subagent.thinking{text}`, `subagent.tool_call{tool,tool_label,intent,input_summary,tool_use_id}`, `subagent.tool_result{elapsed_s,output_summary,output_sample,phases}`, `hook.progress{name,phase,done,total,criteria,sample}`, `usage{tokens_in,tokens_out,cache_read,cache_creation}`, `segment.updated`, `review.updated`. Paged by cursor: `GET …/events?since=<seq>` → `{events, next_since, has_more}`.

**Sub-agent `find_companies_people` tools (counts in this run):**

| Tool | Label | Count | What it does |
|---|---|---|---|
| `clickhouse_query` | SQL Query (ClickHouse + LAV) | 50 calls | Raw SQL against one denormalised table |
| `execute_python` | Run Python | 16 | pandas over `.parquet` files in a per-run workdir: merge angles, dedupe, regex-filter junior titles, value_counts |
| `ai_scoring` | AI Scoring | 7 | `parquet_path, mode=companies, criteria=[…3 natural-language criteria], out, limit` → scores rows with an LLM; 1,500 rows in ~17 s |
| `web_search` | Web Search | 1 | seed vocabulary (returned 0 results here) |

**People/company table** `employees_companies_wide`. Columns seen: `person_id, explee_id (company id), first_name, last_name, job_title (normalised), title (raw), headline, position_level ('CXO','Senior Management','Ownership','Strategic','Middle Management','Linear','Entry'), position_department, domain, geo_country, country_iso_2, size, industry, definition`.
Query pattern:
```sql
SELECT person_id, explee_id, first_name, last_name, job_title, title, headline,
       position_level, position_department, domain, geo_country, country_iso_2, size, industry
FROM employees_companies_wide
WHERE definition IN ('IT park developer')                -- semantic company category
  AND job_title IN ('Head of Sales', 'VP Sales', ...)     -- normalised title
  AND NOT (title ILIKE '%managing director%' OR ...)      -- raw-title exclusions
  AND geo_country = 'IN'
LIMIT 2 BY explee_id                                      -- max 2 people per company
LIMIT 8000
```
`definition` values used: office space / business park / commercial real estate / shopping mall / commercial property / retail real estate / IT park / commercial office building / mixed use real estate developer, and so on. The agent runs ~10 "angles" (one per definition), probes each with `LIMIT 100`, inspects the mix in Python, then pulls at scale. *Inferred:* "LAV" is a semantic expansion layer for `definition` and `job_title`. The agent's own notes say "semantic expansion means even the 300-row sample will be MD-dominated", so it adds raw-title `ILIKE` exclusions.

**Models.** Research-agent tool IDs are `toolu_*` (Anthropic). Sub-agent tool IDs are `chatcmpl-tool-*` (OpenAI-compatible server format, e.g. vLLM). *Inferred:* mixed providers, Claude for research and a cheaper OpenAI-compatible model for the long SQL loop. `usage` events report Anthropic-style `cache_read` / `cache_creation`, so prompt caching is used.

**Review gate.** `review.updated {max_rejects: 5, reject_count, auto_approve_timeout_s: 43200}`. Each campaign's lead list waits in **Review** ("Lead list ready — approve to start outreach") but **auto-approves after 12 hours** if the user does nothing.

**Rebuild runs after the pitch edit (2026-10-20, 5 campaigns, full session logs):**

| Campaign | Wall time | SQL | Python | AI scoring | Tokens in / out | Cache read |
|---|---|---|---|---|---|---|
| Commercial Developers | 49 min (log continues) | 62 | 57 | 11 | 266k / 120k | 10.6M |
| Prelaunch Teams | 51 min | 20 | 52 | 12 | 57k / 86k | 7.5M |
| Brokerage Firms | 46 min | 13 | 34 | 8 | 50k / 60k | 3.9M |
| Plotted developers | 53 min | 40 | 53 | 16 | 75k / 63k | 7.6M |
| Villa developers | 48 min (log continues) | 34 | 36 | 7 | partial | partial |

So each campaign costs **millions of cached prompt tokens** and nearly an hour of agent time before a single email is sent. All 5 rebuilt from scratch after a one-line description change. Extra tool: `save_artifact_file`, which saves a parquet as a named artifact (`artifact.created {artifact_id, type:"people", schema_name, count, sample, source_run_id}`); the latest artifact becomes the review list (`review.updated.artifact_id`). More event kinds: `phase.announcement`, `hook.started/finished`, `subagent.finished`, `agent.turn_ended`, `message.assistant`.

**Brief and dedupe behaviour (Brokerage Firms):** the agent writes its own QA criteria before any SQL ("1. company is a brokerage/consultancy, not a developer, rental agency or national franchise; 2. India; 3. senior decision maker; 4. small company"). Target volume is set to **20,000-30,000 people**. Germany, Austria and Switzerland are excluded by default. On import, people already in another campaign of the project (1,633) and companies without a website (2,200) are dropped. Result: 16,747 people at 11,816 firms; 77% of firms have 1-10 employees.

**Campaign control.** Stop is sent as a command into the agent session, `POST /api/agent-chat/sessions/{id}/input {kind:"command", command:"stop"}` → `{accepted:true}`. The campaign shows "Stopped … The launch was stopped before it finished. Hit Start to launch again" with a Resume button. *Observed:* editing the project description put campaigns that had reached Review back into `searching` (lists rebuilt).

## 7b. Console pages (signed in, project 51876)

| Page | What's there | APIs |
|---|---|---|
| Dashboard `/p/{id}` | setup progress banner with ETA ("~14 min left"); API key card; daily budget slider + balance ($30.00) + Top up; Performance (Sent, Delivered, Hot leads, Spent; 7d/All campaigns); Campaigns table (State, Sent, Reply rate, Hot leads, Cost/lead, Spent, Daily cap, Actions); "Stop campaigns and spending"; **Auto-manage campaigns** switch (on, "21% more hot leads than campaigns built by hand") | `projects/{id}/dashboard?period=7d` (rollup per campaign incl. `pool_used/pool_total/pool_pending`, `cost_per_lead_usd`, `manual_status_counts`, `cold_lost`), `projects/{id}/budget`, `projects/{id}/autopilot-activity` |
| Inbox / Sent | tabs Needs reply / Got reply; campaign filter; search; inline thread reply | `projects/{id}/inbox/contacts?tab&campaign&limit&offset`, `inbox/counts` |
| Project docs | editable company profile ("Update from qdnco.com"), competitors (add/remove), **Reply facts** (Essential: pricing, capabilities, proof) | `project-docs` |
| Email sequence | tabs First email / Follow-ups / Replies; sender name; per-campaign or project defaults; mode **Instructions** vs **My copy**; 3,000-char instruction box; chips "Ask for reply, not a call", "Keep it short", "Mention our offer", "No discounts", "Professional/Casual tone"; "Apply instructions" renders sample emails on the right; language = Lead's language | `segments/{id}/my-copy/check`, `projects/{id}/reply-preview-leads`, `reply-preview-case?person_id` |
| Sending schedule | per-country send windows in the lead's local time: India 8 AM–7 PM IST; UAE, Saudi, Oman, Qatar, Kuwait 8 AM–4 PM; others 8 AM–8 PM. Days Mon–Fri + Sun. "Smart sending days" respects local weekends | project `schedule` |
| Targeting | geography in free text ("English-speaking countries", "DACH", "EU + UK"); smallest company area is city; **people matched by country only**; company size in free text; "Save & re-search" | `segments/{id}/retarget-status` |
| Integrations | HubSpot (hot leads → contact + deal); Zapier via a "Copilot prompt"; Salesforce/Pipedrive "Soon"; **"Build it": copy a prompt for Claude/ChatGPT/Cursor with API key pre-filled**; public API `GET /public/api/v1/autogtm/hot-leads?since=…` with `X-API-Key` | `projects/{id}/integrations`, `organization/api-keys` |
| Own domains & mailboxes | "Explee network" (shared pool, default); **"Send from your own brand": $29/month per domain incl. 5 mailboxes**, $0.04/email unchanged, first emails ~2 weeks after order; flow: order → register → create mailboxes → warmup → first emails → full speed; FAQ incl. "Can I send from qdnco.com?" | `outreach/byod`, `byod/network`, `byod/summary`, `sending-identity → {pool:"shared", domains:[], from_names:[], byo_enabled:false}` |
| Campaign `/segments/{id}` | tabs Campaign / Leads / Progress; live agent transcript (each tool call shown with intent + SQL/Python preview); "Steer the campaign…" chat; offer, customer problem, example clients | `agent-chat/segments/{id}`, `agent-chat/sessions/active?segment_id`, `sessions/{id}/events?since`, `agent-chat/segments/{id}/review`, `segments/{id}/leads` |

**Lead statuses** (`lead-status-vocab`): Hot, Demo, Won, Lost, Unqualified (colour + order, so the vocabulary is configurable).

**Reply classifier** (`inbox/counts.available_filters`):

| key | Meaning and automatic action |
|---|---|
| `hot_lead` | live human reply that keeps the door open: interest, questions, scheduling, soft maybe |
| `out_of_office` | absence auto-reply; follow-ups deferred to the return date |
| `not_interested` | polite decline without "stop emailing"; address kept |
| `email_changed` | hands off to another personal email; new contact added, old retired |
| `recipient_gone` | person left, no handoff; address suppressed |
| `auto_acknowledgement` | auto-responder about response times; no action |
| `self_reply` | latest message is from your own team; no alerts |

## 8. Suppression

Workspace-wide list. People are matched by email, LinkedIn, or name + company, and companies by domain. CSV upload "any columns, any encoding". Mail already queued to a suppressed contact is cancelled.

---

## 9. Remaining console details (2026-10-29)

**Plans** (`/subscription`, `/pricing`): Classic `classic_4`, $0/month, $0.04/email, `max_followups: 2`, custom sender name, HubSpot, CSV export, white label, **no deep email search**, `entry_paywall: true`. Upsell **Growth: $99/month, $0.037/email, 3 follow-ups**. Budget tiers in the slider: Light ≤$15/day ("learning is slow at this pace"), Typical ≤$25, Growth ≤$50, Power. Marketing claims: "400M+ people profiles", "97% deliverability". Projection model: 21 sending days/month, reply rate 0.25-0.45%, meeting rate 0.06-0.24% per email. *Our run:* 1.5% reply rate, above their projection.

**Follow-up count is ambiguous:** the plan says `max_followups: 2`, but the project's `followup_rules.max_touches: 2` and every lead got exactly 1 follow-up before sending stopped. *Open:* whether a second follow-up was still due (sending stopped on 10-27 for billing), or whether `max_touches` counts the first email.

**Own domains (BYOD), from `outreach/byod` and the FAQ:**
- Package: 5 mailboxes, 125 emails/day, $29/month (`domain_price_usd_month: 4`, `mailbox_price_usd_month: 5`). Min 2 domains, max 100. For a $10/day budget (250 emails/day) it recommends 2 domains.
- **Warm-up 7 days, then a 14-day ramp from 10 to 25 emails per mailbox per day (+1/day).** "Our network sends the rest" while ramping. Order today → first emails Nov 6 (8 days).
- Domains are registered in the customer's name, `.com` only, can be transferred out after 60 days (mailboxes stop). DNS is locked while Explee runs the mail. **Each domain redirects to the customer's main website** (the shared-pool domains don't). They refuse to send from the main domain ("puts its reputation at risk… can take months to recover"), and you can't bring an existing domain. Claimed bounce rate <1%. "You as the sender" are responsible for content.
- Mailbox names are final once bought.
- Network stats: `byod/network` → last 14 days: 743 emails, 105 mailboxes, 105 domains, top mailbox 12 sends.

**Integrations:** HubSpot (not connected; `deal_mode: hot_and_warm`, pipeline/stage pickers, push counter). Webhooks: **one event only, `hot_lead.received`**, max 20 URLs (pitched for GoHighLevel, Make, n8n, Attio). Zapier: a copyable "Copilot prompt" that builds an hourly poll Zap (3 h lookback, find-or-create on email, Google Sheet fallback). "Custom / API": a copyable agent prompt for Claude/ChatGPT/Cursor with the API key and project id pre-filled, pointing at `llms.txt` + `openapi.json`. Salesforce and Pipedrive are "Soon". API key: one "Default" org key, never used.

**Notifications** (`notification-preferences`): daily_digest, autopilot_recap, leads_review, product_updates, founder_mail (all on). `reply-recipients`: per-user toggle for who receives reply alerts (owner only here).

**Suppress list** (`/app-auto-gtm/dedup`): org-wide, people (CSV, any format) + companies (domain list). Cancels mail already queued. Separate from search dedup lists.

**Referral:** give $25 / get $25 on the referee's first payment, $500/year cap; affiliate 20% of payments for 12 months.

**Email sequence page:** tabs First email / Follow-ups / Replies, one project default used by all 6 campaigns; mode Instructions or My copy (3,000 chars); language "Lead's language". Opening it fires `POST projects/{id}/reply-preview` (a sample AI reply for a real lead). Brief in the reply tab (`reply_instructions`) is empty for this project; replies were written from the project description alone.

## 10. Public API (`https://api.explee.com/public/api`, saved in `explee-api/`)

Explee publishes its full API: `llms.txt` (agent guide) and `openapi.json` (70 operations, 300 KB), with interactive docs at `/public/api/docs`. Auth `X-API-Key`; 10,000 req/h, 150 concurrent per org; 90 s timeout.

**Outreach API** (same features as the console): projects, campaigns (create from just a `name`: Explee drafts offer/problem/criteria/keywords), `PATCH` campaign definition (any search field re-aims the campaign and drops uncontacted leads; the new search starts 5 min after the last change and then needs re-approval), approve, start/stop, budgets (project, or per campaign only with Auto-manage OFF, else `409`), analytics, inbox list/thread/reply (≤3 replies per inbound message, attachments ≤25 MB, moderated), lead notes, hot-leads feed (`since` polling, `why_hot` verbatim), suppress lists, webhooks, billing/usage/activity, **import your own leads** (≤30,000 per import, each import a new campaign; mandatory email, first/last name, company_domain, job_title; free; still personalised per lead; no fixed-body sends), feedback.

**Campaign lifecycle** (from the guide): `discovery` → `review` (approve, or auto-approve after the 12 h review window with Auto-manage ON) → `outreach` → `listening` with `status_reason` `user_pause | budget_pause | lead_pool_exhausted | sending_completed | billing_pause`; `error`.

**Data API, the engine behind lead finding, sold separately:**

| Endpoint | Price (1 credit = $0.01) |
|---|---|
| `search/companies` (filters: `definition`, geo include/exclude down to city and subdivision, HQ/customer location, founded, size, revenue, `is_b2b/is_saas/is_startup/is_tech/is_ai/…`, employee geo distribution, plus AI `criteria`) | first 10 free; 0.5 credits/company + 0.1 per criterion |
| `search/people` (`job_titles` ± exclude, geo, followers, `people_per_company_limit`, `criteria` + company filters) | first 10 free; 1 credit/person + 0.1 per criterion |
| `search/nl-to-filters` (free text → structured filters) | free |
| `enrich/email` (basic: 1 provider ~50% hit; premium: 6 providers cross-validated ~78%) | charged only when found |
| `find-and-enrich` (search + emails, async, `max_contacts`) | search free; 1.5 credits (basic) / 5 credits (premium) per found email |
| `enrich/phone` by LinkedIn URL (~45-60% hit) | charged only when found |
| dedup lists (exclude owned companies/people from search) | free |

Free-request quotas per plan: free 50/day, starter 200, growth 500, pro 750, agency 1,500, enterprise 3,000.

**Implication for Leadex:** this is a cheap, documented lead-data vendor: about **$0.01 per person searched + $0.015-0.05 per verified email**, with natural-language-to-filters and company-category (`definition`) search already built. It could fill the "Lead data" row of the build plan instead of PDL, as a vendor behind a repository interface. Risks: dependence on a direct competitor, its terms of service, and data quality (6b).

## 11. Data sources (Explee's own public pages, 2026-10-29)

From `explee.com/b2b-database`, `/gm-dataset`, `/privacy-policy`, `/terms-of-use`:

- **Companies: 105M+ profiles "unified from 310M websites, LinkedIn data, Google Maps and government registries"**: 310M company websites, **74M LinkedIn company profiles**, **210M Google Maps places**, 100M+ registry records. 93 fields, "500+ datapoints per company"; descriptions written by "a deep-research AI agent analyzing at least 5 web pages"; keywords from the site's key pages; company size estimated "from professional networks, the company website, and other public data points". Low fill on many fields (annual revenue 2.4%, last round 0.2%, contact emails 29%). Full refresh every 4 weeks.
- **Google Maps dataset: 218M+ places in 244 countries** (India 28M+, US 17M+), 55 fields incl. phone, rating, reviews, hours, popular times. Collection method not stated (Google's terms forbid scraping, so either scraped or bought from a Maps-data vendor; *inferred*). Sold separately, "Request a demo".
- **People (536M / "400M+ profiles")**: no public source page. The fields (LinkedIn profile URL, LinkedIn-hosted photo, headline, follower count, tenure) point to LinkedIn-derived profiles (*inferred*).
- **Privacy policy:** "publicly available sources, including business directories and registries, corporate information, professional publications, and company websites" plus "data providers, such as professional contact details". No vendor named. Puts the legal basis for outreach on the customer. People can request deletion of their profile. Complaints go to the UK ICO, so the operating entity is UK-based (*inferred*).
- **Terms of use:** no clause against using the data or API to build a competing database or product, against reselling, or against caching. Accuracy not guaranteed. A separate DPA covers deletion on termination (not public).
- **Email finding:** "6 providers cross-validated" (API docs), not named.

**For Leadex:** Explee's company layer uses the same public sources we plan to use (websites, registries, Maps) plus LinkedIn. The people layer, the part we can't copy legally, is LinkedIn-derived. Their terms don't forbid building on their API, but the DPA wasn't reviewed; check it before relying on that.

## What Leadex does better (running list)

1. **Served-market-aware competitors and segments**: no Brazilian competitors for a Bangalore agency.
2. **Real senders only**: the sender name and signature must be a real person on the customer's team. No invented personas or names.
3. **Spend safety by default**: auto-recharge off, a monthly cap required at checkout, and the estimated monthly cost shown before any spend.
4. **Pay per verified lead**, not per email, so the customer can see what they're buying.
5. **CSV export on every plan**: Explee withholds it on Classic, and that lock-in annoys users.
6. **Quality gate before delivery**: domain/name consistency check plus a fit score. Explee's own agent flagged poor matches but still produced the list.
7. **Auto-reply off by default**, with human approval for the first replies.
8. **Grounded replies or no replies**: Explee asks for pricing, capabilities and proof facts in onboarding but auto-replies are on even when they're empty. Leadex will block auto-reply until the facts KB has pricing and at least one capability, and every claim in a reply must cite a KB fact.
10. **Fresh, cited product facts**: every claim the AI makes about the customer's product links to a crawled page and crawl date, and the user confirms the claims before drafts are generated (Explee pitched an outdated "15 creatives/month").
11. **Explicit review-and-launch screen, no silent auto-approve**: nothing spends or sends until the user has seen sender, facts, budget and first drafts on one page and pressed Launch. Explee auto-approves lead lists after 12 h of silence. Leadex sends a reminder instead and never approves on its own.
12. **Cheaper, faster lead search**: Explee's agent burns 27 min and ~70 tool calls per campaign, rediscovering the same `definition` vocabulary each time. Leadex keeps a learned map of segment to company categories and titles in ClickHouse and reuses it across customers in the same vertical.
14. **Lead-to-pitch fit check**: before a draft is generated, score whether the campaign's angle matches this lead's profile. If it doesn't, rewrite the angle or skip the lead, rather than pitching office buyers to a residential developer.
15. **Precision-sized pools**: build the best 500-1,000 leads for the budget first (ranked by fit score, Bangalore/target city first), not 20k country-wide records that will never be reached.
16. **Keep their good ideas**: content moderation before and after generation, per-sentence source highlights, and merge-field fill rates in the template editor are all worth building.
17. **Sender domain tied to the customer's brand**: Leadex sends from lookalike domains of the customer's own brand (e.g. `getqdnco.com`), registered in their name, never from a shared pool of unrelated brands. The From address, signature and company must match.
18. **Incremental re-targeting**: a description edit should only regenerate drafts. Explee rebuilt all 5 lead lists (about 50 min and millions of tokens each).
13. **City-level people targeting**: Explee matches people by country only. Leadex filters by company HQ city/region where data allows, which matters for local businesses like a Bangalore agency.
9. **Real sender on 100% of emails**: Explee keeps a mailbox persona name on ~10% of sends even after you set your own name.
19. **Warm handoffs, not cold restarts**: when a reply names a successor, Leadex writes to them in the same thread, or at least says "<name> suggested I contact you", and checks the new person against the decision-maker filter before sending.
20. **Hot-lead alert within minutes**: a positive reply pushes a notification to the owner right away, with a suggested answer ready to send. Explee's reply went out 26 h after a hot "Ok".

## Ops notes

- Explee shows "A new version is available. Refresh" mid-session, so they deploy to production often. Leadex should do the same: version check plus a soft refresh prompt.
- REA passive `inspect-web-page` aborts with `target_changed` when the page navigates. Use `capture-browser-scenario` in connect mode for multi-page flows.
