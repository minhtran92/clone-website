#!/usr/bin/env node
/**
 * split-css-modules.js — F3 + N7: Split CSS into per-component .module.css files
 *
 * F3: Tách 1 cục CSS thành nhiều file nhỏ per-component
 *   - Đọc extracted.css + resolved.css
 *   - Match CSS selectors với component class names
 *   - Mỗi component có file .module.css riêng
 *   - Các rule không match → shared.css
 *
 * N7: CSS Modules cho Next.js
 *   - File có đuôi .module.css được Next.js tự động xử lý as CSS Module
 *   - Class names được scoped tự động (hashed) → no leak giữa pages
 *   - Component import: `import styles from './Header.module.css'`
 *   - Class usage: `<header className={styles.header}>` (chuyển từ `className="header"`)
 *
 * Pipeline:
 *   1. Read extracted.css (từ clone Phase 1)
 *   2. Read components-raw/*.tsx (để lấy class names per component)
 *   3. Parse CSS rules
 *   4. Match each rule → component (by class name overlap)
 *   5. Write {ComponentName}.module.css per component
 *   6. Write shared.css cho unmatched rules
 *
 * Usage:
 *   node split-css-modules.js <css-file|css-dir> <components-dir> <output-dir> [--shared <shared.css>]
 *
 * Examples:
 *   node split-css-modules.js clone-output/pages/home/html-raw/extracted.css \
 *     clone-output/pages/home/components-raw \
 *     src/components/pages/home
 */

const fs = require('fs');
const path = require('path');

function main() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error(`Usage: node split-css-modules.js <css-file|css-dir> <components-dir> <output-dir> [--shared <shared.css>]

Examples:
  node split-css-modules.js clone-output/pages/home/html-raw/extracted.css \\
    clone-output/pages/home/components-raw \\
    src/components/pages/home
`);
    process.exit(1);
  }

  const cssInput = path.resolve(args[0]);
  const componentsDir = path.resolve(args[1]);
  const outputDir = path.resolve(args[2]);
  const sharedIdx = args.indexOf('--shared');
  const sharedPath = sharedIdx > -1 && args.length > sharedIdx + 1
    ? path.resolve(args[sharedIdx + 1])
    : path.join(outputDir, 'shared.module.css');

  if (!fs.existsSync(cssInput)) {
    console.error(`✖ CSS input not found: ${cssInput}`);
    process.exit(1);
  }
  if (!fs.existsSync(componentsDir)) {
    console.error(`✖ Components dir not found: ${componentsDir}`);
    process.exit(1);
  }
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

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
  console.log(`\n🎨 Splitting CSS into per-component .module.css files...`);
  console.log(`   CSS source: ${allCss.length.toLocaleString()} chars`);

  // ─── 2. Collect component class names from .tsx files ──────────────
  const componentClasses = {};
  const componentNames = [];
  const tscFiles = fs.readdirSync(componentsDir).filter(f => f.endsWith('.tsx') && f !== 'Page.tsx');
  for (const file of tscFiles) {
    const content = fs.readFileSync(path.join(componentsDir, file), 'utf-8');
    const name = file.replace('.tsx', '');
    componentNames.push(name);

    // Extract class names from className="..." attributes
    const classMatches = content.matchAll(/className="([^"]+)"/g);
    const classes = new Set();
    for (const m of classMatches) {
      m[1].split(/\s+/).forEach(c => { if (c && !c.startsWith('{')) classes.add(c); });
    }
    // Also extract from inner HTML's class="..." (framer-xxx classes)
    const innerClassMatches = content.matchAll(/class="([^"]+)"/g);
    for (const m of innerClassMatches) {
      m[1].split(/\s+/).forEach(c => { if (c && (c.startsWith('framer-') || c.length > 5)) classes.add(c); });
    }
    // Extract CSS vars referenced in the component
    const varMatches = content.matchAll(/var\(--([^,)]+)/g);
    for (const m of varMatches) classes.add(`--${m[1]}`);
    componentClasses[name] = [...classes];
  }

  console.log(`   Components: ${componentNames.length}`);
  for (const [name, classes] of Object.entries(componentClasses)) {
    console.log(`   ${name}: ${classes.length} class refs`);
  }

  // ─── 3. Parse CSS into rules ───────────────────────────────────────
  const rules = parseCssRules(allCss);
  console.log(`   Parsed ${rules.length} CSS rules`);

  // ─── 4. Match each rule → component ────────────────────────────────
  const componentCss = {};
  for (const name of componentNames) componentCss[name] = [];
  componentCss['shared'] = [];

  for (const rule of rules) {
    const matched = matchRuleToComponent(rule.selector, componentClasses);
    if (matched) {
      componentCss[matched].push(rule.text);
    } else {
      componentCss['shared'].push(rule.text);
    }
  }

  // ─── 5. Write per-component .module.css files ─────────────────────
  let totalWritten = 0;
  let totalRulesWritten = 0;
  for (const [name, rules] of Object.entries(componentCss)) {
    if (rules.length === 0) continue;
    const content = rules.join('\n\n');
    const filename = name === 'shared' ? 'shared.module.css' : `${name}.module.css`;
    const filePath = path.join(outputDir, filename);
    fs.writeFileSync(filePath, content, 'utf-8');
    totalWritten++;
    totalRulesWritten += rules.length;
    console.log(`   📄 ${filename} — ${rules.length} rules, ${(content.length / 1024).toFixed(1)} KB`);
  }

  // ─── 6. Write css-map.json ─────────────────────────────────────────
  const cssMap = {};
  for (const [name, rules] of Object.entries(componentCss)) {
    cssMap[name] = {
      ruleCount: rules.length,
      totalChars: rules.reduce((sum, r) => sum + r.length, 0),
    };
  }
  fs.writeFileSync(path.join(outputDir, 'css-map.json'), JSON.stringify(cssMap, null, 2), 'utf-8');

  console.log(`\n✅ CSS modules split complete!`);
  console.log(`   ${totalWritten} .module.css files written (${totalRulesWritten} rules total)`);
  console.log(`   Output dir: ${outputDir}/`);
  console.log(`\n   💡 Components can now import: import styles from './Header.module.css'`);
  console.log('');
}

