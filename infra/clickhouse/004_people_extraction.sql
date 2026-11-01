-- People from company websites (#23 part 1).

-- What the people extractor did with each profiled company.
CREATE TABLE IF NOT EXISTS people_extraction_status (
  domain String,
  status LowCardinality(String),        -- done | skipped | failed
  reason LowCardinality(String),        -- e.g. no_people_pages, unreachable, llm_failed
  people_found UInt16,
  attempts UInt16,
  checked_at DateTime('UTC')
) ENGINE = ReplacingMergeTree(checked_at) ORDER BY domain;

-- Email addresses a company publishes on its own pages: evidence for its address pattern (#24) and the
-- general mailbox used when no person is named. Never guessed: every row has the page it was found on.
CREATE TABLE IF NOT EXISTS published_emails (
  domain String,
  email String,
  kind LowCardinality(String),          -- personal | general
  person_key String,                    -- the named person the address belongs to, or '' when not tied to one
  source_url String,
  seen_at DateTime('UTC')
) ENGINE = ReplacingMergeTree(seen_at) ORDER BY (domain, email);
