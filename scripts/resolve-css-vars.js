#!/usr/bin/env node
/**
 * resolve-css-vars.js — Step 1b: Resolve CSS variables to actual computed values
 * 
 * Framer/Webflow sites use CSS variables like:
 *   var(--token-d30ec737-b2b1-4799-8d32-14510e319882, rgb(255, 255, 227))
 * 
 * This script resolves them to their fallback values (or computed values from the page),
 * making the CSS self-contained and easier to convert to Tailwind.
 * 
 * Usage:
 *   node resolve-css-vars.js <css-file> <output-file> [tokens-json]
 *   node resolve-css-vars.js clone-output/html-raw/extracted.css clone-output/html-raw/resolved.css
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

  // Load computed CSS variable values if available
  let computedVars = {};
  if (tokensPath && fs.existsSync(tokensPath)) {
    try {
      const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
      computedVars = tokens.cssVars || {};
    } catch {}
  }

  // Pattern: var(--token-xxx, fallback-value)
  // Also: var(--extracted-xxx, var(--token-yyy, fallback))
  const varPattern = /var\((--[^,)]+)(?:\s*,\s*([^)]+))?\)/g;

  let resolved = css;
  let resolveCount = 0;
  let fallbackCount = 0;

  // Multi-pass resolution (handles nested var() references)
  for (let pass = 0; pass < 3; pass++) {
    resolved = resolved.replace(varPattern, (match, varName, fallback) => {
      // Check computed values first
      if (computedVars[varName]) {
        resolveCount++;
        return computedVars[varName];
      }
      
      // Use fallback value if available
      if (fallback) {
        fallbackCount++;
        // Recursively resolve nested var() in fallback
        return fallback.trim();
      }

      // No resolution possible — keep as-is
      return match;
    });
  }

  // Also resolve --framer-text-color and --extracted-* in inline styles
  // These are in the component HTML as: style="--framer-text-color: var(--token-xxx, rgb(...))"
  // After resolution, they become: style="--framer-text-color: rgb(...)"

  // Clean up remaining unresolved CSS vars that have no useful fallback
  // Replace with a comment noting they need manual resolution
  const stillUnresolved = (resolved.match(/var\(--[^,)]+\)/g) || []).length;

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  fs.writeFileSync(outputPath, resolved, 'utf-8');

  console.log(`\n🔧 CSS Variable Resolution:`);
  console.log(`   Input: ${css.length.toLocaleString()} chars`);
  console.log(`   Output: ${resolved.length.toLocaleString()} chars`);
  console.log(`   Resolved from computed: ${resolveCount}`);
  console.log(`   Resolved from fallback: ${fallbackCount}`);
  console.log(`   Still unresolved: ${stillUnresolved}`);
  console.log(`   ✅ Written to: ${outputPath}`);
  console.log('');
}

main();
