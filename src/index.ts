export { createConsent, pageRequest } from './service.ts';
export { COPY_EN, COPY_FR, DEFAULT_THEME } from './config.ts';
export { COOKIE, newReference, parseConsent, readConsent, serializeConsent, isGranted } from './cookie.ts';
export { policyHash, policySnapshot } from './policy.ts';
export { MIN_RETENTION_DAYS, RETENTION_DAYS, purgeConsentLog } from './purge.ts';
export type { PurgeOptions, PurgeResult } from './purge.ts';
export { withConsent } from './rewrite.ts';
export { bannerHtml } from './ui.ts';
export { clientAddress, rateLimitAddress } from './client-address.ts';
export { RUNTIME } from './runtime.ts';
export type {
  CategoryId,
  Consent,
  ConsentConfig,
  ConsentEnv,
  Copy,
  CreateConsentDeps,
  D1Like,
  D1Meta,
  PolicySnapshot,
  RateLimiterLike,
  Theme,
  Vendor,
} from './types.ts';
