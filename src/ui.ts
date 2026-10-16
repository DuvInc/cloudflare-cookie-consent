/**
 * The banner, inlined into the document by the Worker.
 *
 * Inlined rather than fetched, which is the point: it is part of the HTML the
 * visitor already asked for, so it paints with the first frame. No extra
 * request, no layout shift, nothing to preconnect to.
 *
 * Kept as plain strings instead of a template engine: a few KB of markup does
 * not justify a dependency inside a Worker.
 */

import type { CategoryId, Consent, Copy, Theme } from './types.ts';

const css = (t: Theme) => `
.cc{--cc-a:${t.accent};--cc-at:${t.accentText};--cc-r:${t.radius};--cc-f:${t.font};
--cc-s:${t.surface};--cc-t:${t.text};--cc-m:${t.muted};--cc-b:${t.border}}
@media (prefers-color-scheme:dark){.cc{--cc-s:${t.darkSurface ?? t.surface};--cc-t:${t.darkText ?? t.text};
--cc-m:${t.darkMuted ?? t.muted};--cc-b:${t.darkBorder ?? t.border};
--cc-a:${t.darkAccent ?? t.accent};--cc-at:${t.darkAccentText ?? t.accentText}}}
#cc-banner{position:fixed;inset:auto 0 0 0;z-index:2147483647;display:flex;justify-content:center;padding:16px;font:400 14px/1.55 var(--cc-f);pointer-events:none}
#cc-banner[hidden]{display:none}
/* The container spans the full width to centre the box, but it must intercept
 * nothing: without pointer-events:none the whole strip above the footer
 * swallows clicks meant for the page, including where there is visibly nothing.
 * The box alone is clickable. */
.cc .box{pointer-events:auto;width:100%;max-width:560px;background:var(--cc-s);color:var(--cc-t);border:1px solid var(--cc-b);border-radius:var(--cc-r);padding:20px;box-shadow:0 1px 2px rgba(0,0,0,.06),0 8px 24px rgba(0,0,0,.08)}
/* The box carries tabindex="-1" so focus can be moved to it when it appears: a
 * screen reader then announces the dialog, and one Tab reaches "decline". Tab
 * itself never lands on the box, so its focus ring would mean nothing and only
 * draws a frame around the banner. The buttons keep theirs, and it is explicit. */
.cc .box:focus{outline:none}
.cc button:focus-visible{outline:2px solid var(--cc-a);outline-offset:2px}
.cc h2{margin:0 0 6px;font-size:15px;font-weight:500}
.cc p{margin:0 0 16px;color:var(--cc-m)}
.cc .row{display:flex;gap:8px;flex-wrap:wrap}
.cc button{flex:1 1 140px;min-height:40px;padding:0 16px;border-radius:calc(var(--cc-r) - 4px);border:1px solid var(--cc-b);background:transparent;color:var(--cc-t);font:inherit;font-weight:500;cursor:pointer}
.cc button:hover{border-color:var(--cc-a)}
.cc button.primary{background:var(--cc-a);border-color:var(--cc-a);color:var(--cc-at)}
.cc button.primary:hover{opacity:.9}
.cc button.big{display:block;width:100%;flex:none;min-height:56px;font-size:17px;font-weight:600;border-radius:calc(var(--cc-r) - 2px);box-shadow:0 2px 6px rgba(0,0,0,.15)}
.cc .row.links{justify-content:flex-start;align-items:center;gap:6px 24px;margin-top:12px}
.cc button.link{flex:0 0 auto;border:0;background:0;color:var(--cc-t);text-decoration:underline;font-weight:400;min-height:32px;padding:0}
.cc button.link:hover{border:0;color:var(--cc-a)}
.cc .cats{margin:0 0 16px;display:none;flex-direction:column;gap:10px}
.cc.detail .cats,.cc.always .cats{display:flex}
.cc.detail .summary{display:none}
.cc label{display:grid;grid-template-columns:16px 1fr;gap:0 10px;align-items:start;padding:11px 12px;border:1px solid var(--cc-b);border-radius:calc(var(--cc-r) - 4px);cursor:pointer}
.cc label:hover{border-color:var(--cc-a)}
.cc label b{display:block;font-weight:500;font-size:14px;line-height:20px}
.cc label em{grid-column:2;display:block;font-style:normal;color:var(--cc-m);font-size:13px;line-height:18px;margin-top:1px}
.cc input{width:16px;height:16px;margin:2px 0 0;accent-color:var(--cc-a)}
.cc input:disabled{opacity:.5}
.cc label:has(input:disabled){cursor:default}
.cc label:has(input:disabled):hover{border-color:var(--cc-b)}
.cc .state{font-size:13px;color:var(--cc-m);margin:0 0 16px;transition:color .2s}
.cc .state.saved{color:var(--cc-a);font-weight:500}
#cc-preferences .box{max-width:none;box-shadow:none}
`;

function checkbox(id: CategoryId, label: string, note: string, checked: boolean, locked: boolean) {
  return (
    '<label><input type="checkbox" value="' + id + '"' +
    (checked ? ' checked' : '') +
    (locked ? ' disabled' : '') +
    '><b>' + label + '</b><em>' + note + '</em></label>'
  );
}

export function bannerHtml(
  copy: Copy,
  theme: Theme,
  consent: Consent | null,
  rejectStyle: 'button' | 'link' = 'button',
): string {
  const order: CategoryId[] = ['essential', 'analytics', 'marketing'];
  /* A site declares only the categories it really uses: one with no marketing
   * tracker leaves `marketing` out of its copy, and it is simply not shown. */
  const cats = order
    .flatMap((id) => {
      const category = copy.categories[id];
      if (!category) return [];
      return [
        checkbox(
          id,
          category.label,
          category.note,
          id === 'essential' || (!!consent && consent.granted.includes(id)),
          id === 'essential',
        ),
      ];
    })
    .join('');

  /* `hidden` as soon as a choice exists: the markup still ships so the footer
   * link can reopen the panel without a round trip, and withdrawing consent has
   * to stay as easy as giving it. */
  return (
    '<style>' + css(theme) + '</style>' +
    '<div id="cc-banner" class="cc" role="dialog" aria-modal="false" aria-labelledby="cc-title"' +
    (consent ? ' hidden' : '') + '>' +
    '<div class="box" tabindex="-1">' +
    '<h2 id="cc-title">' + copy.title + '</h2>' +
    '<p>' + copy.body + '</p>' +
    '<div class="cats">' + cats + '</div>' +
    (rejectStyle === 'link'
      ? /* Accept is the large button and refusing is a text link: a legitimate
         * layout for a site that accepts the regulatory risk, and not the default. */
        '<button type="button" class="primary big" data-act="accept">' + copy.accept + '</button>' +
        '<div class="row links">' +
        '<button type="button" class="link" data-act="reject">' + copy.reject + '</button>'
      : /* Default: the two answers are the same size, side by side. */
        '<div class="row">' +
        '<button type="button" class="primary" data-act="accept">' + copy.accept + '</button>' +
        '<button type="button" data-act="reject">' + copy.reject + '</button>' +
        '</div>' +
        '<div class="row links">') +
    '<button type="button" class="link summary" data-act="detail">' + copy.customise + '</button>' +
    '<button type="button" class="link" data-act="save" style="display:none">' + copy.save + '</button>' +
    '</div>' +
    '</div></div>'
  );
}
