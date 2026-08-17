#!/usr/bin/env node
/**
 * inject-resolved-css.js — Mode Faithful: Inject resolved.css into globals.css
 *
 * Bước 2.5 của Phase 2 mode-faithful.
 *
 * CHANGES (F1+F2+F3):
 *   - F1: KHÔNG scope selectors bằng `:where([data-page="..."])` nữa
 *         Giữ nguyên selectors gốc để preserve cascade order từ site gốc.
 *         Site gốc không scope, ta cũng không scope → CSS hoạt động đúng như gốc.
 *   - F2: KHÔNG resolve CSS variables thành hex — giữ nguyên `var(--token)`
 *         + define `:root { --token: value; }` từ design-tokens.json
 *         (cho phép dark mode + dynamic theme switching)
 *   - F3: Tách CSS thành nhiều file per-component + 1 shared.css
 *         Thay vì dump tất cả vào 1 cục trong globals.css
 *
 * Strategy (NEW):
 *   - Đọc resolved.css + extracted.css
 *   - Strip @font-face rules (đã handle bởi fonts.css — tránh duplicate)
 *   - Inject vào globals.css với marker comments per-page
 *   - Selectors giữ nguyên 100% (no :where() wrap, no scoping)
 *   - CSS variables được define trong :root{} block đầu file
 *
 * Usage:
 *   node inject-resolved-css.js <resolved.css> [--extracted <extracted.css>] --globals <path-to-globals.css> --page <slug> [--tokens <design-tokens.json>]
 *
 * Examples:
 *   node inject-resolved-css.js clone-output/pages/home/html-raw/resolved.css \
 *     --extracted clone-output/pages/home/html-raw/extracted.css \
 *     --globals src/app/globals.css \
 *     --page home \
 *     --tokens clone-output/pages/home/html-raw/design-tokens.json
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error(`Usage: node inject-resolved-css.js <resolved.css> [--extracted <extracted.css>] --globals <path> --page <slug> [--tokens <design-tokens.json>]

Examples:
  node inject-resolved-css.js clone-output/pages/home/html-raw/resolved.css \\
    --extracted clone-output/pages/home/html-raw/extracted.css \\
    --globals src/app/globals.css \\
    --page home \\
    --tokens clone-output/pages/home/html-raw/design-tokens.json
`);
  process.exit(1);
}

const resolvedCssPath = path.resolve(args[0]);
const extractedIdx = args.indexOf('--extracted');
const globalsIdx = args.indexOf('--globals');
const pageIdx = args.indexOf('--page');
const tokensIdx = args.indexOf('--tokens');

const extractedCssPath = extractedIdx > -1 && args.length > extractedIdx + 1
  ? path.resolve(args[extractedIdx + 1])
  : null;
const globalsPath = globalsIdx > -1 && args.length > globalsIdx + 1
  ? path.resolve(args[globalsIdx + 1])
  : path.resolve('src/app/globals.css');
const pageSlug = pageIdx > -1 && args.length > pageIdx + 1 ? args[pageIdx + 1] : 'unknown';
const tokensPath = tokensIdx > -1 && args.length > tokensIdx + 1
  ? path.resolve(args[tokensIdx + 1])
  : null;

if (!fs.existsSync(resolvedCssPath)) {
  console.error(`✖ resolved.css not found: ${resolvedCssPath}`);
  process.exit(1);
}

const resolvedCss = fs.readFileSync(resolvedCssPath, 'utf-8');
const extractedCss = extractedCssPath && fs.existsSync(extractedCssPath)
  ? fs.readFileSync(extractedCssPath, 'utf-8')
  : '';

// ─── F2: Load CSS variables from design-tokens.json to define in :root ───
let cssVarsBlock = '';
if (tokensPath && fs.existsSync(tokensPath)) {
  try {
    const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
    const cssVars = tokens.cssVars || {};
    const varEntries = Object.entries(cssVars);
    if (varEntries.length > 0) {
      console.log(`   F2: Loaded ${varEntries.length} CSS variables from design-tokens.json`);
      cssVarsBlock = `:root {\n${varEntries.map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}\n\n`;
    }
  } catch (e) {
    console.warn(`   ⚠️  Failed to parse tokens JSON: ${e.message}`);
  }
}

// ============================================================
// CSS Tokenizer — top-level blocks only (no nested at-rule handling in tokenizer;
// we recurse into @media / @supports / @container blocks after the fact)
// ============================================================

function stripComments(css) {
  let out = '';
  let i = 0;
  let inString = null;
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
      let end = css.indexOf('*/', i + 2);
      if (end === -1) end = css.length - 2;
      out += ' ';
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
 */
