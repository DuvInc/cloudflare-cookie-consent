-- 0002: what was shown, a path for the purge, and room for longer references.
--
-- Additive only: the 0001 engine keeps working against this schema, so this
-- migration can be applied BEFORE any site runs the new engine, and must be.
-- The new engine writes `policy_hash`; against a database without this column
-- its INSERT fails and the proof row is lost (the visitor is not affected).

-- The content of each banner version, once per version (see src/policy.ts).
-- `hash` is a short SHA-256 of `content`, so a changed sentence under the same
-- `policy_version` is a different row. Never purged: it is the site's own
-- text, not personal data, a few kilobytes per version.
CREATE TABLE consent_policy (
  site           TEXT NOT NULL,
  hash           TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  at             INTEGER NOT NULL,
  content        TEXT NOT NULL,
  PRIMARY KEY (site, hash)
) WITHOUT ROWID;

-- Which snapshot a decision was made under. NULL on every row written before
-- this migration: those rows still carry `policy_version`.
ALTER TABLE consent_log ADD COLUMN policy_hash TEXT;

-- The purge deletes by date across every site ("rows older than 12 months"),
-- which the (site, at) index cannot serve. One more index write per decision,
-- a few hundred a day.
CREATE INDEX consent_log_at ON consent_log (at);

-- `id` was 8 hex characters; new decisions write 16. The column is TEXT and the
-- cookie format never fixed a length, so existing rows and cookies stay valid.
