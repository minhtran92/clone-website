#!/usr/bin/env node
/**
 * annotate-framer-extra.js — Enhanced annotation for Framer sites
 *
 * Framer generates obfuscated class names (framer-K1XWY), so the generic
 * pattern-based annotate-html.js only catches <footer>. This script:
 *   1. Reads the annotated HTML from Step 2
 *   2. Locates major Framer sections by heading text + known class names
 *   3. Injects data-component="..." attributes
 *
 * Usage: node annotate-framer-extra.js <input.html> <output.html>
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node annotate-framer-extra.js <input.html> <output.html>');
    process.exit(1);
  }

  const inputPath = path.resolve(args[0]);
  const outputPath = path.resolve(args[1]);

  const html = fs.readFileSync(inputPath, 'utf-8');
  const $ = cheerio.load(html);

  const detected = [];
  const usedNames = new Set();

  function annotate(selector, name, reason) {
    if (usedNames.has(name)) return;
    const el = $(selector).first();
    if (el.length === 0) return;
    // Don't overwrite if already has a meaningful data-component
    const existing = el.attr('data-component');
    if (existing && existing !== 'FramerK1XWY' && existing !== 'PageRoot') return;
    el.attr('data-component', name);
    detected.push({ selector, name, reason });
    usedNames.add(name);
  }

  // ── Navbar (top bar with "Studio Shadwell" logo + menu) ──
  // The first .framer-14t8ixy-container is the top navigation bar
  annotate('.framer-14t8ixy-container', 'Navbar', 'top nav container');

  // ── Hero (Studio Shadwell big text) ──
  // framer-0DjQh contains the h1 "Studio Shadwell" + studio description
  annotate('.framer-0DjQh', 'Hero', 'contains h1 Studio Shadwell');

  // ── Works section (h2/h1 "Works") ──
  // Look for an h1/h2 containing "Works" and wrap its ancestor section
  $('h1, h2, h3').each((_, el) => {
    const text = $(el).text().trim();
    if (text === 'Works' && !usedNames.has('WorksSection')) {
      // Walk up to find the Framer container/wrapper
      let parent = $(el);
      for (let i = 0; i < 8; i++) {
        const p = parent.parent();
        if (p.length === 0 || p.is('body')) break;
        const cls = p.attr('class') || '';
        // Find a framer-xxx-container or a framer-xxx wrapper that contains the works grid
        if (cls.includes('framer-') && (cls.includes('-container') || p.find('a[href*="/works/"]').length >= 2)) {
          if (!p.attr('data-component')) {
            p.attr('data-component', 'WorksSection');
            detected.push({ selector: 'works-h1-ancestor', name: 'WorksSection', reason: 'contains Works heading + works links' });
            usedNames.add('WorksSection');
          }
          break;
        }
        parent = p;
      }
    }
  });

  // ── Blog section (h1 "Blog") ──
  $('h1, h2, h3').each((_, el) => {
    const text = $(el).text().trim();
    if (text === 'Blog' && !usedNames.has('BlogSection')) {
      let parent = $(el);
      for (let i = 0; i < 8; i++) {
        const p = parent.parent();
        if (p.length === 0 || p.is('body')) break;
        const cls = p.attr('class') || '';
        if (cls.includes('framer-') && (cls.includes('-container') || p.find('a[href*="/blog/"]').length >= 2)) {
          if (!p.attr('data-component')) {
            p.attr('data-component', 'BlogSection');
            detected.push({ selector: 'blog-h1-ancestor', name: 'BlogSection', reason: 'contains Blog heading + blog links' });
            usedNames.add('BlogSection');
          }
          break;
        }
        parent = p;
      }
    }
  });

  // ── Contact section ──
  // framer-1mpkehu-container contains "Want to start a project or just say hello?"
  annotate('.framer-1mpkehu-container', 'ContactSection', 'contact details container');
  annotate('.framer-b84m7i-container', 'OfficeSection', 'office address container');

  // ── Footer (already annotated by Step 2, but ensure) ──
  annotate('footer.framer-8psyam', 'Footer', 'site footer');

  // ── Studio/About (h1 "Studio" - the about blurb) ──
  $('h1, h2, h3').each((_, el) => {
    const text = $(el).text().trim();
    if (text === 'Studio' && !usedNames.has('AboutSection')) {
      let parent = $(el);
      for (let i = 0; i < 8; i++) {
        const p = parent.parent();
        if (p.length === 0 || p.is('body')) break;
        const cls = p.attr('class') || '';
        if (cls.includes('framer-') && cls.includes('-container')) {
          if (!p.attr('data-component')) {
            p.attr('data-component', 'AboutSection');
            detected.push({ selector: 'studio-h1-ancestor', name: 'AboutSection', reason: 'about/Studio section' });
            usedNames.add('AboutSection');
          }
          break;
        }
        parent = p;
      }
    }
  });

  fs.writeFileSync(outputPath, $.html(), 'utf-8');

  console.log(`\n✅ Enhanced annotation written to: ${outputPath}`);
  console.log(`📋 ${detected.length} components added:\n`);
  detected.forEach(d => {
    console.log(`   ${d.name.padEnd(20)} ← ${d.selector.padEnd(35)} (${d.reason})`);
  });
  console.log('');
}

main();
