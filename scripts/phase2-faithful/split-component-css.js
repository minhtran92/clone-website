#!/usr/bin/env node
/**
 * split-component-css.js — Option 1: Per-component PLAIN CSS + small globals
 *
 * THAY THẾ split-css-modules.js + inject-resolved-css.js (gộp 2 bước → 1).
 *
 * Vấn đề cũ: inject-resolved-css.js dump TOÀN BỘ resolved.css (200-500KB)
 *   + extracted.css (100-300KB) của mỗi page vào 1 cục globals.css →
 *   vài MB → Turbopack/SWC OOM, HMR treo. Đồng thời split-css-modules.js
 *   viết .module.css (hash tên) nhưng component vẫn dùng className literal
 *   → CSS Module import vô tác dụng → code chết.
 *
 * Giải pháp Option 1:
 *   - Viết per-component .css THUẦN (giữ selector literal → fidelity 1:1,
 *     Framer JS tìm đúng class → animation chạy đúng)
 *   - Tách chỉ các quy tắc GLOBAL thật (:root, @font-face, @keyframes,
 *     html/body/* reset) → merge vào src/app/globals.css (nhỏ, < ~40KB)
 *   - Các rule có class nhưng không match component nào → shared.css
 *   - KHÔNG dump toàn bộ CSS vào globals → hết OOM, HMR nhanh
 *
 * Output:
 *   {outputDir}/{ComponentName}.css    ← per-component plain CSS (literal selectors)
 *   {outputDir}/shared.css             ← unmatched classed rules
 *   src/app/globals.css                ← global fragment (:root vars, @keyframes,
 *                                         @font-face, html/body/* reset) — idempotent
 *
 * Usage:
 *   node split-component-css.js <css-file> <components-dir> <output-dir>
 *     [--globals <path>] [--page <slug>] [--tokens <tokens.json>] [--shared <shared.css>]
 *
 * Examples:
 *   node split-component-css.js clone-output/pages/home/html-raw/extracted.css \
 *     clone-output/pages/home/components-raw \
 *     src/components/pages/home \
 *     --globals src/app/globals.css --page home \
 *     --tokens clone-output/pages/home/html-raw/design-tokens.json
 */

const fs = require('fs');
const path = require('path');

