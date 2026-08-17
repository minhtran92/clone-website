#!/usr/bin/env node
/**
 * resolve-css-vars.js — Step 1b: Resolve CSS variables (CHANGED — F2)
 *
 * F2 (NEW STRATEGY):
 *   OLD: Resolve `var(--token, fallback)` → fallback value (or computed value
 *        from design-tokens.json). This bakes in static values and breaks
 *        dynamic theming (dark mode, theme switching).
 *   NEW: KEEP `var(--token)` references in the CSS. Just extract the
 *        `:root { --token: value }` declarations from design-tokens.json
 *        and write them to a separate `tokens.css` file. The original CSS
 *        keeps its `var(--token)` references intact, and the tokens.css
 *        provides the runtime values via standard CSS custom properties.
 *
 *   This means:
 *     - CSS variables work exactly like in the original site
 *     - Dark mode / theme switching is preserved (just override `:root`)
 *     - Framer's CSS custom properties (data-framer-* etc.) still work
 *     - Smaller resolved.css (no var() expansion duplication)
 *
 * Output files:
 *   - <output-file> — original CSS with var() refs PRESERVED (no expansion)
 *   - <tokens-json> — design tokens JSON (with `cssVars` block updated
 *                     to include all custom properties from source CSS)
 *
 * Usage:
 *   node resolve-css-vars.js <css-file> <output-file> [tokens-json]
 */

const fs = require('fs');
const path = require('path');

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node resolve-css-vars.js <css-file> <output-file> [tokens-json]');
    process.exit(1);
  }

  const cssPath = path.resolve(args[0]);
  const outputPath = path.resolve(args[1]);
  const tokensPath = args[2] ? path.resolve(args[2]) : null;

  if (!fs.existsSync(cssPath)) {
    console.error(`CSS file not found: ${cssPath}`);
    process.exit(1);
  }

  const css = fs.readFileSync(cssPath, 'utf-8');

  // ─── F2: Load existing tokens (may have computed values from fetch-page.js) ───
  let computedVars = {};
  if (tokensPath && fs.existsSync(tokensPath)) {
    try {
      const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
      computedVars = tokens.cssVars || {};
    } catch {}
  }

  // ─── F2: Extract --token: value declarations from :root in source CSS ───
  // This preserves the original site's CSS variable definitions.
  // Pattern: :root { --foo: bar; --baz: qux; }
  const rootVarDecls = {};
  const rootBlockRe = /:root\s*\{([^}]*)\}/g;
  let m;
  while ((m = rootBlockRe.exec(css)) !== null) {
    const body = m[1];
    const decls = body.split(';').map(s => s.trim()).filter(Boolean);
    for (const decl of decls) {
      const colonIdx = decl.indexOf(':');
      if (colonIdx === -1) continue;
      const propName = decl.slice(0, colonIdx).trim();
      const value = decl.slice(colonIdx + 1).trim();
      if (propName.startsWith('--') && value) {
        rootVarDecls[propName] = value;
      }
    }
  }

  // ─── F2: Also scan for :where(:root), html, body with --vars ───
  // Some sites define vars on <html> or <body> instead of :root
  const htmlBodyVarRe = /(?:html|body)\s*\{([^}]*?--[a-zA-Z-]+[^}]*?)\}/g;
  while ((m = htmlBodyVarRe.exec(css)) !== null) {
    const body = m[1];
    const decls = body.split(';').map(s => s.trim()).filter(Boolean);
    for (const decl of decls) {
      const colonIdx = decl.indexOf(':');
      if (colonIdx === -1) continue;
      const propName = decl.slice(0, colonIdx).trim();
      const value = decl.slice(colonIdx + 1).trim();
      if (propName.startsWith('--') && value && !rootVarDecls[propName]) {
        rootVarDecls[propName] = value;
      }
    }
  }

  // Merge: prefer computed values (from browser) over static root decls
  const mergedVars = { ...rootVarDecls, ...computedVars };

  console.log(`\n🔧 CSS Variable Resolution (F2 — preserve var() refs):`);
  console.log(`   Input: ${css.length.toLocaleString()} chars`);
  console.log(`   Source CSS vars extracted from :root/html/body: ${Object.keys(rootVarDecls).length}`);
  console.log(`   Computed CSS vars (from design-tokens.json): ${Object.keys(computedVars).length}`);
  console.log(`   Merged total: ${Object.keys(mergedVars).length}`);

  // ─── F2: Output CSS with var() refs PRESERVED ───
  // We DON'T expand var(--token) anymore — keep them as-is.
  // Just write the original CSS verbatim (var refs preserved).
  fs.writeFileSync(outputPath, css, 'utf-8');
  console.log(`   ✅ CSS written (var refs preserved): ${outputPath}`);
  console.log(`   Output: ${css.length.toLocaleString()} chars (same as input — no expansion)`);

  // ─── F2: Write tokens.json with full cssVars map ───
  if (tokensPath) {
    let tokens = {};
    if (fs.existsSync(tokensPath)) {
      try { tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8')); } catch {}
    }
    tokens.cssVars = mergedVars;
    fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2), 'utf-8');
    console.log(`   ✅ Tokens updated: ${tokensPath}`);
    console.log(`   Now inject-resolved-css.js will define :root { --token: value } block from these`);
  }

  // ─── F2: Also write tokens.css file (the :root block) for direct <link> use ───
  const tokensCssPath = outputPath.replace(/\.css$/, '.tokens.css');
  const tokensCss = `:root {\n${Object.entries(mergedVars).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}\n`;
  fs.writeFileSync(tokensCssPath, tokensCss, 'utf-8');
  console.log(`   ✅ Tokens CSS (root block only): ${tokensCssPath}`);

  // Count remaining var() refs (informational only — they're intentional now)
  const remainingVarCount = (css.match(/var\(--[^,)]+/g) || []).length;
  console.log(`   ℹ️  ${remainingVarCount} var() references preserved (will resolve at runtime via :root tokens)`);
  console.log('');
}

main();
