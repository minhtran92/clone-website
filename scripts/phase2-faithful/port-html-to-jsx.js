#!/usr/bin/env node
/**
 * port-html-to-jsx.js — Mode Faithful: Port HTML skeleton sang JSX
 *
 * Bước 2.1 của Phase 2 mode-faithful.
 *
 * Mục tiêu:
 *   - Lấy component skeleton (.tsx) từ clone Phase 1 (`clone-output/pages/{page}/components-raw/*.tsx`)
 *     — bên trong là HTML gốc nhét trong `dangerouslySetInnerHTML`
 *   - Hoặc lấy HTML annotated trực tiếp (`page.sanitized.html`)
 *   - Port sang JSX hợp lệ cho Next.js App Router:
 *     + `class` → `className`
 *     + `for` → `htmlFor`
 *     + `tabindex` → `tabIndex`
 *     + `colspan`/`rowspan` → `colSpan`/`rowSpan`
 *     + `aria-*` giữ nguyên
 *     + `data-*` giữ nguyên (kebab-case OK trong JSX)
 *     + Inline `style="..."` → `style={{...}}` (camelCase keys)
 *     + Self-closing tags: `<img>`, `<br>`, `<hr>`, `<input>`, `<meta>`, `<link>`, `<source>`, `<path>`, `<area>`, `<col>`, `<embed>`, `<param>`, `<track>`, `<wbr>`
 *     + Boolean attrs: `disabled`, `checked`, `selected`, `readonly`, `multiple`, `autofocus`, `required`, `hidden` → `disabled={true}` hoặc viết tắt `disabled`
 *     + HTML entities trong text → escape
 *     + Comment HTML `<!-- -->` → JSX `{* ... *}`
 *     + `<script>` tags → giữ nguyên nội dung (cần cho Canvas/Framer effects)
 *     + `<style>` tags → giữ nguyên (cần cho inline CSS)
 *
 * Đầu ra:
 *   - File `.tsx` hợp lệ, có thể import vào Next.js app
 *   - KHÔNG thay đổi DOM, KHÔNG thay đổi class names, KHÔNG thay đổi styles
 *   - Chỉ convert syntax HTML → JSX
 *
 * Usage:
 *   node port-html-to-jsx.js <input.html|input.tsx> <output.tsx> [--name ComponentName] [--page home]
 *   node port-html-to-jsx.js clone-output/pages/home/components-raw/MainContent.tsx src/components/pages/home/MainContent.tsx --name MainContent
 *   node port-html-to-jsx.js clone-output/pages/home/html-annotated/page.sanitized.html src/components/pages/home/MainContent.tsx --name MainContent
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

// === Attr conversions ===
const ATTR_MAP = {
  'class': 'className',
  'for': 'htmlFor',
  'tabindex': 'tabIndex',
  'colspan': 'colSpan',
  'rowspan': 'rowSpan',
  'cellpadding': 'cellPadding',
  'cellspacing': 'cellSpacing',
  'usemap': 'useMap',
  'frameborder': 'frameBorder',
  'maxlength': 'maxLength',
  'minlength': 'minLength',
  'readonly': 'readOnly',
  'contenteditable': 'contentEditable',
  'crossorigin': 'crossOrigin',
  'autocomplete': 'autoComplete',
  'autofocus': 'autoFocus',
  'autoplay': 'autoPlay',
  'enctype': 'encType',
  'novalidate': 'noValidate',
  'datetime': 'dateTime',
  'formaction': 'formAction',
  'formenctype': 'formEncType',
  'formmethod': 'formMethod',
  'formtarget': 'formTarget',
  'inputmode': 'inputMode',
  'ismap': 'isMap',
  'maxlength': 'maxLength',
  'minlength': 'minLength',
  'preload': 'preload', // keep
  'radiogroup': 'radioGroup',
  'spellcheck': 'spellCheck',
  'srcdoc': 'srcDoc',
  'srclang': 'srcLang',
  'srcset': 'srcSet',
  'usemap': 'useMap',
  'wrap': 'wrap',
};

// Tags self-closing in HTML5 (void elements)
const VOID_TAGS = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'path', 'area', 'col', 'embed', 'param', 'track', 'wbr', 'base', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'rect', 'stop', 'use']);

// Boolean attrs
const BOOLEAN_ATTRS = new Set(['disabled', 'checked', 'selected', 'readonly', 'multiple', 'autofocus', 'required', 'hidden', 'async', 'defer', 'controls', 'autoplay', 'loop', 'muted', 'default', 'reversed', 'ismap', 'noresize', 'noshade', 'nowrap', 'compact', 'declare', 'nomodule', 'truespeed', 'typemustmatch', 'novalidate', 'formnovalidate', 'open', 'playsinline', 'itemscope', 'allowfullscreen', 'defaultchecked', 'defaultselected', 'inert', 'sortable', 'translate', 'pubdate']);

// Attrs that need camelCase values preserved
const KEEP_KEBAB = /^data-/;
const KEEP_ARIA = /^aria-/;

// SVG / CSS attributes with dashes that React requires in camelCase (stroke-width → strokeWidth etc.)
// Excludes data-* and aria-* which are intentionally kebab-case.
const SVG_DASH_ATTRS = {
  'stroke-width': 'strokeWidth',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  'stroke-miterlimit': 'strokeMiterlimit',
  'stroke-dasharray': 'strokeDasharray',
  'stroke-dashoffset': 'strokeDashoffset',
  'stroke-opacity': 'strokeOpacity',
  'fill-rule': 'fillRule',
  'fill-opacity': 'fillOpacity',
  'clip-rule': 'clipRule',
  'clip-path': 'clipPath',
  'color-interpolation': 'colorInterpolation',
  'color-interpolation-filters': 'colorInterpolationFilters',
  'flood-color': 'floodColor',
  'flood-opacity': 'floodOpacity',
  'stop-color': 'stopColor',
  'stop-opacity': 'stopOpacity',
  'text-anchor': 'textAnchor',
  'text-decoration': 'textDecoration',
  'text-rendering': 'textRendering',
  'font-family': 'fontFamily',
  'font-size': 'fontSize',
  'font-size-adjust': 'fontSizeAdjust',
  'font-stretch': 'fontStretch',
  'font-style': 'fontStyle',
  'font-variant': 'fontVariant',
  'font-weight': 'fontWeight',
  'marker-end': 'markerEnd',
  'marker-mid': 'markerMid',
  'marker-start': 'markerStart',
  'paint-order': 'paintOrder',
  'pointer-events': 'pointerEvents',
  'shape-rendering': 'shapeRendering',
  'vector-effect': 'vectorEffect',
  'word-spacing': 'wordSpacing',
  'letter-spacing': 'letterSpacing',
  'alignment-baseline': 'alignmentBaseline',
  'baseline-shift': 'baselineShift',
  'dominant-baseline': 'dominantBaseline',
  'glyph-orientation-horizontal': 'glyphOrientationHorizontal',
  'glyph-orientation-vertical': 'glyphOrientationVertical',
  'scroll-timeline': 'scrollTimeline',
};

// === Convert inline style string → JSX style object string ===
function styleToJsx(styleStr) {
  const decls = styleStr.split(';').map(s => s.trim()).filter(Boolean);
  const pairs = decls.map(decl => {
    const idx = decl.indexOf(':');
    if (idx === -1) return null;
    const prop = decl.slice(0, idx).trim();
    const val = decl.slice(idx + 1).trim();
    if (!prop || !val) return null;
    // Convert kebab-case → camelCase
    const jsxProp = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    // Vendor prefix: -webkit-..., -moz-... → Webkit..., Moz...
    const finalProp = jsxProp.replace(/^-([a-z])/, (_, c) => c.toUpperCase());
    // Escape quotes in val
    const escapedVal = val.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `${finalProp}: '${escapedVal}'`;
  }).filter(Boolean);
  return `{{ ${pairs.join(', ')} }}`;
}

// === Escape JSX text content ===
function escapeJsxText(text) {
  // Preserve entities as JSX entities (they work in JSX)
  // But escape curly braces (would be interpreted as JSX expression)
  // And escape backticks
  return text
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\{/g, "{'{'}")
    .replace(/\}/g, "{'}'}");
}

// === Convert attrs object → JSX attr string ===
function attrsToJsx(attrs) {
  const out = [];
  for (const [key, val] of Object.entries(attrs)) {
    if (key === 'style') {
      out.push(`style=${styleToJsx(val)}`);
      continue;
    }
    // kebab data-* / aria-* → keep as-is
    if (KEEP_KEBAB.test(key) || KEEP_ARIA.test(key)) {
      out.push(`${key}="${escapeAttrVal(val)}"`);
      continue;
    }
    // SVG / CSS dashed attributes → camelCase (stroke-width → strokeWidth)
    if (Object.prototype.hasOwnProperty.call(SVG_DASH_ATTRS, key.toLowerCase())) {
      out.push(`${SVG_DASH_ATTRS[key.toLowerCase()]}="${escapeAttrVal(val)}"`);
      continue;
    }
    const lowerKey = key.toLowerCase();
    // Boolean attrs: output camelCased name if mapped (autofocus → autoFocus), else bare lowercase name
    if (BOOLEAN_ATTRS.has(lowerKey)) {
      const jsxBoolName = ATTR_MAP[lowerKey] || lowerKey;
      out.push(jsxBoolName);
      continue;
    }
    // Mapped attrs (class → className, etc.) — try original case then lowercased
    const jsxKey = ATTR_MAP[key] || ATTR_MAP[lowerKey] || key;
    out.push(`${jsxKey}="${escapeAttrVal(val)}"`);
  }
  return out.join(' ');
}

function escapeAttrVal(val) {
  if (typeof val !== 'string') val = String(val);
  return val
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// === Recursive serialize cheerio node → JSX string ===
function serializeNode(node, $, indent = 0) {
  if (node.type === 'text') {
    const text = node.data || '';
    const trimmed = text.replace(/\s+/g, ' ');
    if (!trimmed.trim()) return ''; // skip whitespace-only between block elements
    return ' '.repeat(indent) + escapeJsxText(trimmed);
  }
  if (node.type === 'comment') {
    const content = (node.data || '').trim().replace(/\*\//g, '* /');
    return ' '.repeat(indent) + `{/* ${content} */}`;
  }
  if (node.type !== 'tag') return '';

  const tag = (node.tagName || '').toLowerCase();
  if (!tag) return '';

  // Special-case <script> and <style> — preserve content as dangerouslySetInnerHTML
  // because JSX can't contain raw JS/CSS without escaping conflicts.
  // We DO preserve attributes (src, async, type, media, crossorigin, etc.) on the host element.
  if (tag === 'script' || tag === 'style') {
    const inner = $(node).html() || '';
    const escaped = inner
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$\{/g, '\\${');
    const attrsStr = attrsToJsx(node.attribs || {});
    const attrsLine = attrsStr ? ' ' + attrsStr : '';
    const pad = ' '.repeat(indent);
    if (inner.trim() === '' && attrsStr) {
      // External <script src="..."> with no inline content — self-closing
      return `${pad}<${tag}${attrsLine} />`;
    }
    return `${pad}<${tag}${attrsLine} dangerouslySetInnerHTML={{ __html: \`${escaped}\` }} />`;
  }

  const attrs = node.attribs || {};
  const attrsStr = attrsToJsx(attrs);
  const attrsLine = attrsStr ? ' ' + attrsStr : '';
  const pad = ' '.repeat(indent);

  // Void tag: self-close
  if (VOID_TAGS.has(tag)) {
    return `${pad}<${tag}${attrsLine} />`;
  }

  // Normal element: recurse children
  const children = (node.children || []).map(c => serializeNode(c, $, indent + 2)).filter(Boolean);
  if (children.length === 0) {
    return `${pad}<${tag}${attrsLine} />`;
  }
  // If single text child, inline it
  if (children.length === 1 && node.children.length === 1 && node.children[0].type === 'text') {
    const text = (node.children[0].data || '').replace(/\s+/g, ' ').trim();
    if (text) {
      return `${pad}<${tag}${attrsLine}>${escapeJsxText(text)}</${tag}>`;
    }
  }
  return `${pad}<${tag}${attrsLine}>\n${children.join('\n')}\n${pad}</${tag}>`;
}

