/**
 * A small stand-in for Cloudflare's HTMLRewriter, so the tests run in plain
 * Node with no network and no wrangler.
 *
 * It implements exactly the slice the engine uses: `.on(selector, { element })`
 * with tag and attribute selectors, `.onDocument({ end })`, and on an element
 * `getAttribute`, `setAttribute`, `removeAttribute`, `prepend`,
 * `setInnerContent` and `onEndTag`. It tokenises with a regular expression, so
 * it is only right for the well-formed documents the tests feed it.
 *
 * What it can NOT prove is that the real HTMLRewriter behaves the same. That is
 * what `npm run example` plus `scripts/check-consent-live.mjs` is for: run them
 * against a real Worker before trusting a change to the rewrite.
 */

const TAG = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/gi;
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
const RAW_TEXT = new Set(['script', 'noscript', 'style']);

function parseSelector(selector) {
  return selector.split(',').map((part) => {
    const m = part.trim().match(/^([a-z0-9-]+)((?:\[[^\]]+\])*)$/i);
    if (!m) throw new Error('fake HTMLRewriter: unsupported selector ' + part);
    const attrs = [...m[2].matchAll(/\[([\w-]+)(?:(~?=)"([^"]*)")?\]/g)].map((a) => ({ name: a[1], op: a[2], value: a[3] }));
    return { tag: m[1].toLowerCase(), attrs };
  });
}

function matches(parsed, tag, attrs) {
  return parsed.some((sel) => {
    if (sel.tag !== tag) return false;
    return sel.attrs.every((a) => {
      const found = attrs.find((x) => x.name === a.name);
      if (!found) return false;
      if (!a.op) return true;
      if (a.op === '=') return found.value === a.value;
      return (found.value ?? '').split(/\s+/).includes(a.value);
    });
  });
}

export class FakeHTMLRewriter {
  #handlers = [];
  #doc = {};

  on(selector, handlers) {
    this.#handlers.push({ parsed: parseSelector(selector), handlers });
    return this;
  }

  onDocument(handlers) {
    Object.assign(this.#doc, handlers);
    return this;
  }

  transform(response) {
    const self = this;
    const stream = new ReadableStream({
      async start(controller) {
        const html = await response.text();
        controller.enqueue(new TextEncoder().encode(self.#run(html)));
        controller.close();
      },
    });
    return new Response(stream, { status: response.status, statusText: response.statusText, headers: new Headers(response.headers) });
  }

  #run(html) {
    let out = '';
    let last = 0;
    const endTagHandlers = new Map();
    TAG.lastIndex = 0;
    let m;
    while ((m = TAG.exec(html))) {
      out += html.slice(last, m.index);
      last = TAG.lastIndex;

      if (m[1]) {
        // An end tag. Run what an element registered with onEndTag.
        const name = m[1].toLowerCase();
        for (const handler of endTagHandlers.get(name) ?? []) handler({ before: (c) => (out += c) });
        endTagHandlers.delete(name);
        out += m[0];
        continue;
      }
      if (!m[2]) {
        out += m[0];
        continue;
      }

      const name = m[2].toLowerCase();
      const attrs = [...m[3].matchAll(ATTR)].map((a) => ({ name: a[1].toLowerCase(), value: a[2] ?? a[3] ?? a[4] ?? null }));
      let prepend = '';
      let inner = null;
      const element = {
        getAttribute: (n) => {
          const a = attrs.find((x) => x.name === n);
          return a ? (a.value ?? '') : null;
        },
        setAttribute: (n, v) => {
          const a = attrs.find((x) => x.name === n);
          if (a) a.value = v;
          else attrs.push({ name: n, value: v });
        },
        removeAttribute: (n) => {
          const i = attrs.findIndex((x) => x.name === n);
          if (i >= 0) attrs.splice(i, 1);
        },
        prepend: (c) => (prepend += c),
        setInnerContent: (c) => (inner = c),
        onEndTag: (h) => endTagHandlers.set(name, [...(endTagHandlers.get(name) ?? []), h]),
      };
      for (const { parsed, handlers } of this.#handlers) {
        if (handlers.element && matches(parsed, name, attrs)) handlers.element(element);
      }

      const serialised = attrs.map((a) => (a.value === null ? a.name : `${a.name}="${String(a.value).replace(/"/g, '&quot;')}"`)).join(' ');
      out += `<${name}${serialised ? ' ' + serialised : ''}${m[4] ? ' /' : ''}>` + prepend;

      if (RAW_TEXT.has(name) && !m[4]) {
        // The content of these is not markup: copy it through, or replace it.
        const close = html.toLowerCase().indexOf('</' + name, last);
        const end = close === -1 ? html.length : close;
        out += inner !== null ? inner : html.slice(last, end);
        last = end;
        TAG.lastIndex = end;
      } else if (inner !== null) {
        out += inner;
      }
    }
    out += html.slice(last);
    if (this.#doc.end) this.#doc.end({ append: (c) => (out += c) });
    return out;
  }
}
