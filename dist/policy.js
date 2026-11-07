/**
 * What a visitor was shown, as data.
 *
 * A proof row says "this reference chose these categories on this date, under
 * policy version 2". The version is a number: it says nothing about what the
 * banner read or which third parties were held back. EDPB Guidelines 05/2020
 * (par. 108) want the controller able to show "the information provided to the
 * data subject at the time", and say it is not enough to point at "a correct
 * configuration of the website". So the content of each version is stored too.
 *
 * Stored ONCE per version, never per decision: a row in `consent_policy`
 * keyed by site and by a hash of this snapshot, and `consent_log.policy_hash`
 * points at it. Changing a sentence without bumping `policyVersion` produces a
 * new hash and a new snapshot, so the log still says which text was on screen.
 */

import { resolveCopy } from './config.js';
                                                                            

const ORDER               = ['essential', 'analytics', 'marketing'];

/** The snapshot of one site's declarations. Key order is fixed, so the same config always hashes the same. */
export function policySnapshot(config               )                 {
  const locales = [...new Set(['en', ...Object.keys(config.copy ?? {})])].sort();
  const copy                         = {};
  for (const locale of locales) copy[locale] = resolveCopy(locale, config.copy);
  const categories = ORDER.filter((id) => id in copy.en .categories);
  return {
    site: config.site,
    policyVersion: config.policyVersion ?? 1,
    rejectStyle: config.rejectStyle ?? 'button',
    categories,
    vendors: (config.vendors ?? []).map((v) => ({ match: v.match, category: v.category })),
    cookies: Object.fromEntries(Object.entries(config.cookies ?? {}).map(([k, v]) => [k, [...v]])),
    copy,
  };
}

/** 16 hex characters of SHA-256 over the snapshot's JSON. Enough to tell versions of one site apart. */
export async function policyHash(json        )                  {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}
