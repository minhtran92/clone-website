#!/usr/bin/env node
/**
 * annotate-html.js — Step 2 of the clone-website pipeline
 * 
 * Reads raw HTML, detects structural sections via cheerio,
 * injects data-component="ComponentName" attributes,
 * and writes the annotated HTML to output file.
 * 
 * Usage:
 *   node annotate-html.js <input.html> <output.html>
 *   node annotate-html.js clone-output/html-raw/page.html clone-output/html-annotated/page.annotated.html
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

// ── Pattern definitions ──
const PATTERNS = [
  // [selector, componentName, priority (lower = higher priority)]
  ['header', 'Header', 1],
  ['nav', 'Navbar', 2],
  ['nav[class*="nav"]', 'Navbar', 2],
  ['[class*="navbar"]', 'Navbar', 2],
  ['[class*="navigation"]', 'Navbar', 2],
  ['[class*="hero"]', 'HeroSection', 3],
  ['[class*="banner"]', 'Banner', 3],
  ['[class*="slider"]', 'HeroSlider', 4],
  ['[class*="carousel"]', 'Carousel', 4],
  ['[class*="feature"]', 'FeaturesGrid', 5],
  ['[class*="service"]', 'ServicesSection', 6],
  ['[class*="about"]', 'AboutSection', 7],
  ['[class*="team"]', 'TeamSection', 8],
  ['[class*="testimonial"]', 'Testimonials', 9],
  ['[class*="review"]', 'Reviews', 9],
  ['[class*="pricing"]', 'PricingSection', 10],
  ['[class*="plan"]', 'PricingSection', 10],
  ['[class*="cta"]', 'CTASection', 11],
  ['[class*="call-to-action"]', 'CTASection', 11],
  ['[class*="contact"]', 'ContactSection', 12],
  ['[class*="faq"]', 'FAQSection', 13],
  ['[class*="accordion"]', 'FAQSection', 13],
  ['[class*="stats"]', 'StatsSection', 14],
  ['[class*="counter"]', 'StatsSection', 14],
  ['[class*="blog"]', 'BlogSection', 15],
  ['[class*="post"]', 'BlogSection', 15],
  ['[class*="article"]', 'BlogSection', 15],
  ['[class*="gallery"]', 'Gallery', 16],
  ['[class*="portfolio"]', 'Gallery', 16],
  ['[class*="work"]', 'Gallery', 16],
  ['[class*="video"]', 'VideoSection', 17],
  ['[class*="map"]', 'MapSection', 18],
  ['[class*="sidebar"]', 'Sidebar', 19],
  ['[class*="logo"]', 'Logo', 20],
  ['footer', 'Footer', 21],
  ['[class*="footer"]', 'Footer', 21],
];

// ── Main ──
function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node annotate-html.js <input.html> <output.html>');
    process.exit(1);
  }

  const inputPath = path.resolve(args[0]);
  const outputPath = path.resolve(args[1]);

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const html = fs.readFileSync(inputPath, 'utf-8');
  const $ = cheerio.load(html);

  const detected = [];
  const usedNames = new Set();

  // 1. Pattern-based detection
  for (const [selector, name, priority] of PATTERNS) {
    if (usedNames.has(name)) continue;
    try {
      const elements = $(selector);
      if (elements.length > 0) {
        elements.first().attr('data-component', name);
        detected.push({ selector, name, priority, method: 'pattern' });
        usedNames.add(name);
      }
    } catch (e) {
      // Invalid selector, skip
    }
  }

  // 2. Section tags with id/class
  $('section[id], section[class]').each((i, el) => {
    const id = $(el).attr('id') || '';
    const cls = $(el).attr('class') || '';
    
    // Generate PascalCase name from id or class
    let name = '';
    if (id) {
      name = id
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())
        .replace(/\s/g, '');
    } else {
      // Try to extract meaningful name from first class
      const firstClass = cls.split(/\s+/).find(c => 
        !['section', 'container', 'wrapper', 'content', 'block', 'div'].includes(c.toLowerCase())
      );
      if (firstClass) {
        name = firstClass
          .replace(/[-_]/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase())
          .replace(/\s/g, '');
      }
    }
    
    if (name && !usedNames.has(name)) {
      // Don't overwrite existing data-component
      if (!$(el).attr('data-component')) {
        $(el).attr('data-component', name);
        detected.push({ 
          selector: id ? `section#${id}` : `section.${cls.split(' ')[0]}`, 
          name, 
          priority: 50 + i, 
          method: 'section-tag' 
        });
        usedNames.add(name);
      }
    }
  });

  // 3. Detect <main> if not already annotated
  if (!usedNames.has('MainContent')) {
    const main = $('main, [role="main"]');
    if (main.length > 0 && !main.attr('data-component')) {
      main.attr('data-component', 'MainContent');
      detected.push({ selector: 'main', name: 'MainContent', priority: 99, method: 'semantic' });
      usedNames.add('MainContent');
    }
  }

  // 4. Fallback: if nothing detected, wrap body
  if (detected.length === 0) {
    $('body').attr('data-component', 'PageRoot');
    detected.push({ selector: 'body', name: 'PageRoot', priority: 100, method: 'fallback' });
  }

  // Write output
  const annotatedHtml = $.html();
  fs.writeFileSync(outputPath, annotatedHtml, 'utf-8');

  // Report
  console.log(`\n✅ Annotated HTML written to: ${outputPath}`);
  console.log(`📋 Detected ${detected.length} components:\n`);
  detected
    .sort((a, b) => a.priority - b.priority)
    .forEach(d => {
      console.log(`   ${d.name.padEnd(20)} ← ${d.selector.padEnd(35)} (${d.method})`);
    });
  console.log('');
}

main();
