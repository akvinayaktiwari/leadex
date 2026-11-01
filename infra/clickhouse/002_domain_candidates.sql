-- Company discovery from open data (#22): the ranked domain universe and per-domain processing status.

-- Domains from the Common Crawl domain-level web graph, best-linked first. Not company records:
-- a domain becomes a company only after the profiler crawls it (with facts) through the Leadex Data service.
CREATE TABLE IF NOT EXISTS domain_candidates (
  domain String,
  tld LowCardinality(String),
  harmonic_rank UInt32,                 -- 1 = best linked in the release
  harmonic_value Float64,
  pagerank_rank UInt32,
  hosts UInt32,                         -- number of hosts under the domain in the graph
  release LowCardinality(String),       -- e.g. cc-main-2026-apr-may-jun
  imported_at DateTime('UTC')
) ENGINE = ReplacingMergeTree(imported_at) ORDER BY domain;

-- What the profiler did with each domain (filled by #22 part 2).
CREATE TABLE IF NOT EXISTS domain_crawl_status (
  domain String,
  status LowCardinality(String),        -- profiled | skipped | failed
  reason LowCardinality(String),        -- e.g. blocked_country, unknown_country, unreachable, robots
  attempts UInt16,
  checked_at DateTime('UTC')
) ENGINE = ReplacingMergeTree(checked_at) ORDER BY domain;
