-- Proof of consent: one row per DECISION, never per page view. A visitor who
-- comes back ten times writes nothing.
--
-- One database can serve every site you run. The shape of the data is the same
-- everywhere (a choice, a date, some categories), D1 bills rows read and
-- written and not databases, and a database per site only multiplies the ids to
-- keep, the migrations to apply and the things to forget. `site` carries the
-- distinction: an audit of one site is a WHERE, and an audit across several
-- stays possible.
--
-- `client` is a truncated, salted hash of the User-Agent. No IP is stored:
-- keeping an IP in order to prove a consent is itself a processing you would
-- then have to justify. It proves a decision was made from a browser; it does
-- not count visitors, because several people on the same browser share one.
--
-- Applied with a migration and NOT by a `CREATE TABLE IF NOT EXISTS` in the
-- handler: that form does nothing when the table already exists with other
-- columns, so a schema change goes unnoticed until the first INSERT fails.
CREATE TABLE consent_log (
  id             TEXT PRIMARY KEY,
  site           TEXT NOT NULL,
  at             INTEGER NOT NULL,
  policy_version INTEGER NOT NULL,
  granted        TEXT NOT NULL,
  country        TEXT NOT NULL,
  client         TEXT NOT NULL,
  locale         TEXT NOT NULL
);

-- The audit access path: "this site's decisions, over this period".
CREATE INDEX consent_log_site_at ON consent_log (site, at DESC);
