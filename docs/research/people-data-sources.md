# Public sources for people data (any industry, any country)

Goal: build Leadex's own people database (name, role, company, and later a work email) from sources we are allowed to use, instead of LinkedIn-derived data like Explee's. Researched 2026-10-29. Items marked *verify* were not confirmed against the official page in this pass.

## The honest picture first

- **Public sources are strong for owners, directors, founders and executives.** Company registries publish them by law, and they are the decision-makers for small and mid-size companies, which is most of Leadex's market.
- **Public sources are weak for mid-level roles** ("Head of Marketing" at a 500-person company). That data mostly lives on LinkedIn. For those we either read the company's own website or buy from a licensed vendor.
- **Emails are almost never published.** We generate them (name + company domain + common patterns) and verify them with a mail-server check that sends nothing. That part we can fully own.
- **Names of real people are personal data everywhere** (GDPR, UK GDPR, CCPA/CPRA, India DPDP). "Public" doesn't mean "free to use". See the legal section; get a lawyer's review before launch in the EU/UK.

## Sources by type

### 1. Company registries (officers and directors, published by law)

| Source | Coverage | Access | Notes |
|---|---|---|---|
| UK Companies House | all UK companies: directors, secretaries, persons with significant control | free REST API, one company per call, rate limited; no self-serve bulk officer file (bulk on request via Companies House) | staff say the API is "not to crawl all companies"; companies bulk file is free, officers need a request |
| India MCA (Ministry of Corporate Affairs) | every Indian company/LLP: directors with DIN | portal one record at a time, **no official bulk API**; company master data on data.gov.in; paid resellers (Instafinancials etc.) | scraping the portal may break its terms; use a licensed reseller or data.gov.in |
| US SEC EDGAR | US public companies: officers, directors, insiders (Form 3/4/5, DEF 14A proxies) | free, no key (`data.sec.gov`), raw XML/JSON | only listed companies, but includes large private-fund filers |
| US state business registries (50 states) | officers/registered agents for LLCs and corporations | varies by state: some bulk files, many search-only | patchy; officers often missing for LLCs (*verify per state*) |
| EU national registries (via BRIS / each country) | directors, varying by country | mostly per-country, many paid | GDPR applies in full; several countries restrict reuse of officer names (*verify per country*) |
| OpenCorporates (aggregator, 140+ jurisdictions) | companies + officers worldwide | API £2,250/yr (500 calls/mo) to £12,000/yr; bulk is enterprise only | one licence instead of 100 registries; free only for journalists/NGOs/research |
| GLEIF (LEI) | legal entities + parent companies, worldwide | free, open licence | **no people**, but good for company identity and corporate trees |

### 2. Licensed professional registries (people by profession)

| Source | Who | Access |
|---|---|---|
| US NPPES (NPI) | ~8M US healthcare providers and organisations, with practice address | **free** monthly full file + weekly updates, free query API |
| US state licence boards | real estate agents/brokers, contractors, accountants, lawyers, insurance agents (per state) | many publish downloadable lists; some forbid commercial use (*verify per state and board*) |
| FINRA BrokerCheck / SEC IAPD | US brokers and investment advisers | public search; bulk for advisers via SEC (*verify*) |
| India RERA (per state) | registered real-estate promoters and agents | state portals, search-only in most (*verify per state*) |

These are excellent when a Leadex customer sells to one profession (clinics, brokers, contractors).

### 3. The company's own website (we already crawl it, PR #19)

- **Team / About / Leadership / Contact pages:** names + titles of founders, executives, often department heads. This is the best public source for mid-level roles.
- **schema.org `Person` / `Organization` markup:** many sites tag their staff in structured data. Web Data Commons extracts this from Common Crawl every year (3.1B entities in the latest release), so we can find candidates without crawling everything ourselves.
- **Press releases, blog author pages, case studies:** "said Jane Doe, VP Sales at Acme".
- **Job postings:** name the team and sometimes the hiring manager; also a strong buying signal.

Common Crawl: commercial use appears allowed, but no republishing or reselling access, and the crawled sites' own terms still apply. Read the current terms before relying on it.

### 4. Other public signals (role-specific)

- **GitHub** (public profiles + org membership): developers, CTOs at tech companies. API terms limit use for spam; use only for targeting, never for scraped emails (*verify terms*).
- **Conference speaker lists, podcast guests, award lists:** small but high-quality, senior people.
- **Patents (USPTO PatentsView, EPO):** inventors with employer: R&D and engineering leaders (*verify*).
- **Government contracts (SAM.gov, GeM in India):** suppliers with points of contact (*verify*).

### 5. Avoid as a primary source

- **LinkedIn scraping:** against LinkedIn's terms, actively litigated, and the main legal risk in this whole space.
- **Google Maps scraping:** against Google's terms. The Places API may not be stored beyond short caching. Fine for live lookups, not for building our own database.
- **Buying "scraped" lists with no provenance:** no lawful-basis paper trail.

## Emails: build our own finder

