#!/usr/bin/env node
/**
 * inject-resolved-css.js — Mode Faithful: Inject resolved.css into globals.css
 *
 * Bước 2.5 của Phase 2 mode-faithful.
 *
 * Mục tiêu:
 *   - Đọc `resolved.css` từ clone Phase 1 (CSS gốc với variables đã resolve thành values)
 *   - Đọc `extracted.css` từ clone Phase 1 (toàn bộ <style> từ page gốc)
 *   - Inject vào `globals.css` của Next.js project (đảm bảo CSS gốc chạy được)
 *   - Wrap trong scope `:where([data-page="<slug>"])` để tránh leak giữa các pages
 *
 * Strategy:
 *   - Next.js project có `@import "tailwindcss";` ở đầu globals.css (Tailwind v4):
 *     → Append resolved.css + extracted.css vào cuối globals.css (Tailwind utilities có priority hơn)
 *   - Wrap top-level style rules trong `:where([data-page="<slug>"])` (0 specificity)
 *   - For at-rules that contain nested style rules (@media / @supports / @container):
 *     scope inner selectors
 *   - For at-rules that DON'T contain nested selectors (@font-face / @keyframes /
 *     @property / @page / @layer / @import / @charset / @namespace): pass through verbatim
 *
 * Usage:
 *   node inject-resolved-css.js <resolved.css> [--extracted <extracted.css>] --globals <path-to-globals.css> --page <slug>
 *
 * Examples:
 *   node inject-resolved-css.js clone-output/pages/home/html-raw/resolved.css \
 *     --extracted clone-output/pages/home/html-raw/extracted.css \
 *     --globals src/app/globals.css \
 *     --page home
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error(`Usage: node inject-resolved-css.js <resolved.css> [--extracted <extracted.css>] --globals <path> --page <slug>

Examples:
  node inject-resolved-css.js clone-output/pages/home/html-raw/resolved.css \\
    --extracted clone-output/pages/home/html-raw/extracted.css \\
    --globals src/app/globals.css \\
    --page home
`);
  process.exit(1);
}

const resolvedCssPath = path.resolve(args[0]);
const extractedIdx = args.indexOf('--extracted');
const globalsIdx = args.indexOf('--globals');
const pageIdx = args.indexOf('--page');

const extractedCssPath = extractedIdx > -1 && args.length > extractedIdx + 1
  ? path.resolve(args[extractedIdx + 1])
  : null;
const globalsPath = globalsIdx > -1 && args.length > globalsIdx + 1
  ? path.resolve(args[globalsIdx + 1])
  : path.resolve('src/app/globals.css');
const pageSlug = pageIdx > -1 && args.length > pageIdx + 1 ? args[pageIdx + 1] : 'unknown';

if (!fs.existsSync(resolvedCssPath)) {
  console.error(`✖ resolved.css not found: ${resolvedCssPath}`);
  process.exit(1);
}

const resolvedCss = fs.readFileSync(resolvedCssPath, 'utf-8');
const extractedCss = extractedCssPath && fs.existsSync(extractedCssPath)
  ? fs.readFileSync(extractedCssPath, 'utf-8')
  : '';

// ============================================================
// CSS Tokenizer — top-level blocks only (no nested at-rule handling in tokenizer;
// we recurse into @media / @supports / @container blocks after the fact)
// ============================================================

/**
 * Strip /* ... *\/ comments from CSS source. Preserves strings (url("..."), content: "...") to avoid
 * accidental removal of brace-like chars inside strings.
 */