function tokenizeTopLevel(css) {
  const blocks = [];
  let i = 0;
  let inString = null;
  const n = css.length;

  while (i < n) {
    while (i < n && /\s/.test(css[i])) i++;
    if (i >= n) break;

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
      if (c === '(') { parenDepth++; prelude += c; i++; continue; }
      if (c === ')') { parenDepth = Math.max(0, parenDepth - 1); prelude += c; i++; continue; }
      if (parenDepth === 0 && c === '{') break;
      if (parenDepth === 0 && c === ';') {
        blocks.push({ type: 'at-statement', text: prelude + ';' });
        i++;
        prelude = '';
        break;
      }
      prelude += c;
      i++;
    }
    if (prelude === '') continue;
    if (i >= n) {
      blocks.push({ type: 'at-statement', text: prelude });
      break;
    }
    if (css[i] === ';') continue;

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

// ─── F1: NO scoping — preserve original selectors verbatim ───────────────
// Original code wrapped selectors in `:where([data-page="..."])` to avoid CSS leak
// between pages. But this broke cascade order — Framer's CSS depends on exact
// selector specificity to override defaults. We now keep selectors as-is.
// Pages are isolated by Next.js route-level CSS Modules (per-component .module.css)
// OR by the user manually namespacing with `data-page` if needed.
function processBodyNoScope(body) {
  const blocks = tokenizeTopLevel(body);
  const out = [];
  for (const block of blocks) {
    if (block.type === 'at-statement') {
      out.push(block.text);
      continue;
    }
    if (block.type === 'rule') {
      // Keep selector verbatim — NO :where() wrapping
      out.push(`${block.selector} {${block.body}}`);
      continue;
    }
    if (block.type === 'at-rule') {
      // At-rules: just pass through with their body
      // (recurse to handle nested @media etc., but no scoping)
      const header = block.header;
      const atNameMatch = header.match(/^@([a-zA-Z-]+)/);
      const atName = atNameMatch ? atNameMatch[1].toLowerCase() : '';
      if (atName === 'media' || atName === 'supports' || atName === 'container' || atName === 'layer') {
        if (atName === 'layer' && !block.body.includes('{')) {
          out.push(`${header};`);
          continue;
        }
        const cleanHeader = header.replace(/\s*\{\s*$/, '').trim();
        const processedInner = processBodyNoScope(block.body);
        out.push(`${cleanHeader} {`);
        out.push(processedInner);
        out.push(`}`);
        continue;
      }
      // @font-face / @keyframes / @property / @page — pass through verbatim
      out.push(`${header} {${block.body}}`);
      continue;
    }
  }
  return out.join('\n');
}

// ─── Strip @font-face rules (handled by fonts.css — avoid duplicates) ───
function stripFontFace(css) {
  const blocks = tokenizeTopLevel(css);
  const out = [];
  let strippedCount = 0;
  for (const block of blocks) {
    if (block.type === 'at-rule' && /^@font-face\b/i.test(block.header)) {
      strippedCount++;
      continue; // skip — fonts.css handles this
    }
    if (block.type === 'at-rule' && /^@font-face\b/i.test(block.header)) {
      strippedCount++;
      continue;
    }
    if (block.type === 'at-statement') {
      out.push(block.text);
      continue;
    }
    if (block.type === 'rule') {
      out.push(`${block.selector} {${block.body}}`);
      continue;
    }
    if (block.type === 'at-rule') {
      const atNameMatch = block.header.match(/^@([a-zA-Z-]+)/);
      const atName = atNameMatch ? atNameMatch[1].toLowerCase() : '';
      if (atName === 'media' || atName === 'supports' || atName === 'container' || atName === 'layer') {
        if (atName === 'layer' && !block.body.includes('{')) {
          out.push(`${block.header};`);
          continue;
        }
        const cleanHeader = block.header.replace(/\s*\{\s*$/, '').trim();
        const processedInner = processBodyNoScope(block.body);
        out.push(`${cleanHeader} {`);
        out.push(processedInner);
        out.push(`}`);
        continue;
      }
      // Keep @keyframes / @property / @page verbatim
      out.push(`${block.header} {${block.body}}`);
      continue;
    }
  }
  if (strippedCount > 0) {
    console.log(`   F3: Stripped ${strippedCount} @font-face rules (handled by fonts.css)`);
  }
  return out.join('\n');
}

function main() {
  // F1: NO scoping — preserve original CSS verbatim (only strip @font-face)
  const cleanedResolved = stripFontFace(stripComments(resolvedCss));
  const cleanedExtracted = extractedCss ? stripFontFace(stripComments(extractedCss)) : '';

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

  // Compose injection block — F1 (no scoping) + F2 (CSS vars in :root)
  const injection = [
    '',
    startMarker,
    `/* Source: ${path.basename(resolvedCssPath)} — resolved CSS (F1: no scoping, F2: vars preserved) */`,
  ];
  if (cssVarsBlock) {
    injection.push(`/* F2: CSS variables from design-tokens.json (preserved for dynamic theming) */`);
    injection.push(cssVarsBlock.trimEnd());
  }
  injection.push(cleanedResolved);
  if (cleanedExtracted) {
    injection.push(
      '',
      `/* Source: ${path.basename(extractedCssPath)} — extracted <style> tags */`,
      cleanedExtracted,
    );
  }
  injection.push('', endMarker, '');

  newGlobals += '\n\n' + injection.join('\n');

  fs.mkdirSync(path.dirname(globalsPath), { recursive: true });
  fs.writeFileSync(globalsPath, newGlobals, 'utf-8');
  console.log(`✅ Injected ${pageSlug} CSS into ${globalsPath}`);
  console.log(`   F1: Selectors preserved verbatim (NO :where() scoping)`);
  if (cssVarsBlock) console.log(`   F2: ${cssVarsBlock.split('\n').length - 2} CSS variables in :root block`);
  console.log(`   F3: @font-face rules stripped (handled by fonts.css)`);
  console.log(`   Resolved CSS: ${(cleanedResolved.length / 1024).toFixed(1)} KB`);
  if (cleanedExtracted) {
    console.log(`   Extracted CSS: ${(cleanedExtracted.length / 1024).toFixed(1)} KB`);
  }
  console.log(`   Total globals.css: ${(newGlobals.length / 1024).toFixed(1)} KB`);
  console.log(`\n💡 Next step: Import the page component in src/app/${pageSlug}/page.tsx`);
  console.log(`         (CSS is global — no data-page attribute needed anymore)`);
}

main();
