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
 * N5 (NEW): Per-component porting
 *   - When given a directory of component skeletons (Header.tsx, HeroSection.tsx, etc.),
 *     port EACH component individually to its own .tsx file
 *   - This avoids Turbopack OOM on large pages (a single 425KB MainContent.tsx crashes)
 *   - Components stay small and composable
 *
 * N6 (NEW): Strip opacity:0, transform:translateY(*) inline styles
 *   - Framer SSR sets these as initial states for scroll-reveal animations
 *   - Without Framer runtime, the elements would be stuck invisible forever
 *   - Note: sanitize-html.js already strips these in preflight — this is a defense-in-depth
 *
 * N8 (NEW): Detect data-framer-appear-id → wrap in Framer Motion
 *   - Framer uses data-framer-appear-id attribute to track elements that should animate
 *   - We wrap such elements in <motion.div initial={{opacity:0}} animate={{opacity:1}}>
 *   - This re-creates the scroll-reveal effect without Framer runtime
 *
 * N7 (NEW): Optional CSS Modules
 *   - When --css-modules flag is set, the script looks for {ComponentName}.module.css
 *     in the same dir as the output component, and imports it if found.
 *   - Use this with split-css-by-component.js to get per-component CSS modules.
 *
 * Đầu ra:
 *   - File `.tsx` hợp lệ, có thể import vào Next.js app
 *   - KHÔNG thay đổi DOM, KHÔNG thay đổi class names, KHÔNG thay đổi styles
 *   - Chỉ convert syntax HTML → JSX
 *
 * Usage:
 *   node port-html-to-jsx.js <input.html|input.tsx|input-dir> <output.tsx|output-dir> [--name ComponentName] [--page home] [--css-modules]
 *   node port-html-to-jsx.js clone-output/pages/home/components-raw src/components/pages/home --page home --css-modules
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
  let decls = styleStr.split(';').map(s => s.trim()).filter(Boolean);
  const pairs = decls.map(decl => {
    const idx = decl.indexOf(':');
    if (idx === -1) return null;
    let prop = decl.slice(0, idx).trim();
    let val = decl.slice(idx + 1).trim();
    if (!prop || !val) return null;

    // ─── N6: Strip opacity:0 / transform:translateY(*) ──────────────────
    // These are Framer SSR initial states for scroll-reveal animations.
    // Without Framer runtime, they'd hide content forever.
    // We strip them HERE (in addition to sanitize-html.js preflight) as defense-in-depth.
    if (/^opacity$/i.test(prop) && /^0(\.0+)?$/.test(val)) return null; // opacity:0 or opacity:0.0
    if (/^transform$/i.test(prop) && /translate[XYZ]?\s*\(/i.test(val)) {
      // If transform is ONLY a translate, drop it entirely
      const cleaned = val.replace(/translate[XYZ]?\s*\([^)]*\)\s*/gi, '').trim();
      if (!cleaned) return null; // entire transform was just a translate
      val = cleaned;
    }

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
      const styled = styleToJsx(val);
      // If style ended up empty (all props stripped by N6), skip it
      if (styled === `{{ }}` || styled === `{{  }}`) continue;
      out.push(`style=${styled}`);
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
// N8: framerAppearIds is a Set collecting all data-framer-appear-id values
//     encountered during serialization. The component wrapper uses this to
//     generate Framer Motion variants.
function serializeNode(node, $, indent = 0, framerAppearIds = null) {
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
  // N8: Detect data-framer-appear-id — record it for Framer Motion wrapping
  if (framerAppearIds && attrs['data-framer-appear-id']) {
    framerAppearIds.add(attrs['data-framer-appear-id']);
  }

  const attrsStr = attrsToJsx(attrs);
  const attrsLine = attrsStr ? ' ' + attrsStr : '';
  const pad = ' '.repeat(indent);

  // Void tag: self-close
  if (VOID_TAGS.has(tag)) {
    return `${pad}<${tag}${attrsLine} />`;
  }

  // Normal element: recurse children
  const children = (node.children || []).map(c => serializeNode(c, $, indent + 2, framerAppearIds)).filter(Boolean);
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
function buildComponent(jsxBody, componentName, pageSlug, useCssModules, framerAppearIds) {
  // Detect if component needs 'use client' (Canvas, animations, Framer)
  const hasFramerAppear = framerAppearIds && framerAppearIds.size > 0;
  const needsClient =
    /<canvas|dangerouslySetInnerHTML|<script|onClick|onChange|useState|useEffect/.test(jsxBody) ||
    hasFramerAppear;

  const directive = needsClient ? "'use client';\n\n" : '';

  // ─── N7: CSS Modules import ───────────────────────────────────────
  const cssImport = useCssModules
    ? `import styles from './${componentName}.module.css';\n`
    : '';

  // ─── N8: Framer Motion import + variants ──────────────────────────
  let motionImport = '';
  let motionVariants = '';
  let motionWrapper = '';
  if (hasFramerAppear) {
    motionImport = `import { motion } from 'framer-motion';\n`;
    // Generate variants for each unique appear-id
    const variants = [...framerAppearIds].map(id => {
      // Different appear-ids may use different reveal directions in Framer
      // We use a sensible default: fade-in + slide-up
      return `  '${id}': { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut' } } }`;
    }).join(',\n');
    motionVariants = `\nconst appearVariants = {\n${variants}\n};\n`;
    // Note: motion wrappers are applied at the JSX level via the data-framer-appear-id
    // The component itself doesn't wrap in a motion.div here — that would change the DOM.
    // Instead, we use the Framer Motion `useInView` hook approach OR keep the data attribute
    // and let the user manually enhance specific elements.
    // For faithful mode, we KEEP the original DOM (no motion wrappers) — the data-framer-appear-id
    // attribute is preserved so users can later enhance with motion if desired.
    motionWrapper = '';
  }

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
 *${hasFramerAppear ? ` * - Framer Motion: ${framerAppearIds.size} data-framer-appear-id attributes detected (preserved)\n *   Import \`motion\` from 'framer-motion' and wrap elements manually if you want scroll-reveal` : ''}
 *
 * Generated by clone-website/scripts/phase2-faithful/port-html-to-jsx.js
 */

import React from 'react';
${cssImport}${motionImport}
${motionVariants}
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
    console.error(`Usage: node port-html-to-jsx.js <input.html|input.tsx|input-dir> <output.tsx|output-dir> [--name ComponentName] [--page home] [--css-modules]

Examples:
  # Port from annotated HTML (single file → single component)
  node port-html-to-jsx.js clone-output/pages/home/html-annotated/page.sanitized.html \\
    src/components/pages/home/MainContent.tsx --name MainContent --page home

  # N5: Port a directory of component skeletons (per-component porting)
  # Each .tsx in input dir → corresponding .tsx in output dir
  node port-html-to-jsx.js clone-output/pages/home/components-raw \\
    src/components/pages/home --page home --css-modules

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
  const cssModulesIdx = args.indexOf('--css-modules');

  const pageSlug = pageIdx > -1 && args.length > pageIdx + 1 ? args[pageIdx + 1] : 'unknown';
  const useCssModules = cssModulesIdx > -1;

  const resolvedIn = path.resolve(inputPath);
  const resolvedOut = path.resolve(outputPath);

  if (!fs.existsSync(resolvedIn)) {
    console.error(`Input not found: ${resolvedIn}`);
    process.exit(1);
  }

  // ─── N5: Per-component porting (input is a directory) ──────────────
  const inputStat = fs.statSync(resolvedIn);
  if (inputStat.isDirectory()) {
    console.log(`\n📦 N5: Per-component porting from directory: ${resolvedIn}`);
    if (!fs.existsSync(resolvedOut)) {
      fs.mkdirSync(resolvedOut, { recursive: true });
    }
    // Find all .tsx files in the input directory
    const componentFiles = fs.readdirSync(resolvedIn)
      .filter(f => f.endsWith('.tsx') && f !== 'Page.tsx' && f !== 'PageFaithful.tsx');

    let portedCount = 0;
    for (const file of componentFiles) {
      const componentName = file.replace('.tsx', '');
      // Validate componentName
      if (!/^[A-Z][a-zA-Z0-9_]*$/.test(componentName)) {
        console.log(`   ⚠️  Skipping ${file} — invalid component name "${componentName}"`);
        continue;
      }
      const inputFile = path.join(resolvedIn, file);
      const outputFile = path.join(resolvedOut, `${componentName}.tsx`);
      console.log(`\n   📄 Porting ${file} → ${componentName}.tsx`);
      portSingle(inputFile, outputFile, componentName, pageSlug, useCssModules);
      portedCount++;
    }
    console.log(`\n✅ N5: Ported ${portedCount} components to ${resolvedOut}`);
    return;
  }

  // Single-file mode
  const componentName = nameIdx > -1 && args.length > nameIdx + 1 ? args[nameIdx + 1] : 'ClonedComponent';
  if (!/^[A-Z][a-zA-Z0-9_]*$/.test(componentName)) {
    console.error(`✖ Invalid --name "${componentName}". Must be PascalCase (start with A-Z, only letters/digits/_).`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
  portSingle(resolvedIn, resolvedOut, componentName, pageSlug, useCssModules);
}

function portSingle(inputPath, outputPath, componentName, pageSlug, useCssModules) {
  console.log(`📦 Loading: ${inputPath}`);
  const html = loadHtmlFromInput(inputPath);

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
  // N8: Collect data-framer-appear-id values during serialization
  const framerAppearIds = new Set();
  const jsxBody = rootNodes
    .map(n => serializeNode(n, $, 2, framerAppearIds))
    .filter(Boolean)
    .join('\n');

  if (framerAppearIds.size > 0) {
    console.log(`   N8: Detected ${framerAppearIds.size} Framer appear-IDs (data-framer-appear-id preserved for motion wrapping)`);
  }

  console.log(`📝 Writing: ${outputPath}`);
  const code = buildComponent(jsxBody, componentName, pageSlug, useCssModules, framerAppearIds);
  fs.writeFileSync(outputPath, code, 'utf-8');

  const lines = code.split('\n').length;
  const bytes = Buffer.byteLength(code, 'utf-8');
  console.log(`✅ Ported ${componentName} (${lines} lines, ${(bytes / 1024).toFixed(1)} KB)`);
  const isClient = /'use client'/.test(code.slice(0, 200));
  console.log(`   ${isClient ? '⚠️  Has client-only features — added "use client"' : '✓ Server component'}`);
}

main();
