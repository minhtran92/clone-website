#!/usr/bin/env node
/**
 * sanitize-html.js — Pre-Step 3: Clean HTML for html2react compatibility
 * 
 * Removes <script>, complex inline JS, and other elements that
 * crash the older babylon parser inside html-to-react-components.
 * 
 * ALSO (NEW):
 *   - N2: Strip <style data-framer-font-css> blocks (inline @font-face declarations).
 *     These duplicate the @font-face rules in extracted.css and bloat HTML by ~200KB/page.
 *     Fonts are handled by download-fonts.js → fonts.css (single source of truth).
 *   - N3: Strip Framer runtime <script> tags explicitly (Framer's main bundle, motion library).
 *     We already strip ALL <script> tags, but Framer's are particularly large (1MB+)
 *     and reference external CDN URLs that won't work in the cloned app anyway.
 *   - N6-preflight: Strip opacity:0 + transform:translateY(*) inline styles that
 *     would otherwise hide content permanently (since Framer runtime won't be ported
 *     to set them to opacity:1 on scroll-trigger). Real animation logic is added
 *     later by port-html-to-jsx.js (N6) + framer-motion component wrapping (N8).
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
  let strippedFontsChars = 0;
  let strippedFramerScripts = 0;
  let fixedHiddenElements = 0;

  // ─── N2: Strip inline <style data-framer-font-css> blocks ────────────────
  // These contain @font-face declarations duplicating extracted.css/fonts.css
  $('style[data-framer-font-css]').each((_, el) => {
    const content = $(el).html() || '';
    strippedFontsChars += content.length;
    $(el).remove();
  });
  // Also strip any <style> blocks that ONLY contain @font-face rules (no other CSS)
  $('style').each((_, el) => {
    const content = ($(el).html() || '').trim();
    if (content && /^@font-face\b/.test(content) && !content.match(/(^|\n)\s*[^@\s]/m)) {
      // Pure @font-face stylesheet — extract
      strippedFontsChars += content.length;
      $(el).remove();
    }
  });
  if (strippedFontsChars > 0) {
    console.log(`   N2: Stripped inline @font-face <style> blocks (${(strippedFontsChars / 1024).toFixed(1)} KB saved — handled by fonts.css)`);
  }

  // ─── N3: Strip Framer runtime <script> tags ─────────────────────────────
  // Framer's runtime JS is large (1MB+) and references external URLs that won't
  // work in the cloned app. The runtime is what hydrates Framer SSR HTML into
  // the visual state — but since we already captured HYDRATED DOM in fetch-page.js (N1),
  // we don't need the runtime anymore. We preserve the post-hydration DOM as-is.
  $('script').each((_, el) => {
    const src = $(el).attr('src') || '';
    const content = ($(el).html() || '').trim();
    // Identify Framer-specific scripts
    const isFramerScript = 
      src.includes('framerusercontent.com') ||
      src.includes('framer.com/') ||
      src.includes('framer/static') ||
      /framer/i.test(content.slice(0, 500)) ||
      // Framer runtime bundles typically have these markers
      content.includes('__framer') ||
      content.includes('Framer.');
    if (isFramerScript) {
      strippedFramerScripts++;
    }
    $(el).remove();
    removedCount++;
  });
  if (strippedFramerScripts > 0) {
    console.log(`   N3: Stripped ${strippedFramerScripts} Framer runtime <script> tags (we use captured hydrated DOM instead)`);
  }

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

  // 5. Remove <style> tags with @import or complex CSS (kept for non-font styles)
  $('style').each((_, el) => {
    const content = $(el).html() || '';
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

  // ─── N6-preflight: Strip opacity:0 + transform:translateY(*) ONLY when hidden ─
  // Framer sets these initial states, then Framer runtime JS animates them to
  // opacity:1 + transform:none on scroll-trigger. Without Framer runtime, the
  // elements would be stuck invisible forever.
  //
  // IMPORTANT (bug fix): only strip transform:translateY(*) (scroll-reveal hidden
  // state). Do NOT strip transform:translateX(*) — Framer uses translateX(-50%)
  // for LAYOUT positioning (e.g. centering the sticky nav). Stripping it breaks
  // the layout (nav shifts 300px right).
  //
  // ALSO only strip when the element is actually hidden (opacity:0 or opacity:0.001).
  // Elements with opacity:1 + transform:translateX(-50%) are already visible and
  // the transform is layout-critical — leave it alone.
  const HIDDEN_OPACITY = /opacity:\s*0(?:\.0+)?(?!\d)/; // opacity:0 / 0.0 / 0.00, not 0.5
  // translateY (NOT translateX) — scroll-reveal hidden state slides vertically
  const TRANSLATE_Y_PATTERN = /transform:\s*translateY\s*\([^)]*\)\s*;?/gi;
  $('*').each((_, el) => {
    const style = $(el).attr('style');
    if (!style) return;
    let newStyle = style;
    let changed = false;
    // Only strip transforms if the element is hidden (opacity:0)
    if (HIDDEN_OPACITY.test(newStyle)) {
      // Remove opacity:0
      newStyle = newStyle.replace(/opacity:\s*0(?:\.0+)?(?!\d)\s*;?/gi, '');
      changed = true;
      // Remove transform:translateY(*) only (NOT translateX — layout positioning)
      newStyle = newStyle.replace(TRANSLATE_Y_PATTERN, '');
    }
    if (changed) {
      newStyle = newStyle.trim().replace(/;\s*$/, '');
      if (newStyle) {
        $(el).attr('style', newStyle);
      } else {
        $(el).removeAttr('style');
      }
      fixedHiddenElements++;
    }
  });
  if (fixedHiddenElements > 0) {
    console.log(`   N6-preflight: Stripped opacity:0 + transform:translateY(*) (hidden elements only — translateX(-50%) layout centering preserved) from ${fixedHiddenElements} elements`);
  }

  // 7. Remove framer-specific attributes that might cause issues
  const framerAttrs = [
    'data-framer', 'data-framer-name', 'data-framer-component-type',
    'data-framer-portal-id', 'data-framer-motion', 'data-testid',
  ];
  // NOTE: We DO NOT strip data-framer-appear-id — port-html-to-jsx.js uses it (N8)
  // to wrap elements in Framer Motion for scroll-reveal animations.
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
  console.log(`   Saved: ${(html.length - sanitizedHtml.length).toLocaleString()} chars (${(((html.length - sanitizedHtml.length) / html.length) * 100).toFixed(1)}%)`);
  console.log(`   Removed/modified: ${removedCount} items`);
  if (strippedFontsChars > 0) console.log(`   Inline @font-face stripped: ${(strippedFontsChars / 1024).toFixed(1)} KB`);
  if (strippedFramerScripts > 0) console.log(`   Framer runtime scripts stripped: ${strippedFramerScripts}`);
  if (fixedHiddenElements > 0) console.log(`   Hidden-element styles fixed: ${fixedHiddenElements}`);
  console.log('');
}

main();
