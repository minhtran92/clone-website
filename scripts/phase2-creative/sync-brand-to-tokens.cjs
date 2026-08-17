#!/usr/bin/env node
/**
 * sync-brand-to-tokens.cjs
 *
 * Syncs brand-guidelines.md colors → design-tokens.json → design-tokens.css
 *
 * Usage:
 *   node sync-brand-to-tokens.cjs
 *   node sync-brand-to-tokens.cjs --dry-run
 *   node sync-brand-to-tokens.cjs --brand-file path/to/brand.md --tokens-file path/to/tokens.json --css-file path/to/tokens.css
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// CLI args
const brandIdx = process.argv.indexOf('--brand-file');
const tokensIdx = process.argv.indexOf('--tokens-file');
const cssIdx = process.argv.indexOf('--css-file');

// Paths (override-able via CLI for portability)
const BRAND_GUIDELINES = brandIdx > -1 && process.argv.length > brandIdx + 1
  ? process.argv[brandIdx + 1]
  : 'docs/brand-guidelines.md';
const DESIGN_TOKENS_JSON = tokensIdx > -1 && process.argv.length > tokensIdx + 1
  ? process.argv[tokensIdx + 1]
  : 'assets/design-tokens.json';
const DESIGN_TOKENS_CSS = cssIdx > -1 && process.argv.length > cssIdx + 1
  ? process.argv[cssIdx + 1]
  : 'assets/design-tokens.css';
// Generate-tokens script is in the same directory as this script (phase2-creative/)
const GENERATE_TOKENS_SCRIPT = path.resolve(__dirname, 'generate-tokens.cjs');

// Convert hex to HSL (hue, saturation, lightness) — returns [h(0-360), s(0-100), l(0-100)]
function hexToHsl(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length === 4) h = h.slice(1).split('').map(c => c + c).join(''); // #RGBA → RGB
  if (h.length === 8) h = h.slice(0, 6); // #RRGGBBAA → RGB
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h_ = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h_ = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
      case g: h_ = ((b - r) / d + 2) * 60; break;
      case b: h_ = ((r - g) / d + 4) * 60; break;
    }
  }
  return [Math.round(h_), Math.round(s * 100), Math.round(l * 100)];
}

// Convert HSL back to hex (preserves hue, allows lightness adjustment without desaturation)
function hslToHex(h, s, l) {
  l = Math.max(0, Math.min(100, l)) / 100;
  s = Math.max(0, Math.min(100, s)) / 100;
  h = ((h % 360) + 360) % 360 / 360;
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  const toHex = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/**
 * Generate a 50-900 color scale using HSL lightness adjustment (preserves hue + saturation).
 * This produces visually coherent shades unlike naive RGB brightness adjustment.
 */
function generateColorScale(baseHex, darkHex, lightHex) {
  const [h, s, baseL] = hexToHsl(baseHex);
  // Standard 50-900 lightness scale (Material/Tailwind-inspired)
  // 50 = very light, 900 = very dark
  const scale = {};
  const lightnessSteps = { 50: 96, 100: 90, 200: 80, 300: 70, 400: 60, 500: baseL, 600: 46, 700: 36, 800: 26, 900: 16 };
  for (const step of Object.keys(lightnessSteps)) {
    let l = lightnessSteps[step];
    let hex;
    // Use provided overrides if available
    if (step === '50' && lightHex) hex = lightHex.toUpperCase();
    else if (step === '100' && lightHex) hex = lightHex.toUpperCase();
    else if (step === '600' && darkHex) hex = darkHex.toUpperCase();
    else if (step === '700' && darkHex) hex = darkHex.toUpperCase();
    else hex = hslToHex(h, s, l);
    scale[step] = { "$value": hex, "$type": "color" };
  }
  return scale;
}

/**
 * @deprecated Use generateColorScale (HSL-based) instead. Kept for backwards compat.
 */
function adjustBrightness(hex, percent) {
  if (typeof hex !== 'string') return '#000000';
  const [h, s, baseL] = hexToHsl(hex);
  // percent is treated as a lightness delta — 0.9 = +90 lightness, -0.6 = -60 lightness
  const newL = Math.max(0, Math.min(100, baseL + percent * 100));
  return hslToHex(h, s, newL);
}

/**
 * Extract color info from brand guidelines markdown
 */
