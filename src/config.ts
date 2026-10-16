import type { Copy, Theme } from './types.ts';

/** The built-in banner text. Any key can be overridden per language in `config.copy`. */
export const COPY_EN: Copy = {
  title: 'Cookies',
  body: 'This site uses analytics and marketing cookies. You can decline without affecting your browsing.',
  reject: 'Decline all',
  accept: 'Accept all',
  customise: 'Customise',
  save: 'Save my choices',
  recordedOn: 'Choice recorded on',
  reference: 'reference',
  nothingRecorded: 'No choice recorded yet.',
  categories: {
    essential: { label: 'Strictly necessary', note: 'Security and preferences. Never blocked.' },
    analytics: { label: 'Analytics', note: 'Understanding how the site is used.' },
    marketing: { label: 'Marketing', note: 'Advertising and retargeting.' },
  },
};

/** An example of a second language. Pass it as `copy: { fr: COPY_FR }`. */
export const COPY_FR: Partial<Copy> = {
  title: 'Cookies',
  body: 'Ce site utilise des cookies de mesure et de marketing. Vous pouvez refuser sans conséquence sur votre navigation.',
  reject: 'Tout refuser',
  accept: 'Tout accepter',
  customise: 'Personnaliser',
  save: 'Enregistrer mes choix',
  recordedOn: 'Choix enregistré le',
  reference: 'référence',
  nothingRecorded: 'Aucun choix enregistré pour le moment.',
  categories: {
    essential: { label: 'Strictement nécessaire', note: 'Sécurité et préférences. Jamais bloqué.' },
    analytics: { label: 'Mesure d’audience', note: 'Comprendre comment le site est utilisé.' },
    marketing: { label: 'Marketing', note: 'Publicité et remarketing.' },
  },
};

/** Light and dark. Used when the config gives no theme at all. */
export const DEFAULT_THEME: Theme = {
  accent: '#18181b',
  accentText: '#ffffff',
  radius: '12px',
  font: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  surface: '#ffffff',
  text: '#18181b',
  muted: '#52525b',
  border: '#e4e4e7',
  darkSurface: '#18181b',
  darkText: '#fafafa',
  darkMuted: '#a1a1aa',
  darkBorder: '#27272a',
  darkAccent: '#fafafa',
  darkAccentText: '#18181b',
};

/** The same light values without any `dark*` key: what a partial theme is merged over. */
const LIGHT_THEME: Theme = {
  accent: DEFAULT_THEME.accent,
  accentText: DEFAULT_THEME.accentText,
  radius: DEFAULT_THEME.radius,
  font: DEFAULT_THEME.font,
  surface: DEFAULT_THEME.surface,
  text: DEFAULT_THEME.text,
  muted: DEFAULT_THEME.muted,
  border: DEFAULT_THEME.border,
};

export function resolveTheme(theme?: Partial<Theme>): Theme {
  /* A site that names its own colours has not named a dark palette. Merging
   * over the dark defaults would put a near-black surface behind its own light
   * text in dark mode, so a partial theme merges over the light values only. */
  return theme ? { ...LIGHT_THEME, ...theme } : DEFAULT_THEME;
}

export function resolveCopy(locale: string, overrides: Record<string, Partial<Copy>> = {}): Copy {
  const base: Copy = { ...COPY_EN, ...overrides.en };
  return locale === 'en' || !overrides[locale] ? base : { ...base, ...overrides[locale] };
}