function stripComments(css) {
  let out = '';
  let i = 0;
  let inString = null; // '"' | "'" | null
  while (i < css.length) {
    const c = css[i];
    if (inString) {
      out += c;
      if (c === '\\' && i + 1 < css.length) {
        out += css[i + 1];
        i += 2;
        continue;
      }
      if (c === inString) inString = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = c;
      out += c;
      i++;
      continue;
    }
    if (c === '/' && css[i + 1] === '*') {
      // Skip until */
      let end = css.indexOf('*/', i + 2);
      if (end === -1) end = css.length - 2;
      out += ' '; // preserve whitespace
      i = end + 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Split CSS source into top-level blocks. Each block is one of:
 *   - { type: 'at-rule', header: '@media ...', body: '...' }
 *   - { type: 'rule', selector: '...', body: '...' }
 *   - { type: 'at-statement', text: '@import ...;' | '@charset ...;' | '@namespace ...;' }
 * Strings inside the CSS are preserved (no escape interpretation).
 */
function tokenizeTopLevel(css) {
  const blocks = [];
  let i = 0;
  let inString = null;
  const n = css.length;

  const peek = (offset) => css[i + offset];

  while (i < n) {
    // Skip whitespace
    while (i < n && /\s/.test(css[i])) i++;
    if (i >= n) break;

    // Read prelude up to `{` or `;` (respecting strings + parens)
    let prelude = '';
    let parenDepth = 0;
    while (i < n) {
      const c = css[i];
      if (inString) {
        prelude += c;
        if (c === '\\' && i + 1 < n) {
          prelude += css[i + 1];
          i += 2;
          continue;
        }
        if (c === inString) inString = null;
        i++;
        continue;
      }
      if (c === '"' || c === "'") {
        inString = c;
        prelude += c;
        i++;
        continue;
      }
      if (c === '(') {
        parenDepth++;
        prelude += c;
        i++;
        continue;
      }
      if (c === ')') {
        parenDepth = Math.max(0, parenDepth - 1);
        prelude += c;
        i++;
        continue;
      }
      if (parenDepth === 0 && c === '{') break;
      if (parenDepth === 0 && c === ';') {
        // At-statement (e.g. @import, @charset, @namespace)
        blocks.push({ type: 'at-statement', text: prelude + ';' });
        i++; // skip `;`
        prelude = '';
        break;
      }
      prelude += c;
      i++;
    }
    if (prelude === '') continue;
    if (i >= n) {
      // Trailing junk
      blocks.push({ type: 'at-statement', text: prelude });
      break;
    }
    if (css[i] === ';') continue; // already handled

    // css[i] === '{' — read body until matching `}`
    i++; // skip `{`
    let body = '';
    let depth = 1;
    while (i < n && depth > 0) {
      const c = css[i];
      if (inString) {
        body += c;
        if (c === '\\' && i + 1 < n) {
          body += css[i + 1];
          i += 2;
          continue;
        }
        if (c === inString) inString = null;
        i++;
        continue;
      }
      if (c === '"' || c === "'") {
        inString = c;
        body += c;
        i++;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) { i++; break; }
      }
      body += c;
      i++;
    }

    const header = prelude.trim();
    if (header.startsWith('@')) {
      blocks.push({ type: 'at-rule', header, body });
    } else if (header) {
      blocks.push({ type: 'rule', selector: header, body });
    }
  }
  return blocks;
}

/**
 * Wrap a comma-separated selector list with the given scope prefix.
 * `:where([data-page="home"]) .foo, .bar` → `:where([data-page="home"]) .foo, :where([data-page="home"]) .bar`
 * Each individual selector that starts with `&` is replaced by the scope itself (Sass-like nesting).
 */
function scopeSelectorList(selectorList, scope) {
  const selectors = selectorList.split(',').map(s => s.trim()).filter(Boolean);
  if (selectors.length === 0) return scope;
  return selectors.map(sel => {
    if (sel === '&') return scope;
    if (sel.startsWith('&')) return sel.replace(/&/g, scope);
    return `${scope} ${sel}`;
  }).join(', ');
}

/**
 * Recursively process a CSS body (string of style rules + nested at-rules) by:
 *   - Wrapping top-level style rule selectors with `scope`
 *   - Recursing into @media / @supports / @container (their inner rules also get scoped)
 *   - Passing through @font-face / @keyframes / @property / @page / @layer verbatim
 */
function processBody(body, scope, indent = '') {
  const blocks = tokenizeTopLevel(body);
  const out = [];
  for (const block of blocks) {
    if (block.type === 'at-statement') {
      out.push(`${indent}${block.text}`);
      continue;
    }
    if (block.type === 'rule') {
      const scopedSel = scopeSelectorList(block.selector, scope);
      out.push(`${indent}${scopedSel} {${block.body}}`);
      continue;
    }
    if (block.type === 'at-rule') {
      const header = block.header;
      const atNameMatch = header.match(/^@([a-zA-Z-]+)/);
      const atName = atNameMatch ? atNameMatch[1].toLowerCase() : '';
      // At-rules that contain nested selectors — recurse with scope preserved
      if (atName === 'media' || atName === 'supports' || atName === 'container' || atName === 'layer') {
        // For @layer, only scope if the body contains style rules (not just layer names)
        if (atName === 'layer' && !block.body.includes('{')) {
          // @layer name; (statement) — already handled above
          out.push(`${indent}${header};`);
          continue;
        }
        // Strip trailing `{` from header if present (it shouldn't be, since we tokenized on `{`)
        const cleanHeader = header.replace(/\s*\{\s*$/, '').trim();
        const processedInner = processBody(block.body, scope, indent + '  ');
        out.push(`${indent}${cleanHeader} {`);
        out.push(processedInner);
        out.push(`${indent}}`);
        continue;
      }
      // At-rules that should be passed through verbatim (don't scope inner rules)
      // @font-face, @keyframes, @property, @page, @color-profile, @font-palette-values, @counter-style, @namespace
      out.push(`${indent}${header} {${block.body}}`);
      continue;
    }
  }
  return out.join('\n');
}

function scopeCss(css, pageSlug) {
  // Remove @import / @charset / @namespace statements (they can't live inside scoped CSS blocks
  // and we already inject them into globals.css unconditionally)
  // Actually we KEEP them — they're handled by processBody as at-statements.
  // The stripComments step below protects strings from accidental removal.
  const cleaned = stripComments(css);
  const scope = `:where([data-page="${pageSlug}"])`;
  return processBody(cleaned, scope);
}

function main() {
  const scopedResolved = scopeCss(resolvedCss, pageSlug);
  const scopedExtracted = extractedCss ? scopeCss(extractedCss, pageSlug) : '';

  let globalsContent = '';
  if (fs.existsSync(globalsPath)) {
    globalsContent = fs.readFileSync(globalsPath, 'utf-8');
  }

  // Marker comments so re-runs can replace instead of duplicate
  const startMarker = `/* === CLONE-WEBSITE MODE-FAITHFUL [${pageSlug}] START === */`;
  const endMarker = `/* === CLONE-WEBSITE MODE-FAITHFUL [${pageSlug}] END === */`;

  // Remove old injection block (if exists)
  const startMarkerRe = startMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const endMarkerRe = endMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${startMarkerRe}[\\s\\S]*?${endMarkerRe}\\s*`, 'g');
  let newGlobals = globalsContent.replace(re, '').trimEnd();

  // Compose injection block
  const injection = [
    '',
    startMarker,
    `/* Source: ${path.basename(resolvedCssPath)} — resolved CSS variables from clone Phase 1 */`,
    scopedResolved,
  ];
  if (scopedExtracted) {
    injection.push(
      '',
      `/* Source: ${path.basename(extractedCssPath)} — extracted <style> tags from clone Phase 1 */`,
      scopedExtracted,
    );
  }
  injection.push('', endMarker, '');

  newGlobals += '\n\n' + injection.join('\n');

  fs.mkdirSync(path.dirname(globalsPath), { recursive: true });
  fs.writeFileSync(globalsPath, newGlobals, 'utf-8');
  console.log(`✅ Injected ${pageSlug} CSS into ${globalsPath}`);
  console.log(`   Resolved CSS: ${(resolvedCss.length / 1024).toFixed(1)} KB`);
  if (extractedCss) {
    console.log(`   Extracted CSS: ${(extractedCss.length / 1024).toFixed(1)} KB`);
  }
  console.log(`   Total globals.css: ${(newGlobals.length / 1024).toFixed(1)} KB`);
  console.log(`\n💡 Next step: Add data-page="${pageSlug}" attribute to the <main> or root element of the page component.`);
}

main();