function extractColorsFromMarkdown(content) {
  const colors = {
    primary: { name: 'primary', shades: {} },
    secondary: { name: 'secondary', shades: {} },
    accent: { name: 'accent', shades: {} }
  };

  // Match a "| Label | #hex |" markdown table row. Bold around the label
  // (**Label**) is optional, so this handles both the bundled starter template
  // ("| Primary Blue | #2563EB |") and bolded variants.
  const rowRe = /\|\s*\*{0,2}([^*|]+?)\*{0,2}\s*\|\s*#([A-Fa-f0-9]{6})\b/g;

  // 1) Quick Reference table — hex only, no parenthesized name required.
  const quickRef = {
    primary: /Primary Color\s*\|\s*#([A-Fa-f0-9]{6})/i,
    secondary: /Secondary Color\s*\|\s*#([A-Fa-f0-9]{6})/i,
    accent: /Accent Color\s*\|\s*#([A-Fa-f0-9]{6})/i
  };
  for (const key of Object.keys(quickRef)) {
    const m = content.match(quickRef[key]);
    if (m) colors[key].base = `#${m[1]}`;
  }

  // 2) Dedicated "### <Role> Colors" tables — assign base/dark/light by the
  //    row label keyword.
  const assignFromSection = (heading, target) => {
    const section = content.match(new RegExp(`### ${heading}[\\s\\S]*?(?=\\n###|$)`, 'i'));
    if (!section) return;
    for (const m of section[0].matchAll(rowRe)) {
      const label = m[1].trim().toLowerCase();
      const hex = `#${m[2]}`;
      if (label.includes('dark')) target.dark = hex;
      else if (label.includes('light')) target.light = hex;
      else if (!target.base) target.base = hex;
    }
  };
  assignFromSection('Primary Colors', colors.primary);
  assignFromSection('Secondary Colors', colors.secondary);
  assignFromSection('Accent Colors', colors.accent);

  // 3) Fallback: an accent swatch may live in another table (the starter
  //    lists "Accent Green" under Secondary Colors).
  if (!colors.accent.base) {
    for (const m of content.matchAll(rowRe)) {
      if (m[1].trim().toLowerCase().includes('accent')) {
        colors.accent.base = `#${m[2]}`;
        break;
      }
    }
  }

  return colors;
}

/**
 * Generate color scale from base color (HSL-based, preserves hue)
 */

/**
 * Update design tokens JSON
 */
function updateDesignTokens(tokens, colors) {
  // Update brand name
  const brandName = `ClaudeKit Marketing - ${colors.primary.name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}`;
  tokens.brand = brandName;

  // Update primitive colors with new names
  tokens.primitive = tokens.primitive || {};
  const primitiveColors = tokens.primitive.color || {};

  // Remove old color keys, add new ones
  delete primitiveColors.coral;
  delete primitiveColors.purple;
  delete primitiveColors.mint;

  // Add new named colors. Skip any role with no base hex rather than crashing
  // on an unexpected guidelines format.
  for (const role of ['primary', 'secondary', 'accent']) {
    const c = colors[role];
    if (!c.base) {
      console.warn(`⚠️  No base hex found for ${role} color — skipping its token scale.`);
      continue;
    }
    primitiveColors[c.name] = generateColorScale(c.base, c.dark, c.light);
  }

  tokens.primitive.color = primitiveColors;

  // Update ALL semantic color references
  if (tokens.semantic?.color) {
    const sem = tokens.semantic.color;
    const p = colors.primary.name;
    const s = colors.secondary.name;
    const a = colors.accent.name;

    // Primary variants
    sem.primary = { "$value": `{primitive.color.${p}.500}`, "$type": "color" };
    sem['primary-hover'] = { "$value": `{primitive.color.${p}.600}`, "$type": "color" };
    sem['primary-active'] = { "$value": `{primitive.color.${p}.700}`, "$type": "color" };
    sem['primary-light'] = { "$value": `{primitive.color.${p}.400}`, "$type": "color" };
    sem['primary-lighter'] = { "$value": `{primitive.color.${p}.100}`, "$type": "color" };
    sem['primary-dark'] = { "$value": `{primitive.color.${p}.600}`, "$type": "color" };

    // Secondary variants
    sem.secondary = { "$value": `{primitive.color.${s}.500}`, "$type": "color" };
    sem['secondary-hover'] = { "$value": `{primitive.color.${s}.600}`, "$type": "color" };
    sem['secondary-light'] = { "$value": `{primitive.color.${s}.300}`, "$type": "color" };
    sem['secondary-dark'] = { "$value": `{primitive.color.${s}.600}`, "$type": "color" };

    // Accent variants
    sem.accent = { "$value": `{primitive.color.${a}.500}`, "$type": "color" };
    sem['accent-hover'] = { "$value": `{primitive.color.${a}.600}`, "$type": "color" };
    sem['accent-light'] = { "$value": `{primitive.color.${a}.300}`, "$type": "color" };

    // Status colors (use accent for success, primary for error/info)
    sem.success = { "$value": `{primitive.color.${a}.500}`, "$type": "color" };
    sem['success-light'] = { "$value": `{primitive.color.${a}.300}`, "$type": "color" };
    sem.error = { "$value": `{primitive.color.${p}.500}`, "$type": "color" };
    sem['error-light'] = { "$value": `{primitive.color.${p}.300}`, "$type": "color" };
    sem.info = { "$value": `{primitive.color.${s}.500}`, "$type": "color" };
    sem['info-light'] = { "$value": `{primitive.color.${s}.300}`, "$type": "color" };
  }

  // Update component references (button uses primary color with opacity)
  if (tokens.component?.button?.secondary && colors.primary.base) {
    const primaryBase = colors.primary.base;
    tokens.component.button.secondary['bg-hover'] = {
      "$value": `${primaryBase}1A`,
      "$type": "color"
    };
  }

  return tokens;
}

