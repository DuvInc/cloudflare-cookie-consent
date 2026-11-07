/**
 * The retention of the proof log, as one function.
 *
 * One database serves every site, so one scheduled Worker purges it, not one
 * purge per site. The engine only exports the function and the number; the
 * cron and the binding live in the one Worker that owns the database.
 *
 * Purged by date and by nothing else. A visitor who changes their mind leaves
 * their earlier row alone: it proves the processing of the earlier period was
 * covered, and the reference changes with every decision while the fingerprint
 * is a hash of the User-Agent, so two rows cannot be tied to one person anyway
 * (and tying them would take more data than the log is meant to hold).
 *
 * See the `cookie-consent` skill for the sources behind the number.
 */

import type { D1Like } from './types.ts';

/**
 * 12 months after the decision: the choice itself is valid for six months (the
 * cookie's Max-Age, CNIL recommendation 2020-092 par. 39), plus six months to
 * defend a claim. A decision of the owner, not a rule of the texts: neither the
 * CNIL nor the EDPB gives a number. Not legal advice.
 */
export const RETENTION_DAYS = 365;

/** Below the validity of a choice, a purge would erase decisions still in force. */
export const MIN_RETENTION_DAYS = 190;

export type PurgeOptions = {
  retentionDays?: number;
  /** Milliseconds since the epoch. Injectable for tests. */
  now?: number;
  /** Rows deleted per statement. */
  batch?: number;
  /** A safety stop: a run never loops forever. */
  maxBatches?: number;
};

export type PurgeResult = {
  /** Unix seconds: rows with `at` before this were candidates. */
  cutoff: number;
  deleted: number;
  statements: number;
  rowsRead: number;
  rowsWritten: number;
};

export async function purgeConsentLog(db: D1Like, options: PurgeOptions = {}): Promise<PurgeResult> {
  const retentionDays = options.retentionDays ?? RETENTION_DAYS;
  if (!(retentionDays >= MIN_RETENTION_DAYS)) {
    throw new Error(`purgeConsentLog: retentionDays must be at least ${MIN_RETENTION_DAYS}, got ${retentionDays}.`);
  }
  const batch = options.batch ?? 1000;
  const cutoff = Math.floor((options.now ?? Date.now()) / 1000) - retentionDays * 86_400;
  const out: PurgeResult = { cutoff, deleted: 0, statements: 0, rowsRead: 0, rowsWritten: 0 };

  for (let i = 0; i < (options.maxBatches ?? 100); i++) {
    /* The index on `at` (migration 0002) finds the rows; the subquery keeps each
     * statement bounded without relying on DELETE ... LIMIT, which D1 does not
     * guarantee. */
    const result = await db
      .prepare('DELETE FROM consent_log WHERE id IN (SELECT id FROM consent_log WHERE at < ? LIMIT ?)')
      .bind(cutoff, batch)
      .run();
    const meta = (result && 'meta' in result ? result.meta : undefined) ?? {};
    out.statements++;
    out.deleted += meta.changes ?? 0;
    out.rowsRead += meta.rows_read ?? 0;
    out.rowsWritten += meta.rows_written ?? 0;
    if ((meta.changes ?? 0) < batch) break;
  }
  return out;
}
