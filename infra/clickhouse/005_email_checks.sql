-- Every address verification (#24): never re-pay for an address known to be invalid, and an exact record of verifier spend.
CREATE TABLE IF NOT EXISTS email_checks (
  person_key String,
  domain String,
  email String,
  status LowCardinality(String),        -- valid | invalid | catch_all | unknown
  reason String,                        -- verifier's own reason
  checked_by LowCardinality(String),    -- verifier name
  checked_at DateTime('UTC')
) ENGINE = MergeTree ORDER BY (domain, email, checked_at);