/**
 * Main
 */
function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('🔄 Syncing brand guidelines → design tokens\n');

  // Read brand guidelines
  const guidelinesPath = path.resolve(process.cwd(), BRAND_GUIDELINES);
  if (!fs.existsSync(guidelinesPath)) {
    console.error(`❌ Brand guidelines not found: ${guidelinesPath}`);
    process.exit(1);
  }
  const guidelinesContent = fs.readFileSync(guidelinesPath, 'utf-8');

  // Extract colors
  const colors = extractColorsFromMarkdown(guidelinesContent);
  console.log('📊 Extracted colors:');
  console.log(`   Primary: ${colors.primary.name} (${colors.primary.base})`);
  console.log(`   Secondary: ${colors.secondary.name} (${colors.secondary.base})`);
  console.log(`   Accent: ${colors.accent.name} (${colors.accent.base})\n`);

  // Read existing tokens
  const tokensPath = path.resolve(process.cwd(), DESIGN_TOKENS_JSON);
  let tokens = {};
  if (fs.existsSync(tokensPath)) {
    tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
  }

  // Update tokens
  tokens = updateDesignTokens(tokens, colors);

  if (dryRun) {
    console.log('📋 Would update design-tokens.json:');
    console.log(JSON.stringify(tokens.primitive.color, null, 2).slice(0, 500) + '...');
    console.log('\n⏭️  Dry run - no files changed');
    return;
  }

  // Write updated tokens
  fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2));
  console.log(`✅ Updated: ${DESIGN_TOKENS_JSON}`);

  // Regenerate CSS — GENERATE_TOKENS_SCRIPT is already absolute (via __dirname)
  const generateScript = GENERATE_TOKENS_SCRIPT;
  if (fs.existsSync(generateScript)) {
    try {
      // Pass absolute paths so the child process can find files regardless of cwd
      const absoluteTokens = path.resolve(process.cwd(), DESIGN_TOKENS_JSON);
      const absoluteCss = path.resolve(process.cwd(), DESIGN_TOKENS_CSS);
      execFileSync('node', [generateScript, '--config', absoluteTokens, '-o', absoluteCss], {
        cwd: process.cwd(),
        stdio: 'inherit'
      });
      console.log(`✅ Regenerated: ${DESIGN_TOKENS_CSS}`);
    } catch (e) {
      console.error('⚠️  Failed to regenerate CSS:', e.message);
    }
  } else {
    console.warn(`⚠️  generate-tokens.cjs not found at ${generateScript}. Skipping CSS regeneration.`);
  }

  console.log('\n✨ Brand sync complete!');
}

main();
