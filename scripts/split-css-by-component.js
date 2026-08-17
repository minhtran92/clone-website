#!/usr/bin/env node
/**
 * split-css-by-component.js — Step 3b: Split CSS into per-component files
 * 
 * Maps CSS selectors to components by:
 * 1. Parsing CSS rules and their selectors
 * 2. Matching selectors against component class names / element types
 * 3. Writing per-component CSS files + a shared.css for unmatched rules
 * 
 * Usage:
 *   node split-css-by-component.js <css-file> <components-dir> <output-dir>
 *   node split-css-by-component.js clone-output/html-raw/extracted.css clone-output/components-raw clone-output/components-css
 */

const fs = require('fs');
const path = require('path');

function main() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error('Usage: node split-css-by-component.js <css-file> <components-dir> <output-dir>');
    process.exit(1);
  }

  const cssPath = path.resolve(args[0]);
  const componentsDir = path.resolve(args[1]);
  const outputDir = path.resolve(args[2]);

  if (!fs.existsSync(cssPath)) {
    console.error(`CSS file not found: ${cssPath}`);
    process.exit(1);
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const css = fs.readFileSync(cssPath, 'utf-8');

  // 1. Collect component class names from .tsx files
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
      m[1].split(/\s+/).forEach(c => {
        if (c && !c.startsWith('{')) classes.add(c);
      });
    }

    // Also extract class names from dangerouslySetInnerHTML (framer-xxx classes)
    const innerClassMatches = content.matchAll(/class="([^"]+)"/g);
    for (const m of innerClassMatches) {
      m[1].split(/\s+/).forEach(c => {
        if (c && c.startsWith('framer-')) classes.add(c);
      });
    }

    // Extract class names from CSS class references in inline styles
    const varMatches = content.matchAll(/var\(--([^,)]+)/g);
    for (const m of varMatches) {
      classes.add(`--${m[1]}`);
    }

    componentClasses[name] = [...classes];
  }

  console.log(`\n🎨 Splitting CSS by component...`);
  console.log(`   CSS source: ${css.length.toLocaleString()} chars`);
  console.log(`   Components: ${componentNames.length}`);
  for (const [name, classes] of Object.entries(componentClasses)) {
    console.log(`   ${name}: ${classes.length} class references`);
  }

  // 2. Parse CSS into rules
  const rules = parseCssRules(css);
  console.log(`   Parsed ${rules.length} CSS rules`);

  // 3. Map each rule to the best-matching component
  const componentCss = {};
  for (const name of componentNames) {
    componentCss[name] = [];
  }
  componentCss['shared'] = []; // For unmatched rules

  for (const rule of rules) {
    const matchedComponent = matchRuleToComponent(rule.selector, componentClasses);
    if (matchedComponent) {
      componentCss[matchedComponent].push(rule.text);
    } else {
      componentCss['shared'].push(rule.text);
    }
  }

  // 4. Write per-component CSS files
  let totalWritten = 0;
  for (const [name, rules] of Object.entries(componentCss)) {
    if (rules.length === 0) continue;

    const content = rules.join('\n\n');
    const filePath = path.join(outputDir, `${name}.css`);
    fs.writeFileSync(filePath, content, 'utf-8');
    totalWritten++;
    console.log(`   📄 ${name}.css — ${rules.length} rules, ${content.length.toLocaleString()} chars`);
  }

  // 5. Generate a component-css-map.json for reference
  const cssMap = {};
  for (const [name, rules] of Object.entries(componentCss)) {
    cssMap[name] = {
      ruleCount: rules.length,
      totalChars: rules.reduce((sum, r) => sum + r.length, 0),
    };
  }
  fs.writeFileSync(path.join(outputDir, 'css-map.json'), JSON.stringify(cssMap, null, 2), 'utf-8');

  console.log(`\n✅ CSS split complete! ${totalWritten} files in ${outputDir}/`);
  console.log('');
}

/**
 * Simple CSS rule parser — splits by } and extracts selector + body
 */
