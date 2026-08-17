#!/usr/bin/env node
/**
 * crawl-pages.js — Step 0: Discover and fetch all pages from a website
 * 
 * Uses agent-browser to:
 * 1. Open the homepage
 * 2. Collect all internal links (same domain)
 * 3. Optionally visit linked pages to discover more links (depth-limited)
 * 4. Generate a sitemap with URLs grouped by type
 * 
 * Usage:
 *   node crawl-pages.js <url> [max-depth] [output-dir]
 *   node crawl-pages.js https://example.com 1 clone-output
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 30000, ...opts }).trim();
  } catch (e) {
    return null;
  }
}

function evalJson(expr) {
  const raw = run(`agent-browser eval "${expr.replace(/"/g, '\\"')}"`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {
    try { return JSON.parse(JSON.parse(raw)); } catch { return null; }
  }
}

function evalString(expr) {
  const raw = run(`agent-browser eval "${expr.replace(/"/g, '\\"')}"`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'string' ? parsed : String(parsed);
  } catch {
    return raw;
  }
}

/**
 * Classify a URL into a page type
 */
function classifyPage(url, linkText) {
  const u = new URL(url);
  const p = u.pathname;

  // Product pages
  if (p.includes('/shop/') || p.includes('/product/') || p.includes('/products/')) {
    return { type: 'product', category: 'products' };
  }
  // Category/listing pages
  if (p.includes('/categories/') || p.includes('/category/') || p.includes('/collection/')) {
    return { type: 'category', category: 'listings' };
  }
  // Blog/content pages
  if (p.includes('/blog/') || p.includes('/post/') || p.includes('/article/')) {
    return { type: 'blog', category: 'content' };
  }
  // Drops/campaigns
  if (p.includes('/latest-drops/') || p.includes('/drops/')) {
    return { type: 'drop-detail', category: 'campaigns' };
  }
  if (p.includes('/latest-drops') || p.includes('/drops')) {
    return { type: 'drops-list', category: 'campaigns' };
  }
  // Utility pages
  if (p.includes('/about') || p.includes('/contact') || p.includes('/faq')) {
    return { type: 'info', category: 'utility' };
  }
  if (p.includes('/wishlist') || p.includes('/cart') || p.includes('/checkout')) {
    return { type: 'ecommerce', category: 'utility' };
  }
  if (p.includes('/sale') || p.includes('/new')) {
    return { type: 'filter-page', category: 'listings' };
  }
  // Homepage
  if (p === '/' || p === '') {
    return { type: 'home', category: 'core' };
  }

  return { type: 'other', category: 'misc' };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: node crawl-pages.js <url> [max-depth] [output-dir]');
    process.exit(1);
  }

  const startUrl = args[0];
  const maxDepth = parseInt(args[1] || '1');
  const outputDir = path.resolve(args[2] || 'clone-output');

  try { new URL(startUrl); } catch { console.error(`Invalid URL: ${startUrl}`); process.exit(1); }

  const startDomain = new URL(startUrl).hostname;
  const pagesDir = path.join(outputDir, 'pages');
  if (!fs.existsSync(pagesDir)) fs.mkdirSync(pagesDir, { recursive: true });

  console.log(`\n🕷️  Crawling: ${startUrl}`);
  console.log(`   Domain: ${startDomain}`);
  console.log(`   Max depth: ${maxDepth}\n`);

  // 1. Open start page and collect links
  const visited = new Set();
  const allPages = [];

  async function crawlPage(url, depth) {
    const urlObj = new URL(url);
    const pageKey = urlObj.pathname || '/';

    // Skip if already visited or external
    if (visited.has(pageKey)) return;
    if (urlObj.hostname !== startDomain) return;
    
    // Skip non-page URLs
    if (urlObj.pathname.match(/\.(png|jpg|jpeg|gif|svg|ico|css|js|woff|woff2|pdf|zip)$/i)) return;
    if (urlObj.pathname.startsWith('/api/')) return;

    visited.add(pageKey);

    console.log(`${'  '.repeat(depth)}🔍 Depth ${depth}: ${pageKey}`);

    // Open page
    run(`agent-browser open "${url}"`, { timeout: 20000 });
    run('agent-browser wait 3000');

    // Get page title
    const title = evalString('document.title') || '';

    // Get all links on this page
    const links = evalJson(
      `[...document.querySelectorAll('a[href]')].map(a=>({href:a.href, text:(a.textContent||'').trim().slice(0,80)})).filter(a=>a.href && !a.href.startsWith('mailto:') && !a.href.startsWith('tel:')).slice(0,100)`
    ) || [];

    // Classify this page
    const classification = classifyPage(url, '');
    
    const pageInfo = {
      url,
      pathname: pageKey,
      title,
      depth,
      linkCount: links.length,
      ...classification,
    };
    allPages.push(pageInfo);

    // Save page links
    const pageFile = path.join(pagesDir, `${pageKey.replace(/\//g, '_').replace(/^_/, '') || 'home'}-links.json`);
    const dir = path.dirname(pageFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(pageFile, JSON.stringify(links, null, 2), 'utf-8');

    console.log(`${'  '.repeat(depth)}   📄 "${title}" — ${links.length} links (${classification.type})`);

    // Crawl linked pages if depth allows
    if (depth < maxDepth) {
      // Get unique same-domain URLs
      const sameDomainLinks = [...new Set(
        links
          .map(l => l.href)
          .filter(h => {
            try {
              const u = new URL(h);
              return u.hostname === startDomain && !visited.has(u.pathname);
            } catch { return false; }
          })
      )];

      // Limit to prevent explosion
      const toCrawl = sameDomainLinks.slice(0, 20);
      
      for (const nextUrl of toCrawl) {
        await crawlPage(nextUrl, depth + 1);
      }
    }
  }

  await crawlPage(startUrl, 0);

  // 2. Deduplicate and organize all discovered pages
  const uniquePages = [];
  const seenPaths = new Set();
  for (const page of allPages) {
    if (!seenPaths.has(page.pathname)) {
      seenPaths.add(page.pathname);
      uniquePages.push(page);
    }
  }

  // 3. Group by category
  const grouped = {};
  for (const page of uniquePages) {
    const cat = page.category || 'misc';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(page);
  }

  // 4. Save sitemap
  const sitemap = {
    source: startUrl,
    crawledAt: new Date().toISOString(),
    totalPages: uniquePages.length,
    maxDepth,
    categories: Object.fromEntries(
      Object.entries(grouped).map(([cat, pages]) => [cat, pages.length])
    ),
    pages: uniquePages,
  };

  fs.writeFileSync(path.join(outputDir, 'sitemap.json'), JSON.stringify(sitemap, null, 2), 'utf-8');

  // 5. Print summary
  console.log(`\n📊 Crawl Summary:`);
  console.log(`   Total pages: ${uniquePages.length}`);
  for (const [cat, pages] of Object.entries(grouped)) {
    console.log(`   ${cat}: ${pages.length} pages`);
    for (const p of pages.slice(0, 5)) {
      console.log(`     → ${p.pathname} (${p.type})`);
    }
    if (pages.length > 5) console.log(`     ... and ${pages.length - 5} more`);
  }

  console.log(`\n✅ Sitemap saved to: ${path.join(outputDir, 'sitemap.json')}`);
  console.log('');
}

main();
