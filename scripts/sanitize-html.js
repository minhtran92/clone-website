#!/usr/bin/env node
/**
 * sanitize-html.js — Pre-Step 3: Clean HTML for html2react compatibility
 * 
 * Removes <script>, complex inline JS, and other elements that
 * crash the older babylon parser inside html-to-react-components.
 * 
 * Usage:
 *   node sanitize-html.js <input.html> <output.html>
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node sanitize-html.js <input.html> <output.html>');
    process.exit(1);
  }

  const inputPath = path.resolve(args[0]);
  const outputPath = path.resolve(args[1]);

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const html = fs.readFileSync(inputPath, 'utf-8');
  const $ = cheerio.load(html, { xmlMode: false, decodeEntities: false });

  let removedCount = 0;

  // 1. Remove ALL <script> tags (they crash babylon parser)
  $('script').each((_, el) => {
    $(el).remove();
    removedCount++;
  });

  // 2. Remove <noscript> tags
  $('noscript').each((_, el) => {
    $(el).remove();
    removedCount++;
  });

  // 3. Remove inline event handlers (onclick, onload, etc.)
  const eventAttrs = [
    'onclick', 'onload', 'onerror', 'onmouseover', 'onmouseout',
    'onfocus', 'onblur', 'onsubmit', 'onchange', 'oninput',
    'onkeydown', 'onkeyup', 'onkeypress', 'onscroll', 'onresize',
  ];
  $('[onclick], [onload], [onerror]').each((_, el) => {
    eventAttrs.forEach(attr => {
      if ($(el).attr(attr)) {
        $(el).removeAttr(attr);
        removedCount++;
      }
    });
  });

  // 4. Remove <svg> content (keep the tag but clear inner - SVGs can have complex JS)
  $('svg').each((_, el) => {
    // Keep SVG but simplify - remove complex children
    const children = $(el).children();
    if (children.length > 20) {
      // Very complex SVG, just keep the opening tag
      $(el).empty();
      $(el).attr('data-svg-simplified', 'true');
      removedCount++;
    }
  });

  // 5. Remove <style> tags with @import or complex CSS
  $('style').each((_, el) => {
    const content = $(el).html() || '';
    // Keep simple styles, remove very complex ones
    if (content.length > 50000) {
      $(el).remove();
      removedCount++;
    }
  });

  // 6. Remove data: URIs in src attributes (base64 images etc. - can be huge)
  $('[src^="data:"]').each((_, el) => {
    $(el).removeAttr('src');
    removedCount++;
  });

  // 7. Remove framer-specific attributes that might cause issues
  const framerAttrs = [
    'data-framer', 'data-framer-name', 'data-framer-component-type',
    'data-framer-portal-id', 'data-framer-motion', 'data-testid',
  ];
  $('*').each((_, el) => {
    framerAttrs.forEach(attr => {
      if ($(el).attr(attr) !== undefined) {
        $(el).removeAttr(attr);
      }
    });
  });

  // 8. Remove elements with contenteditable
  $('[contenteditable]').each((_, el) => {
    $(el).removeAttr('contenteditable');
  });

  // 9. Clean up class names - Framer generates very long class names
  // Keep classes but trim if too long
  $('[class]').each((_, el) => {
    const cls = $(el).attr('class') || '';
    if (cls.length > 500) {
      // Keep first 10 classes only
      const trimmed = cls.split(/\s+/).slice(0, 10).join(' ');
      $(el).attr('class', trimmed);
      removedCount++;
    }
  });

  // 10. Remove <!-- comments --> that might contain JS
  // cheerio handles this automatically

  const sanitizedHtml = $.html();
  fs.writeFileSync(outputPath, sanitizedHtml, 'utf-8');

  console.log(`\n✅ Sanitized HTML written to: ${outputPath}`);
  console.log(`   Original size: ${html.length.toLocaleString()} chars`);
  console.log(`   Sanitized size: ${sanitizedHtml.length.toLocaleString()} chars`);
  console.log(`   Removed/modified: ${removedCount} items`);
  console.log('');
}

main();
