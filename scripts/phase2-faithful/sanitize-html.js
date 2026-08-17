/**
 * sanitize-html.js — Hand-written sanitizer for rawline.framer.website
 *
 * Input:  clone-output/pages/{page}/html-raw/page.html (hydrated DOM from agent-browser)
 * Output:
 *   - public/css/{page}.css       (SSR minified CSS, font CSS, @font-face stripped from HTML)
 *   - public/data/{page}.html     (cleaned body fragment, no scripts/iframes/editorbar)
 *
 * Sanitizations:
 *   1. Extract <style data-framer-css-ssr-minified>  → main page CSS
 *   2. Extract <style data-framer-font-css>           → @font-face declarations
 *   3. Strip ALL <script> tags (Framer runtime, analytics, checkout init) — we have hydrated DOM, don't need runtime
 *   4. Strip <iframe> tags (Framer editor bar, embedded)
 *   5. Strip <style> editor bar CSS (#__framer-editorbar*)
 *   6. Strip data-framercommerce-widget (the floating "Framer Commerce" badge)
 *   7. Strip inline opacity:0 / transform:translateY(*) / transform:translateX(*) from style attributes
 *      (these are Framer's pre-hydration hidden state — hydrated DOM has them too, but they should be visible)
 *   8. Keep <link rel="stylesheet" href="https://fonts.gstatic.com/..."> (font preconnect — fine)
 *   9. Strip <link rel="modulepreload" href="https://framer.com/..."> (runtime preload)
 *
 * Usage:
 *   bun run scripts/sanitize/sanitize-html.js <page-dir> <output-name>
 *   bun run scripts/sanitize/sanitize-html.js home home
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const pageDir = process.argv[2];
const outName = process.argv[3];
if (!pageDir || !outName) {
  console.error('Usage: sanitize-html.js <page-dir> <output-name>');
  process.exit(1);
}

const inHtmlPath = path.join(ROOT, 'clone-output', 'pages', pageDir, 'html-raw', 'page.html');
const outCssPath = path.join(ROOT, 'public', 'css', `${outName}.css`);
const outHtmlPath = path.join(ROOT, 'public', 'data', `${outName}.html`);

if (!fs.existsSync(inHtmlPath)) {
  console.error(`Input HTML not found: ${inHtmlPath}`);
  process.exit(1);
}

console.log(`[sanitize] reading ${inHtmlPath}`);
const raw = fs.readFileSync(inHtmlPath, 'utf8');
console.log(`[sanitize]   size: ${raw.length} bytes`);

const $ = cheerio.load(raw, { decodeEntities: false });

// ---------- 1. Extract CSS pieces ----------
let ssrCss = '';
let fontCss = '';

$('style').each((_, el) => {
  const $el = $(el);
  const attrs = el.attribs || {};
  const css = $el.text() || '';

  if (attrs['data-framer-css-ssr-minified'] !== undefined) {
    ssrCss += css + '\n';
    $el.remove();
    return;
  }
  if (attrs['data-framer-font-css'] !== undefined) {
    fontCss += css + '\n';
    $el.remove();
    return;
  }
  // drop the empty data-framer-css="true" style tag
  if (attrs['data-framer-css'] !== undefined) {
    $el.remove();
    return;
  }
  // drop editor-bar styles — anything containing #__framer-editorbar
  if (css.includes('#__framer-editorbar') || css.includes('#__framer-badge')) {
    $el.remove();
    return;
  }
  // drop data-framer-html-style — usually redundant background overrides
  if (attrs['data-framer-html-style'] !== undefined) {
    // KEEP body background override (it sets the cream bg) — re-add as inline
    if (css.includes('background')) {
      ssrCss = css + '\n' + ssrCss;
    }
    $el.remove();
    return;
  }
  // any stray style tag with editor bar selectors — drop
  if (css.includes('__framer-')) {
    $el.remove();
    return;
  }
});

console.log(`[sanitize] SSR CSS: ${ssrCss.length} bytes`);
console.log(`[sanitize] Font CSS: ${fontCss.length} bytes`);

// ---------- 2. Strip scripts ----------
let scriptCount = 0;
$('script').each((_, el) => {
  scriptCount++;
  $(el).remove();
});
console.log(`[sanitize] stripped ${scriptCount} <script> tags`);

// ---------- 3. Strip iframes ----------
let iframeCount = 0;
$('iframe').each((_, el) => {
  iframeCount++;
  $(el).remove();
});
console.log(`[sanitize] stripped ${iframeCount} <iframe> tags`);

// ---------- 4. Strip Framer commerce badge widget ----------
$('[data-framercommerce-widget]').each((_, el) => {
  $(el).remove();
});
console.log(`[sanitize] stripped framercommerce-widget`);

// ---------- 5. Strip editorbar container (if any) ----------
$('#__framer-editorbar-container, #__framer-editorbar, #__framer-badge-container').each((_, el) => {
  $(el).remove();
});

// ---------- 6. Strip modulepreload / framer preconnect link tags ----------
$('link').each((_, el) => {
  const href = el.attribs?.href || '';
  const rel = el.attribs?.rel || '';
  // drop modulepreload to framer.com runtime
  if (rel === 'modulepreload' && href.includes('framer.com')) {
    $(el).remove();
    return;
  }
  // drop preconnect to framerusercontent — we have local assets
  // KEEP fonts.gstatic.com preconnect (helps nothing now since we serve fonts locally, but harmless)
});

// ---------- 7. Strip opacity:0 + transform:translateY(*) from inline styles ----------
// Framer SSR sets these as "pre-animation" state. Hydrated DOM has them too
// because the runtime didn't run. Force them visible.
let strippedStyles = 0;
$('[style]').each((_, el) => {
  const style = el.attribs?.style || '';
  if (!style) return;
  // Only touch opacity:0 and transform:translateY(*) (NOT translateX(-50%) which is used for centered nav)
  let changed = false;
  let newStyle = style
    // strip "opacity: 0" / "opacity:0"
    .replace(/opacity\s*:\s*0(?!\.\d)(?:\s*;|$)/g, (m) => {
      strippedStyles++;
      changed = true;
      return '';
    })
    // strip "transform: translateY(-100px)" and similar (Framer pre-hydrate hidden state)
    .replace(/transform\s*:\s*translateY\([^)]+\)\s*;?/g, (m) => {
      strippedStyles++;
      changed = true;
      return '';
    });
  if (changed) {
    // clean up leftover ;; and leading/trailing whitespace
    newStyle = newStyle.replace(/\s*;\s*;/g, '; ').replace(/^;\s*/, '').trim();
    if (newStyle) {
      el.attribs.style = newStyle;
    } else {
      delete el.attribs.style;
    }
  }
});
console.log(`[sanitize] stripped ${strippedStyles} opacity:0 / transform:translateY occurrences`);