function parseCssRules(css) {
  const rules = [];
  
  // Remove comments
  let clean = css.replace(/\/\*[\s\S]*?\*\//g, '');

  // Split into rules (naive but works for most CSS)
  // Handle @media, @font-face, @keyframes as single blocks
  let pos = 0;
  while (pos < clean.length) {
    // Skip whitespace
    while (pos < clean.length && /\s/.test(clean[pos])) pos++;
    if (pos >= clean.length) break;

    // Check for at-rules
    if (clean[pos] === '@') {
      // Find the full at-rule block
      const start = pos;
      const atRuleName = clean.slice(pos).match(/^@[\w-]+/)?.[0] || '';
      
      if (atRuleName === '@font-face' || atRuleName === '@keyframes' || atRuleName === '@-webkit-keyframes') {
        // Find matching closing brace
        let depth = 0;
        let foundOpen = false;
        while (pos < clean.length) {
          if (clean[pos] === '{') { depth++; foundOpen = true; }
          if (clean[pos] === '}') depth--;
          if (foundOpen && depth === 0) {
            pos++;
            break;
          }
          pos++;
        }
        rules.push({
          selector: atRuleName,
          text: clean.slice(start, pos).trim(),
        });
        continue;
      }

      if (atRuleName === '@media') {
        // Find the full media block including nested rules
        const mediaStart = pos;
        let depth = 0;
        let foundOpen = false;
        while (pos < clean.length) {
          if (clean[pos] === '{') { depth++; foundOpen = true; }
          if (clean[pos] === '}') depth--;
          if (foundOpen && depth === 0) {
            pos++;
            break;
          }
          pos++;
        }
        // Store as a single block
        const mediaText = clean.slice(mediaStart, pos).trim();
        // Extract the media query as selector
        const mediaMatch = mediaText.match(/^(@media[^{]+)\{/);
        rules.push({
          selector: mediaMatch ? mediaMatch[1].trim() : '@media',
          text: mediaText,
        });
        continue;
      }

      // Other at-rules (import, charset, etc.) — skip to end of line/semicolon
      while (pos < clean.length && clean[pos] !== ';' && clean[pos] !== '{') pos++;
      if (pos < clean.length && clean[pos] === ';') {
        pos++;
        // Skip this at-rule
        continue;
      }
    }

    // Regular rule: selector { ... }
    const ruleStart = pos;
    
    // Find opening brace
    while (pos < clean.length && clean[pos] !== '{') pos++;
    if (pos >= clean.length) break;

    const selector = clean.slice(ruleStart, pos).trim();
    pos++; // skip {

    // Find closing brace
    const bodyStart = pos;
    let depth = 1;
    while (pos < clean.length && depth > 0) {
      if (clean[pos] === '{') depth++;
      if (clean[pos] === '}') depth--;
      pos++;
    }

    const body = clean.slice(bodyStart, pos - 1).trim();
    if (selector && body) {
      rules.push({
        selector,
        text: `${selector} {\n  ${body}\n}`,
      });
    }
  }

  return rules;
}

/**
 * Match a CSS selector to a component based on class name overlap
 */
function matchRuleToComponent(selector, componentClasses) {
  if (!selector || selector.startsWith('@')) return null;

  // Extract class names from selector
  const selectorClasses = [];
  const classMatches = selector.matchAll(/\.([\w-]+)/g);
  for (const m of classMatches) {
    selectorClasses.push(m[1]);
  }

  if (selectorClasses.length === 0) return null;

  // Score each component by number of matching classes
  let bestComponent = null;
  let bestScore = 0;

  for (const [name, classes] of Object.entries(componentClasses)) {
    let score = 0;
    for (const sc of selectorClasses) {
      if (classes.includes(sc)) {
        score += sc.length; // Longer class names = more specific = higher score
      }
      // Also check prefix match (framer-xxx variants)
      if (sc.startsWith('framer-') && classes.some(c => c.startsWith('framer-') && c.length > 5)) {
        score += 1; // Small bonus for framer class overlap
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestComponent = name;
    }
  }

  // Only return a match if score is significant
  return bestScore >= 5 ? bestComponent : null;
}

main();
