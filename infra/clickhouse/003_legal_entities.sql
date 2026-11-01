-- GLEIF legal entities (#22 part 3): official legal names and countries from the LEI golden copy (CC0),
-- used to confirm a profiled company's legal name. EU/EEA/UK-only entities are not imported.

CREATE TABLE IF NOT EXISTS legal_entities (
  lei String,
  legal_name String,
  legal_country LowCardinality(String),
  legal_city String,
  hq_country LowCardinality(String),
  hq_city String,
  jurisdiction LowCardinality(String),
  category LowCardinality(String),          -- GENERAL | FUND | BRANCH | SOLE_PROPRIETOR | ...
  legal_form LowCardinality(String),        -- ISO 20275 ELF code
  entity_status LowCardinality(String),     -- ACTIVE | INACTIVE
  registration_status LowCardinality(String), -- ISSUED | LAPSED | RETIRED | ...
  publish_date DateTime('UTC')              -- golden copy the row came from
) ENGINE = ReplacingMergeTree(publish_date) ORDER BY lei;

-- One row per (normalized name, LEI) for the legal name and every other/transliterated name, ordered for lookups by name.
CREATE TABLE IF NOT EXISTS legal_entity_names (
  name_key String,
  lei String,
  legal_country LowCardinality(String),
  hq_country LowCardinality(String),
  entity_status LowCardinality(String),
  registration_status LowCardinality(String),
  publish_date DateTime('UTC')
) ENGINE = ReplacingMergeTree(publish_date) ORDER BY (name_key, lei);

-- Which golden copy files were imported, so each one is applied once.
CREATE TABLE IF NOT EXISTS gleif_imports (
  kind LowCardinality(String),              -- full | delta
  publish_date DateTime('UTC'),
  records UInt32,
  imported_at DateTime('UTC')
) ENGINE = ReplacingMergeTree(imported_at) ORDER BY (kind, publish_date);