// ---------- 8. Extract just the <div id="main"> content ----------
// That's the actual page body (header, content, footer all live inside #main)
const mainDiv = $('#main');
let bodyHtml = '';
if (mainDiv.length) {
  bodyHtml = $.html(mainDiv);
} else {
  // fallback: take the whole body
  bodyHtml = $('body').html() || '';
}
console.log(`[sanitize] body HTML: ${bodyHtml.length} bytes`);

// ---------- 9. Rewrite remote image URLs to local hash paths ----------
// Load url-map.json
const urlMapPath = path.join(ROOT, 'public', 'assets', '_hash', 'url-map.json');
let urlMap = {};
if (fs.existsSync(urlMapPath)) {
  urlMap = JSON.parse(fs.readFileSync(urlMapPath, 'utf8'));
  console.log(`[sanitize] url-map.json loaded: ${Object.keys(urlMap).length} entries`);
} else {
  console.warn(`[sanitize] WARNING: no url-map.json at ${urlMapPath}`);
}

// also handle &amp; entity-encoded URLs
const augmentedMap = { ...urlMap };
for (const [k, v] of Object.entries(urlMap)) {
  const enc = k.replace(/&/g, '&amp;');
  if (enc !== k) augmentedMap[enc] = v;
}

let rewritten = 0;
$('img').each((_, el) => {
  const src = el.attribs?.src || '';
  if (!src) return;
  // try direct match
  if (augmentedMap[src]) {
    el.attribs.src = augmentedMap[src];
    rewritten++;
    return;
  }
  // try with the query stripped of framer's resize params (already in url-map as full URL though)
  // try decode then match
  const decoded = src.replace(/&amp;/g, '&');
  if (augmentedMap[decoded]) {
    el.attribs.src = augmentedMap[decoded];
    rewritten++;
    return;
  }
  // try stripping &amp; in url
  if (augmentedMap[src]) {
    el.attribs.src = augmentedMap[src];
    rewritten++;
    return;
  }
  // leave as-is if it's already a local /assets/ path
  if (src.startsWith('/assets/')) {
    return;
  }
  // log unmapped remote URLs (could be tracking pixels etc.)
  if (src.startsWith('http')) {
    // silently skip — these are usually analytics pixels
  }
});
console.log(`[sanitize] rewrote ${rewritten} <img> src URLs to local`);

// Re-extract body HTML after img rewriting
if (mainDiv.length) {
  bodyHtml = $.html(mainDiv);
} else {
  bodyHtml = $('body').html() || '';
}

// Also rewrite url() in CSS — replace framerusercontent.com URLs with local hash paths
let cssRewritten = 0;
const combinedCss = ssrCss + '\n' + fontCss;
const finalCss = combinedCss.replace(
  /url\(\s*(['"]?)(https?:\/\/[^'")]+)\1\s*\)/g,
  (m, q, url) => {
    if (augmentedMap[url]) {
      cssRewritten++;
      return `url('${augmentedMap[url]}')`;
    }
    const decoded = url.replace(/&amp;/g, '&');
    if (augmentedMap[decoded]) {
      cssRewritten++;
      return `url('${augmentedMap[decoded]}')`;
    }
    return m;
  },
);
console.log(`[sanitize] rewrote ${cssRewritten} url() references in CSS`);

// ---------- 10. Write outputs ----------
fs.mkdirSync(path.dirname(outCssPath), { recursive: true });
fs.mkdirSync(path.dirname(outHtmlPath), { recursive: true });

fs.writeFileSync(outCssPath, finalCss, 'utf8');
console.log(`[sanitize] ✓ wrote ${outCssPath} (${finalCss.length} bytes)`);

fs.writeFileSync(outHtmlPath, bodyHtml, 'utf8');
console.log(`[sanitize] ✓ wrote ${outHtmlPath} (${bodyHtml.length} bytes)`);

console.log(`[sanitize] done.`);
