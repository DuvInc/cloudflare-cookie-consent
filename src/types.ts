/**
 * The shapes this package exchanges with your Worker.
 *
 * Declared here, structurally, instead of pulling `@cloudflare/workers-types`
 * in: a package with zero dependencies cannot ask its users to install a
 * type package, and a structural interface is satisfied by the real
 * `D1Database` and `HTMLRewriter` without any cast.
 */

/** `essential` is never blocked. The other two are what a visitor can refuse. */
export type CategoryId = 'essential' | 'analytics' | 'marketing';

/** One decision, as stored in the `__consent` cookie. */
export type Consent = {
  version: number;
  granted: CategoryId[];
  /** Short random reference, shown to the visitor and written to the proof log. */
  id: string;
  /** Unix seconds. */
  at: number;
};

/** A third party recognised by the URL it loads, whether or not its tag is marked. */
export type Vendor = { match: string; category: CategoryId };

export type CategoryCopy = { label: string; note: string };

/**
 * Everything a visitor reads. Values are inserted as HTML, so a link in `body`
 * works, and so does a mistake: this comes from your config, never from a
 * visitor.
 *
 * A category missing from `categories` is not offered, and "Accept all" does
 * not grant it. That is how a site with no marketing tracker hides it.
 */
export type Copy = {
  title: string;
  body: string;
  reject: string;
  accept: string;
  customise: string;
  save: string;
  recordedOn: string;
  reference: string;
  nothingRecorded: string;
  categories: Partial<Record<CategoryId, CategoryCopy>>;
};

/**
 * Colours and shape. Any CSS value works, including `var(--your-token)`: with
 * tokens that already switch in dark mode, leave the `dark*` keys out and the
 * banner follows the site for free.
 */
export type Theme = {
  accent: string;
  accentText: string;
  radius: string;
  font: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  /* Dark mode is the same tokens again. A site that does not define them never
   * changes in dark mode, which is a legitimate choice and not a bug. */
  darkSurface?: string;
  darkText?: string;
  darkMuted?: string;
  darkBorder?: string;
  darkAccent?: string;
  darkAccentText?: string;
};

export type ConsentConfig = {
  /** This site's key in the proof log (`consent_log.site`). One database can serve several sites. */
  site: string;
  /**
   * Bump it when a vendor is added or a purpose changes: every stored choice
   * with another version is treated as "no choice" and the banner asks again.
   * Default 1.
   */
  policyVersion?: number;
  /** Third parties recognised by the URL they load. A belt: the `data-consent` attribute is the way. */
  vendors?: Vendor[];
  /**
   * What to erase when a category is not granted: exact cookie names, plus
   * `localStorage` keys by prefix. First-party only.
   *
   * Any key works, so a category that is never offered, conventionally
   * `retired`, is swept on every page: that is how the leftovers of a tool you
   * removed disappear from returning visitors.
   */
  cookies?: Record<string, string[]>;
  /**
   * Banner text per language (the two-letter code from `<html lang>`). `en` is
   * the fallback and is merged over the built-in English text, so you only
   * write what differs. `COPY_FR` is exported as an example.
   */
  copy?: Record<string, Partial<Copy>>;
  /** Merged over the built-in light theme. Leave `dark*` out for no dark mode. */
  theme?: Partial<Theme>;
  /**
   * `.example.com`: share one choice across the subdomains of a product. Only
   * applied on a request that really is on that domain; `localhost` and
   * `*.workers.dev` keep a host-only cookie, because a browser silently drops a
   * Domain it does not belong to.
   */
  cookieDomain?: string;
  /**
   * `button` (default): Accept and Decline are the same size, side by side.
   * `link`: Accept is one large button and Decline a text link. Regulators
   * (CNIL, EDPB) expect refusing to be as easy as accepting, so choose `link`
   * knowingly.
   */
  rejectStyle?: 'button' | 'link';
  /** Where `clearConsent` sends the visitor. Default `/cookie-information#cookie-preferences`. */
  preferencesPath?: string;
  /**
   * Emit Google Consent Mode v2 defaults at the top of `<head>`, rendered from
   * the cookie so a returning visitor is `granted` on the first frame. Default
   * false: without it, no `dataLayer` is created.
   */
  googleConsentMode?: boolean;
};

/** The Worker bindings the engine reads. All are optional. */
export type ConsentEnv = {
  /** D1 database holding `consent_log`. Without it, decisions are still honoured and just not logged. */
  DB?: D1Like;
  /** Secret salt for the User-Agent fingerprint in the proof log. Falls back to `site`. */
  PROOF_SALT?: string;
  /**
   * A Workers Rate Limiting binding (wrangler `ratelimits`) that caps the proof rows one address can
   * write. Optional: without it an in-isolate counter (30 writes a minute per address) stands in. Over
   * the limit the visitor still gets the cookie and a 200, only the proof row is skipped and logged.
   */
  CONSENT_LIMITER?: RateLimiterLike;
};

/** The sliver of a Workers Rate Limiting binding used here. */
export interface RateLimiterLike {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** The sliver of D1 used here. The real `D1Database` satisfies it. */
export interface D1Like {
  prepare(query: string): { bind(...values: unknown[]): { run(): Promise<unknown> } };
}

/* The sliver of HTMLRewriter used here. Injectable so tests can run in Node. */
export interface RewriterElement {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  prepend(content: string, options?: { html?: boolean }): void;
  setInnerContent(content: string, options?: { html?: boolean }): void;
  onEndTag(handler: (end: { before(content: string, options?: { html?: boolean }): void }) => void): void;
}

export interface RewriterLike {
  on(selector: string, handlers: { element?(element: RewriterElement): void }): RewriterLike;
  onDocument(handlers: { end?(end: { append(content: string, options?: { html?: boolean }): void }): void }): RewriterLike;
  transform(response: Response): Response;
}

export type RewriterConstructor = new () => RewriterLike;

export type CreateConsentDeps = {
  /** Defaults to the Workers global. Tests pass a stand-in. */
  HTMLRewriter?: RewriterConstructor;
};