// === Extract HTML body from sanitized.html OR extract from skeleton .tsx ===
function loadHtmlFromInput(inputPath) {
  const content = fs.readFileSync(inputPath, 'utf-8');
  // If input is .tsx skeleton, extract the inner HTML from dangerouslySetInnerHTML={{ __html: `...` }}
  if (inputPath.endsWith('.tsx') || inputPath.endsWith('.ts')) {
    // Match the template literal content
    const match = content.match(/dangerouslySetInnerHTML=\{\{[^`]*`([\s\S]*?)`\s*\}\}/);
    if (match) {
      // Unescape: \`, \\, \$
      return match[1]
        .replace(/\\`/g, '`')
        .replace(/\\\\/g, '\\')
        .replace(/\\\$/g, '$')
        .replace(/\\\{/g, '{');
    }
    // Fallback: maybe the file is already JSX (no dangerouslySetInnerHTML)
    return content;
  }
  // .html file: return as-is (cheerio will parse)
  return content;
}

// === Build complete Next.js component from JSX body ===
function buildComponent(jsxBody, componentName, pageSlug) {
  // Detect if component needs 'use client' (Canvas, animations, Framer)
  const needsClient =
    /<canvas|dangerouslySetInnerHTML|<script|onClick|onChange|useState|useEffect/.test(jsxBody);

  const directive = needsClient ? "'use client';\n\n" : '';

  return `${directive}/**
 * ${componentName} — Ported from clone Phase 1 (mode-faithful)
 * Source: clone-output/pages/${pageSlug}/
 *
 * NOTE: This component preserves the original DOM 1:1 from the source website.
 * - Class names, inline styles, attributes are kept verbatim
 * - <script>/<style> tags preserved via dangerouslySetInnerHTML
 * - Remote asset URLs (images, fonts) are NOT rewritten here — run rewrite-asset-urls.js after download-assets.js
 * - Tailwind utility classes in source HTML are KEPT (works if same Tailwind version)
 *   — to make them work, ensure your Tailwind v4 config scans the source classes
 *
 * Generated by clone-website/scripts/phase2-faithful/port-html-to-jsx.js
 */

import React from 'react';

export default function ${componentName}() {
  return (
${jsxBody.split('\n').map(l => '    ' + l).join('\n')}
  );
}
`;
}

// === Main ===
function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error(`Usage: node port-html-to-jsx.js <input.html|input.tsx> <output.tsx> [--name ComponentName] [--page home]

Examples:
  # Port from annotated HTML
  node port-html-to-jsx.js clone-output/pages/home/html-annotated/page.sanitized.html \\
    src/components/pages/home/MainContent.tsx --name MainContent --page home

  # Port from existing skeleton .tsx (extracts dangerouslySetInnerHTML content)
  node port-html-to-jsx.js clone-output/pages/home/components-raw/MainContent.tsx \\
    src/components/pages/home/MainContent.tsx --name MainContent --page home

  # Port whole page (header + main + footer in one component)
  node port-html-to-jsx.js clone-output/pages/home/html-annotated/page.sanitized.html \\
    src/app/home/page.tsx --name HomePage --page home
`);
    process.exit(1);
  }

  const [inputPath, outputPath] = args;
  const nameIdx = args.indexOf('--name');
  const pageIdx = args.indexOf('--page');

  const componentName = nameIdx > -1 && args.length > nameIdx + 1 ? args[nameIdx + 1] : 'ClonedComponent';
  const pageSlug = pageIdx > -1 && args.length > pageIdx + 1 ? args[pageIdx + 1] : 'unknown';

  // Validate componentName — must be a valid JS identifier starting with uppercase letter
  if (!/^[A-Z][a-zA-Z0-9_]*$/.test(componentName)) {
    console.error(`✖ Invalid --name "${componentName}". Must be PascalCase (start with A-Z, only letters/digits/_).`);
    process.exit(1);
  }

  const resolvedIn = path.resolve(inputPath);
  const resolvedOut = path.resolve(outputPath);

  if (!fs.existsSync(resolvedIn)) {
    console.error(`Input not found: ${resolvedIn}`);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });

  console.log(`📦 Loading: ${resolvedIn}`);
  const html = loadHtmlFromInput(resolvedIn);

  // Use cheerio to parse (handles malformed HTML gracefully)
  const $ = cheerio.load(html, {
    decodeEntities: true,
    lowerCaseAttributeNames: false, // preserve original case (for SVG attrs)
    lowerCaseTags: true,
  });

  // Decide root: if input is full HTML document, find body; else use children of root
  let rootNodes;
  const body = $('body');
  if (body.length && body.children().length) {
    rootNodes = body.children().toArray();
  } else {
    // Maybe just a fragment — use root's children (skip <head>)
    rootNodes = $('html').children().toArray().filter(n => (n.tagName || '').toLowerCase() !== 'head');
    if (rootNodes.length === 0) {
      // Pure fragment: use root children
      const root = $.root()[0];
      rootNodes = root ? (root.children || []) : [];
    }
  }

  console.log(`✂️  Serializing ${rootNodes.length} root nodes...`);
  const jsxBody = rootNodes
    .map(n => serializeNode(n, $, 2))
    .filter(Boolean)
    .join('\n');

  console.log(`📝 Writing: ${resolvedOut}`);
  const code = buildComponent(jsxBody, componentName, pageSlug);
  fs.writeFileSync(resolvedOut, code, 'utf-8');

  const lines = code.split('\n').length;
  const bytes = Buffer.byteLength(code, 'utf-8');
  console.log(`✅ Ported ${componentName} (${lines} lines, ${(bytes / 1024).toFixed(1)} KB)`);
  console.log(`   ${needsClientCheck(code) ? '⚠️  Has client-only features (Canvas/script) — added "use client" directive' : '✓ Server component (no client features detected)'}`);
}

function needsClientCheck(code) {
  return /'use client'/.test(code.slice(0, 200));
}

main();