1. Collect known addresses per domain from public pages (contact pages, press pages) to learn the company's pattern (`first.last@`, `f.last@`, `first@`).
2. Generate candidates for each person.
3. Verify: MX lookup → SMTP `RCPT TO` check without sending → catch-all detection. Mark catch-all domains "unverifiable", never "valid".
4. Cache results per domain (patterns are reused across people).
5. Fall back to a paid finder only for high-value leads, and store what the licence allows.

Expected: lower hit rate than 6-provider waterfalls at first (Explee claims ~78% premium), improving as our pattern cache grows.

## Legal guardrails (to design in from day one)

- **EU/UK (GDPR):** B2B cold email usually relies on *legitimate interest* with a documented balancing test; the pitch must be relevant to the person's role; clear sender identity and a working opt-out; **Article 14** requires telling people where we got their data, within a month (usually satisfied in the first email + privacy notice). Spec decision so far: no EU/UK records in v1.
- **US:** CAN-SPAM (identification, physical address, opt-out); California CPRA no longer exempts B2B data since 2023, so honour access and deletion requests.
- **India (DPDP Act 2023 + Rules notified 13 Nov 2025):** the Act excludes personal data made public **by the person themselves or by someone legally required to publish it** (s. 3(c)(ii)). Registry data (MCA directors, RERA) arguably fits the second limb; team-page data fits only if the person published it. Get this confirmed by an Indian lawyer.
- **Everywhere:** keep provenance per field (source URL/registry, date). That's our evidence of lawful sourcing and lets us honour deletion requests across the whole database.

## Recommended build order for Leadex

1. **Company graph:** registries (Companies House, SEC, MCA via data.gov.in, OpenCorporates for the rest) + GLEIF + our website crawl → companies with domain, size, industry, location.
2. **Decision-makers from registries:** directors/officers linked to those companies. Covers owner-led SMBs in UK, US-listed, India on day one.
3. **Website people extraction:** team pages + schema.org + press releases → mid-level roles, with an LLM extracting name/title/department from each page.
4. **Email finder + verifier:** our own, with a per-domain pattern cache.
5. **Vertical registries on demand:** NPI, state licence boards and RERA when a customer targets that profession.
6. **Licensed vendor only for gaps:** behind the same repository interface, storing only what its licence allows.

## Sources

- [Companies House forum: bulk officer data](https://forum.companieshouse.gov.uk/t/can-we-bulk-download-officer-director-data/1225)
- [Companies House forum: best way to get officers data](https://forum.companieshouse.gov.uk/t/best-way-to-get-officers-data-2/7994)
- [OpenCorporates pricing](https://opencorporates.com/pricing/)
- [Reading India's MCA registry via data.gov.in](https://dev.to/openregistry/reading-indias-mca-registry-via-datagovin-field-quirks-5929)
- [Apify MCA director scraper (notes no official bulk API)](https://apify.com/factden/mca-company-director-scraper)
- [Instafinancials PAN-DIN bulk lookup](https://www.instafinancials.com/insta-tools/PAN-DIN.html)
- [CorpIntel FAQ](https://corpintel.io/faq)
- [SEC Form 4 via EDGAR (developer write-up)](https://dev.to/linderrogereng/track-insider-trading-in-real-time-with-this-free-sec-edgar-api-4bca)
- [CMS NPPES data dissemination](https://www.cms.gov/medicare/regulations-guidance/administrative-simplification/data-dissemination)
- [Federal Register: NPPES downloadable file, no charge](https://www.govinfo.gov/content/pkg/FR-2024-03-04/html/2024-04517.htm)
- [NPI registry API guide](https://dev.to/avabuildsdata/how-to-search-the-npi-registry-for-healthcare-providers-without-the-terrible-nppes-website-24if)
- [Web Data Commons schema.org data set series](https://madoc.bib.uni-mannheim.de/64408)
- [Common Crawl FAQ](https://commoncrawl.org/faq)
- [FullContact: GDPR and B2B lead identification](https://www.fullcontact.com/knowledgebase/how-does-gdpr-affect-b2b-lead-identification/)
- [GDPR Article 14 and scraped B2B lists](https://dev.to/vhub_systems_ed5641f65d59/gdpr-article-14-the-data-rule-that-applies-to-web-scraping-and-b2b-lead-lists-43bj)
- [iubenda: GDPR for B2B](https://www.iubenda.com/en/help/22784-how-does-gdpr-affect-b2b)
- [BounceZero: email GDPR guide 2026](https://bouncezero.io/email-gdpr-compliance-guide-2026)
- [India Briefing: DPDP and publicly available data](https://www.india-briefing.com/news/india-dpdp-act-publicly-available-personal-data-46899.html/)
- [Tsaaro: exemptions under DPDP Act and Rules 2025](https://tsaaro.com/blogs/regulatory-carve-outs-examining-exemptions-under-the-dpdp-act-2023-and-dpdp-rules-2025)
- [NALSAR Tech Law Forum: critique of s. 3(c)(ii)](https://techlawforum.nalsar.ac.in/?p=2655)