// ─── CSS rule parser (handles @media, @font-face, @keyframes) ─────────
function parseCssRules(css) {
  const rules = [];
  let clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let pos = 0;
  while (pos < clean.length) {
    while (pos < clean.length && /\s/.test(clean[pos])) pos++;
    if (pos >= clean.length) break;

    if (clean[pos] === '@') {
      const start = pos;
      const atRuleName = clean.slice(pos).match(/^@[\w-]+/)?.[0] || '';

      if (atRuleName === '@font-face' || atRuleName === '@keyframes' || atRuleName === '@-webkit-keyframes') {
        let depth = 0;
        let foundOpen = false;
        while (pos < clean.length) {
          if (clean[pos] === '{') { depth++; foundOpen = true; }
          if (clean[pos] === '}') depth--;
          if (foundOpen && depth === 0) { pos++; break; }
          pos++;
        }
        rules.push({ selector: atRuleName, text: clean.slice(start, pos).trim() });
        continue;
      }

      if (atRuleName === '@media') {
        const mediaStart = pos;
        let depth = 0;
        let foundOpen = false;
        while (pos < clean.length) {
          if (clean[pos] === '{') { depth++; foundOpen = true; }
          if (clean[pos] === '}') depth--;
          if (foundOpen && depth === 0) { pos++; break; }
          pos++;
        }
        const mediaText = clean.slice(mediaStart, pos).trim();
        const mediaMatch = mediaText.match(/^(@media[^{]+)\{/);
        rules.push({
          selector: mediaMatch ? mediaMatch[1].trim() : '@media',
          text: mediaText,
        });
        continue;
      }

      // Other at-rules (@import, @charset) — skip
      while (pos < clean.length && clean[pos] !== ';' && clean[pos] !== '{') pos++;
      if (pos < clean.length && clean[pos] === ';') { pos++; continue; }
    }

    // Regular rule
    const ruleStart = pos;
    while (pos < clean.length && clean[pos] !== '{') pos++;
    if (pos >= clean.length) break;
    const selector = clean.slice(ruleStart, pos).trim();
    pos++;
    const bodyStart = pos;
    let depth = 1;
    while (pos < clean.length && depth > 0) {
      if (clean[pos] === '{') depth++;
      if (clean[pos] === '}') depth--;
      pos++;
    }
    const body = clean.slice(bodyStart, pos - 1).trim();
    if (selector && body) {
      rules.push({ selector, text: `${selector} {\n  ${body}\n}` });
    }
  }
  return rules;
}

function matchRuleToComponent(selector, componentClasses) {
  if (!selector || selector.startsWith('@')) return null;

  const selectorClasses = [];
  const classMatches = selector.matchAll(/\.([\w-]+)/g);
  for (const m of classMatches) selectorClasses.push(m[1]);
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
    if (score > bestScore) {
      bestScore = score;
      bestComponent = name;
    }
  }
  return bestScore >= 5 ? bestComponent : null;
}

main();