function main() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error(`Usage: node split-component-css.js <css-file|css-dir> <components-dir> <output-dir> [--globals <path>] [--page <slug>] [--tokens <tokens.json>] [--shared <shared.css>]

Examples:
  node split-component-css.js clone-output/pages/home/html-raw/extracted.css \\
    clone-output/pages/home/components-raw \\
    src/components/pages/home \\
    --globals src/app/globals.css --page home \\
    --tokens clone-output/pages/home/html-raw/design-tokens.json
`);
    process.exit(1);
  }

  const cssInput = path.resolve(args[0]);
  const componentsDir = path.resolve(args[1]);
  const outputDir = path.resolve(args[2]);
  const globalsIdx = args.indexOf('--globals');
  const pageIdx = args.indexOf('--page');
  const tokensIdx = args.indexOf('--tokens');
  const sharedIdx = args.indexOf('--shared');

  const globalsPath = globalsIdx > -1 && args.length > globalsIdx + 1
    ? path.resolve(args[globalsIdx + 1]) : null;
  const pageSlug = pageIdx > -1 && args.length > pageIdx + 1 ? args[pageIdx + 1] : 'unknown';
  const tokensPath = tokensIdx > -1 && args.length > tokensIdx + 1
    ? path.resolve(args[tokensIdx + 1]) : null;
  const sharedPath = sharedIdx > -1 && args.length > sharedIdx + 1
    ? path.resolve(args[sharedIdx + 1]) : path.join(outputDir, 'shared.css');

  if (!fs.existsSync(cssInput)) {
    console.error(`✖ CSS input not found: ${cssInput}`);
    process.exit(1);
  }
  if (!fs.existsSync(componentsDir)) {
    console.error(`✖ Components dir not found: ${componentsDir}`);
    process.exit(1);
  }
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  console.log(`\n🎨 Option 1: Splitting CSS into per-component PLAIN .css + small globals`);
  console.log(`   Page: ${pageSlug}`);

  // ─── 1. Load all CSS (from file or dir) ────────────────────────────
  let allCss = '';
  if (fs.statSync(cssInput).isDirectory()) {
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, f.name);
        if (f.isDirectory()) walk(full);
        else if (/\.css$/.test(f.name)) allCss += fs.readFileSync(full, 'utf-8') + '\n\n';
      }
    };
    walk(cssInput);
  } else {
    allCss = fs.readFileSync(cssInput, 'utf-8');
  }
  console.log(`   CSS source: ${allCss.length.toLocaleString()} chars`);

  // ─── 2. Collect component class names from .tsx skeletons ──────────
  // Skeletons embed original HTML in dangerouslySetInnerHTML={{ __html: `...` }}
  // so className="..." (outer wrapper) + class="..." (inner HTML) both appear.
  const componentClasses = {};
  const componentNames = [];
  const tscFiles = fs.readdirSync(componentsDir).filter(f => f.endsWith('.tsx') && f !== 'Page.tsx' && f !== 'PageFaithful.tsx');
  for (const file of tscFiles) {
    const content = fs.readFileSync(path.join(componentsDir, file), 'utf-8');
    const name = file.replace('.tsx', '');
    componentNames.push(name);

    const classes = new Set();
    // JSX className="..." (outer wrapper tag)
    for (const m of content.matchAll(/className="([^"]+)"/g)) {
      m[1].split(/\s+/).forEach(c => { if (c && !c.startsWith('{')) classes.add(c); });
    }
    // inner HTML class="..." (framer-xxx etc.)
    for (const m of content.matchAll(/class="([^"]+)"/g)) {
      m[1].split(/\s+/).forEach(c => { if (c && (c.startsWith('framer-') || c.length > 5)) classes.add(c); });
    }
    componentClasses[name] = [...classes];
  }

  console.log(`   Components: ${componentNames.length}`);
  for (const [name, classes] of Object.entries(componentClasses)) {
    console.log(`   ${name}: ${classes.length} class refs`);
  }

  // ─── 3. Parse CSS into top-level blocks (robust tokenizer) ───────
  const cleanedCss = stripComments(allCss);
  const blocks = tokenizeTopLevel(cleanedCss);
  console.log(`   Parsed ${blocks.length} top-level blocks`);

  // ─── 4. Classify each block → global / shared / componentName ─────
  const buckets = { global: [], shared: [] };
  for (const name of componentNames) buckets[name] = [];

  let globalCount = 0, sharedCount = 0;
  const compCounts = {};
  for (const name of componentNames) compCounts[name] = 0;

  for (const block of blocks) {
    routeBlock(block, buckets, componentClasses, componentNames);
  }

  for (const name of componentNames) globalCount += 0; // placeholder
  for (const name of componentNames) compCounts[name] = buckets[name].length;
  globalCount = buckets.global.length;
  sharedCount = buckets.shared.length;

  // ─── 5. Write per-component .css (PLAIN, literal selectors) ──────
  let totalWritten = 0;
  let totalRulesWritten = 0;
  for (const name of componentNames) {
    const rules = buckets[name];
    if (rules.length === 0) continue;
    const content = rules.join('\n\n') + '\n';
    const filePath = path.join(outputDir, `${name}.css`);
    fs.writeFileSync(filePath, content, 'utf-8');
    totalWritten++;
    totalRulesWritten += rules.length;
    console.log(`   📄 ${name}.css — ${rules.length} rules, ${(content.length / 1024).toFixed(1)} KB`);
  }

  // shared.css (unmatched classed rules)
  if (buckets.shared.length > 0) {
    const content = buckets.shared.join('\n\n') + '\n';
    fs.writeFileSync(sharedPath, content, 'utf-8');
    totalWritten++;
    totalRulesWritten += buckets.shared.length;
    console.log(`   📄 ${path.basename(sharedPath)} — ${buckets.shared.length} rules, ${(content.length / 1024).toFixed(1)} KB`);
  }

  // ─── 6. Merge global fragment into src/app/globals.css ───────────
  // Only :root vars, @font-face, @keyframes, html/body/* resets.
  // Idempotent: marker comments per page allow re-runs to replace, not duplicate.
  let mergedGlobalsSize = 0;
  if (globalsPath) {
    let globalContent = buckets.global.join('\n\n');

    // Prepend :root block from design-tokens.json (cssVars) — preserves dynamic theming
    let cssVarsBlock = '';
    if (tokensPath && fs.existsSync(tokensPath)) {
      try {
        const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
        const cssVars = tokens.cssVars || {};
        const varEntries = Object.entries(cssVars);
        if (varEntries.length > 0) {
          cssVarsBlock = `:root {\n${varEntries.map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}\n`;
          console.log(`   🔑 F2: ${varEntries.length} CSS vars → :root block from design-tokens.json`);
        }
      } catch (e) {
        console.warn(`   ⚠️  Failed to parse tokens JSON: ${e.message}`);
      }
    }

    const fragment = (cssVarsBlock ? cssVarsBlock + '\n' : '') + globalContent + '\n';

    // Read existing globals (if any)
    let existing = '';
    if (fs.existsSync(globalsPath)) {
      existing = fs.readFileSync(globalsPath, 'utf-8');
    } else {
      // Seed a minimal globals.css with Tailwind directives if file doesn't exist
      existing = `@import "tailwindcss";

/* === CLONE-WEBSITE MODE-FAITHFUL GLOBALS === */
`;
    }

    // Idempotent: replace this page's previous fragment (between markers)
    const startMarker = `/* === CLONE-WEBSITE [${pageSlug}] GLOBALS START === */`;
    const endMarker = `/* === CLONE-WEBSITE [${pageSlug}] GLOBALS END === */`;
    const startRe = startMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const endRe = endMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${startRe}[\\s\\S]*?${endRe}\\s*`, 'g');
    let newGlobals = existing.replace(re, '').trimEnd();

    // Framer layout hints — normally applied at runtime by Framer's JS.
    // data-framer-layout-hint-center-x → translateX(-50%) (centers horizontally)
    // data-framer-layout-hint-center-y → translateY(-50%) (centers vertically)
    // Without the runtime, these transforms are never set → centered elements
    // (like the sticky nav) shift to the right/bottom. We replicate the behavior
    // with static CSS so the layout is correct without Framer runtime.
    const framerLayoutHintsCss = `/* Framer layout hints — normally applied by Framer runtime JS (replicated here) */
[data-framer-layout-hint-center-x="true"] { transform: translateX(-50%); }
[data-framer-layout-hint-center-y="true"] { transform: translateY(-50%); }
[data-framer-layout-hint-center-x="true"][data-framer-layout-hint-center-y="true"] { transform: translate(-50%, -50%); }
`;

    const injection = [
      '',
      startMarker,
      `/* Global-only fragment (:root vars, @font-face, @keyframes, html/body/* reset)`,
      `    — per-component CSS lives in src/components/pages/${pageSlug}/*.css (Option 1) */`,
      framerLayoutHintsCss,
      fragment.trimEnd(),
      endMarker,
      '',
    ].join('\n');

    newGlobals += '\n\n' + injection;

    fs.mkdirSync(path.dirname(globalsPath), { recursive: true });
    fs.writeFileSync(globalsPath, newGlobals, 'utf-8');
    mergedGlobalsSize = newGlobals.length;
  }

  // ─── 7. Write css-map.json (manifest) ─────────────────────────────
  const cssMap = {};
  for (const name of componentNames) {
    cssMap[name] = { ruleCount: buckets[name].length };
  }
  cssMap['shared'] = { ruleCount: buckets.shared.length };
  cssMap['global'] = { ruleCount: buckets.global.length };
  fs.writeFileSync(path.join(outputDir, 'css-map.json'), JSON.stringify(cssMap, null, 2), 'utf-8');

  console.log(`\n✅ Option 1 CSS split complete!`);
  console.log(`   ${totalWritten} .css files written (${totalRulesWritten} component/shared rules)`);
  console.log(`   Global fragment: ${buckets.global.length} rules → ${globalsPath ? path.basename(globalsPath) : '(not written)'}`);
  if (globalsPath && fs.existsSync(globalsPath)) {
    console.log(`   ${path.basename(globalsPath)} total size: ${(fs.statSync(globalsPath).size / 1024).toFixed(1)} KB (should be small — no per-page blob)`);
  }
  console.log(`\n   💡 Components import their own CSS: import './Header.css'  (literal class names → fidelity 1:1)`);
  console.log(`   💡 shared.css (if any) should be imported in page.tsx`);
  console.log('');
}

// =====================================================================
// CSS Tokenizer — top-level blocks (handles @media/@supports/@container
// nesting, @font-face, @keyframes, @import statements, regular rules)
// =====================================================================

function stripComments(css) {
  let out = '';
  let i = 0;
  let inString = null;
  while (i < css.length) {
    const c = css[i];
    if (inString) {
      out += c;
      if (c === '\\' && i + 1 < css.length) { out += css[i + 1]; i += 2; continue; }
      if (c === inString) inString = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") { inString = c; out += c; i++; continue; }
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
        if (c === '\\' && i + 1 < n) { prelude += css[i + 1]; i += 2; continue; }
        if (c === inString) inString = null;
        i++;
        continue;
      }
      if (c === '"' || c === "'") { inString = c; prelude += c; i++; continue; }
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
    if (i >= n) { blocks.push({ type: 'at-statement', text: prelude }); break; }
    if (css[i] === ';') continue;

    i++; // skip `{`
    let body = '';
    let depth = 1;
    while (i < n && depth > 0) {
      const c = css[i];
      if (inString) {
        body += c;
        if (c === '\\' && i + 1 < n) { body += css[i + 1]; i += 2; continue; }
        if (c === inString) inString = null;
        i++;
        continue;
      }
      if (c === '"' || c === "'") { inString = c; body += c; i++; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
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

// =====================================================================
// Classifier — route a block into global / shared / componentName
// =====================================================================

function routeBlock(block, buckets, componentClasses, componentNames) {
  if (block.type === 'at-statement') {
    // @import, @charset, @namespace, @layer-name; → global
    buckets.global.push(block.text);
    return;
  }

  if (block.type === 'at-rule') {
    const atNameMatch = block.header.match(/^@([a-zA-Z-]+)/);
    const atName = atNameMatch ? atNameMatch[1].toLowerCase() : '';

    // Global at-rules
    if (atName === 'font-face' || atName === 'keyframes' || atName === '-webkit-keyframes'
        || atName === 'property' || atName === 'page' || atName === 'charset' || atName === 'namespace') {
      buckets.global.push(`${block.header} {${block.body}}`);
      return;
    }

    // @layer statement (no body) → global
    if (atName === 'layer' && !block.body.includes('{')) {
      buckets.global.push(`${block.header};`);
      return;
    }

    // Nestable containers: @media / @supports / @container / @layer{...}
    if (atName === 'media' || atName === 'supports' || atName === 'container' || atName === 'layer') {
      const cleanHeader = block.header.replace(/\s*\{\s*$/, '').trim();
      // Recurse: classify inner rules, group by target
      const innerBlocks = tokenizeTopLevel(block.body);
      const innerByTarget = { global: [], shared: [] };
      for (const name of componentNames) innerByTarget[name] = [];
      for (const inner of innerBlocks) {
        routeBlock(inner, innerByTarget, componentClasses, componentNames);
      }
      // Emit one @media block per non-empty target
      const emit = (target, arr) => {
        if (arr.length === 0) return;
        const body = arr.join('\n');
        buckets[target].push(`${cleanHeader} {\n${body}\n}`);
      };
      emit('global', innerByTarget.global);
      emit('shared', innerByTarget.shared);
      for (const name of componentNames) emit(name, innerByTarget[name]);
      return;
    }

    // Unknown at-rule → global (safe default)
    buckets.global.push(`${block.header} {${block.body}}`);
    return;
  }

  if (block.type === 'rule') {
    const sel = block.selector;
    const parts = sel.split(',').map(s => s.trim()).filter(Boolean);

    // GLOBAL: every comma-part is a tag/universal/attribute/pseudo (no .class, no #id)
    const isAllGlobal = parts.length > 0 && parts.every(p => !/[.#]/.test(p));
    if (isAllGlobal) {
      buckets.global.push(`${sel} {${block.body}}`);
      return;
    }

    // Class-targeted: match to component (best score) or fall to shared
    const matched = matchRuleToComponent(sel, componentClasses);
    if (matched) {
      buckets[matched].push(`${sel} {${block.body}}`);
    } else {
      buckets.shared.push(`${sel} {${block.body}}`);
    }
    return;
  }
}

function matchRuleToComponent(selector, componentClasses) {
  if (!selector || selector.startsWith('@')) return null;

  const selectorClasses = [];
  for (const m of selector.matchAll(/\.([\w-]+)/g)) selectorClasses.push(m[1]);
  if (selectorClasses.length === 0) return null;

  let bestComponent = null;
  let bestScore = 0;
  for (const [name, classes] of Object.entries(componentClasses)) {
    let score = 0;
    for (const sc of selectorClasses) {
      if (classes.includes(sc)) score += sc.length;
      if (sc.startsWith('framer-') && classes.some(c => c.startsWith('framer-') && c.length > 5)) {
        score += 1;
      }
    }
    if (score > bestScore) { bestScore = score; bestComponent = name; }
  }
  return bestScore >= 5 ? bestComponent : null;
}

main();
