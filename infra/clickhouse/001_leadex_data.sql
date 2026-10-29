-- Leadex Data: our own lead database (spec: "Leadex Data: our own lead database").
-- Applied by backend/tools/clickhouse-migrate.ts. Statements are idempotent.
-- ReplacingMergeTree keeps the row with the latest version column; reads use FINAL.

CREATE TABLE IF NOT EXISTS companies (
  company_id String,            -- sha256(normalized domain)
  domain String,
  name String,
  legal_name String,
  lei String,
  description String,
  industry LowCardinality(String),
  keywords Array(String),
  employee_band LowCardinality(String),
  country LowCardinality(String),
  region String,
  city String,
  technologies Array(String),
  served_markets Array(String),
  updated_at DateTime('UTC')
) ENGINE = ReplacingMergeTree(updated_at) ORDER BY domain;

CREATE TABLE IF NOT EXISTS people (
  person_key String,            -- sha256(lower(first)|lower(last)|domain)
  domain String,
  first_name String,
  last_name String,
  title String,
  seniority LowCardinality(String),
  department LowCardinality(String),
  country LowCardinality(String),
  is_officer UInt8,
  updated_at DateTime('UTC')
) ENGINE = ReplacingMergeTree(updated_at) ORDER BY (domain, person_key);

-- Provenance for every company/person field: where it came from and when.
CREATE TABLE IF NOT EXISTS facts (
  entity_type LowCardinality(String),   -- company | person
  entity_id String,                     -- company_id or person_key
  field LowCardinality(String),
  value String,
  source LowCardinality(String),
  source_url String,
  method LowCardinality(String),        -- registry | structured_data | page_extract | vendor
  licence_scope LowCardinality(String), -- owned | open_data | public_record | vendor_licensed
  retrieved_at DateTime('UTC')
) ENGINE = MergeTree ORDER BY (entity_type, entity_id, field, retrieved_at);

-- Learned email formats per company domain (filled by the email finder, #24).
CREATE TABLE IF NOT EXISTS domain_patterns (
  domain String,
  pattern LowCardinality(String),       -- first.last | flast | first | ...
  evidence_count UInt32,
  mx_host String,
  accepts_all UInt8,
  checked_at DateTime('UTC')
) ENGINE = ReplacingMergeTree(checked_at) ORDER BY domain;

CREATE TABLE IF NOT EXISTS emails (
  person_key String,
  email String,
  pattern LowCardinality(String),
  status LowCardinality(String),        -- valid | invalid | catch_all | unknown
  checked_by LowCardinality(String),
  checked_at DateTime('UTC')
) ENGINE = ReplacingMergeTree(checked_at) ORDER BY person_key;

-- Do-not-contact and removal requests. Only hashes are stored, never the raw value.
CREATE TABLE IF NOT EXISTS suppression (
  kind LowCardinality(String),          -- person | email | domain
  value_hash String,
  reason LowCardinality(String),
  created_at DateTime('UTC')
) ENGINE = ReplacingMergeTree(created_at) ORDER BY (kind, value_hash);
