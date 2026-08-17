#!/usr/bin/env node
/**
 * extract-styles.js — Helper for Step 1
 * 
 * Extracts design tokens (colors, fonts, spacing patterns)
 * from an HTML file using cheerio. This is a simple static
 * analysis — for full computed styles, use agent-browser.
 * 
 * Usage:
 *   node extract-styles.js <input.html> [output.json]
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: node extract-styles.js <input.html> [output.json]');
    process.exit(1);
  }

  const inputPath = path.resolve(args[0]);
  const outputPath = args[1] ? path.resolve(args[1]) : null;

  const html = fs.readFileSync(inputPath, 'utf-8');
  const $ = cheerio.load(html);

  const tokens = {
    colors: new Set(),
    fonts: new Set(),
    classNames: new Set(),
    imageSources: [],
    linkHrefs: [],
    scriptSources: [],
  };

  // Extract inline styles
  $('[style]').each((_, el) => {
    const style = $(el).attr('style') || '';
    // Extract colors from inline styles
    const colorMatches = style.match(/(?:color|background|border-color|fill):\s*([^;]+)/gi);
    if (colorMatches) {
      colorMatches.forEach(m => {
        const val = m.replace(/^[^:]+:\s*/, '').trim();
        tokens.colors.add(val);
      });
    }
  });

  // Extract CSS from <style> tags
  $('style').each((_, el) => {
    const css = $(el).html() || '';
    // Extract color values from CSS
    const cssColors = css.match(/(?:color|background|border-color|fill):\s*([^;{}!]+)/gi);
    if (cssColors) {
      cssColors.forEach(m => {
        const val = m.replace(/^[^:]+:\s*/, '').trim();
        tokens.colors.add(val);
      });
    }
    // Extract font-family
    const fontMatches = css.match(/font-family:\s*([^;{}!]+)/gi);
    if (fontMatches) {
      fontMatches.forEach(m => {
        const val = m.replace(/^[^:]+:\s*/, '').trim();
        tokens.fonts.add(val);
      });
    }
  });

  // Extract class names
  $('[class]').each((_, el) => {
    const classes = ($(el).attr('class') || '').split(/\s+/);
    classes.forEach(c => {
      if (c.trim()) tokens.classNames.add(c.trim());
    });
  });

  // Extract images
  $('img').each((_, el) => {
    tokens.imageSources.push({
      src: $(el).attr('src') || '',
      alt: $(el).attr('alt') || '',
      width: $(el).attr('width'),
      height: $(el).attr('height'),
    });
  });

  // Extract links
  $('link[href]').each((_, el) => {
    const rel = $(el).attr('rel') || '';
    if (rel.includes('stylesheet') || rel.includes('icon') || rel.includes('font')) {
      tokens.linkHrefs.push({
        href: $(el).attr('href'),
        rel,
      });
    }
  });

  // Extract scripts
  $('script[src]').each((_, el) => {
    tokens.scriptSources.push($(el).attr('src'));
  });

  // Convert Sets to Arrays for JSON output
  const result = {
    colors: [...tokens.colors].filter(c => c && c !== 'inherit' && c !== 'transparent'),
    fonts: [...tokens.fonts],
    topClasses: [...tokens.classNames].slice(0, 100), // Top 100 classes
    totalClasses: tokens.classNames.size,
    images: tokens.imageSources.filter(i => i.src),
    links: tokens.linkHrefs,
    scripts: tokens.scriptSources,
    extractedAt: new Date().toISOString(),
  };

  const output = JSON.stringify(result, null, 2);

  if (outputPath) {
    fs.writeFileSync(outputPath, output, 'utf-8');
    console.log(`\n✅ Design tokens saved to: ${outputPath}`);
  }

  // Summary
  console.log(`\n📊 Design Token Summary:`);
  console.log(`   Colors:      ${result.colors.length}`);
  console.log(`   Fonts:       ${result.fonts.length}`);
  console.log(`   Classes:     ${result.totalClasses}`);
  console.log(`   Images:      ${result.images.length}`);
  console.log(`   Stylesheets: ${result.links.length}`);
  console.log(`   Scripts:     ${result.scripts.length}`);
  console.log('');
}

main();
