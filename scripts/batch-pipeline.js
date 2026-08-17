#!/usr/bin/env node
/**
 * batch-pipeline.js — Run the full pipeline (Steps 1→3b) for ALL pages in sitemap
 * 
 * Reads clone-output/sitemap.json and processes each page:
 *   1. Fetch HTML + CSS + tokens + screenshots
 *   2. Resolve CSS variables
 *   3. Annotate components
 *   4. Sanitize + Split into .tsx skeletons
 *   5. Split CSS per-component
 * 
 * Each page gets its own directory under clone-output/pages/{pathname}/
 * 
 * Usage:
 *   node batch-pipeline.js [sitemap-path] [concurrency]
 *   node batch-pipeline.js clone-output/sitemap.json 1
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SCRIPTS_DIR = path.join(__dirname);

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 120000, stdio: 'pipe', ...opts });
  } catch (e) {
    return e.stdout || e.stderr || `Error: ${e.message}`;
  }
}

function runStep(cmd, label) {
  console.log(`  ${label}...`);
  const result = run(cmd);
  const lines = (result || '').trim().split('\n').filter(l => 
    l.includes('✅') || l.includes('❌') || l.includes('⚠️') || 
    l.includes('chars') || l.includes('rules') || l.includes('files') ||
    l.includes('components') || l.includes('Detected') || l.includes('Split')
  );
  lines.forEach(l => console.log(`    ${l}`));
  return result;
}

function main() {
  const args = process.argv.slice(2);
  const sitemapPath = path.resolve(args[0] || 'clone-output/sitemap.json');
  const concurrency = parseInt(args[1] || '1');

  if (!fs.existsSync(sitemapPath)) {
    console.error(`Sitemap not found: ${sitemapPath}`);
    console.error('Run crawl-pages.js first to generate the sitemap.');
    process.exit(1);
  }

  const sitemap = JSON.parse(fs.readFileSync(sitemapPath, 'utf-8'));
  const pages = sitemap.pages || [];
  const outputBase = path.dirname(sitemapPath);

  console.log(`\n🚀 Batch Pipeline: ${pages.length} pages from ${sitemap.source}`);
  console.log(`   Output base: ${outputBase}`);
  console.log('');

  const results = [];

  for (const page of pages) {
    const url = page.url;
    const pathname = page.pathname || '/';
    const pageType = page.type || 'other';
    
    // Create safe directory name from pathname
    const safeName = pathname
      .replace(/^\//, '')
      .replace(/\/$/, '')
      .replace(/\//g, '_') 
      || 'home';
    
    const pageDir = path.join(outputBase, 'pages', safeName);
    
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📄 Processing: ${pathname} (${pageType})`);
    console.log(`   URL: ${url}`);
    console.log(`   Output: ${pageDir}`);
    console.log(`${'═'.repeat(60)}`);

    // Ensure directories exist
    const htmlRawDir = path.join(pageDir, 'html-raw');
    const htmlAnnotatedDir = path.join(pageDir, 'html-annotated');
    const componentsRawDir = path.join(pageDir, 'components-raw');
    const componentsCssDir = path.join(pageDir, 'components-css');
    const qaDir = path.join(pageDir, 'qa');

    for (const dir of [htmlRawDir, htmlAnnotatedDir, componentsRawDir, componentsCssDir, qaDir]) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    const stepResults = { url, pathname, type: pageType, steps: {} };

    // ── Step 1: Fetch ──
    console.log(`  1️⃣  Step 1: Fetch...`);
    const fetchResult = runStep(
      `node "${path.join(SCRIPTS_DIR, 'fetch-page.js')}" "${url}" "${htmlRawDir}"`,
      '  fetch-page.js'
    );
    stepResults.steps.fetch = fs.existsSync(path.join(htmlRawDir, 'page.html'));

    // Check if fetch succeeded
    if (!stepResults.steps.fetch) {
      console.log(`  ❌ Fetch failed, skipping remaining steps`);
      stepResults.success = false;
      results.push(stepResults);
      continue;
    }

    // Get HTML size
    const htmlSize = fs.statSync(path.join(htmlRawDir, 'page.html')).size;
    stepResults.htmlSize = htmlSize;

    // ── Step 1b: Resolve CSS vars ──
    const extractedCss = path.join(htmlRawDir, 'extracted.css');
    const resolvedCss = path.join(htmlRawDir, 'resolved.css');
    const tokensJson = path.join(htmlRawDir, 'design-tokens.json');

    if (fs.existsSync(extractedCss)) {
      console.log(`  1b️⃣  Step 1b: Resolve CSS vars...`);
      runStep(
        `node "${path.join(SCRIPTS_DIR, 'resolve-css-vars.js')}" "${extractedCss}" "${resolvedCss}" "${tokensJson}"`,
        '  resolve-css-vars.js'
      );
      stepResults.steps.resolveCss = fs.existsSync(resolvedCss);
    }

    // ── Step 2: Annotate ──
    console.log(`  2️⃣  Step 2: Annotate...`);
    const annotatedHtml = path.join(htmlAnnotatedDir, 'page.annotated.html');
    runStep(
      `node "${path.join(SCRIPTS_DIR, 'annotate-html.js')}" "${path.join(htmlRawDir, 'page.html')}" "${annotatedHtml}"`,
      '  annotate-html.js'
    );
    stepResults.steps.annotate = fs.existsSync(annotatedHtml);

    // ── Step 3: Sanitize + Split ──
    console.log(`  3️⃣  Step 3: Sanitize + Split...`);
    const sanitizedHtml = path.join(htmlAnnotatedDir, 'page.sanitized.html');
    runStep(
      `node "${path.join(SCRIPTS_DIR, 'sanitize-html.js')}" "${annotatedHtml}" "${sanitizedHtml}"`,
      '  sanitize-html.js'
    );
    
    const splitResult = runStep(
      `node "${path.join(SCRIPTS_DIR, 'split-components.js')}" "${sanitizedHtml}" "${componentsRawDir}"`,
      '  split-components.js'
    );
    
    // Count generated component files
    const componentFiles = fs.existsSync(componentsRawDir) 
      ? fs.readdirSync(componentsRawDir).filter(f => f.endsWith('.tsx')) 
      : [];
    stepResults.steps.split = componentFiles.length > 0;
    stepResults.componentCount = componentFiles.length;
    stepResults.components = componentFiles.map(f => f.replace('.tsx', ''));

    // ── Step 3b: Split CSS per-component ──
    if (fs.existsSync(extractedCss) && componentFiles.length > 0) {
      console.log(`  3b️⃣ Step 3b: Split CSS per-component...`);
      runStep(
        `node "${path.join(SCRIPTS_DIR, 'split-css-by-component.js')}" "${extractedCss}" "${componentsRawDir}" "${componentsCssDir}"`,
        '  split-css-by-component.js'
      );
      const cssFiles = fs.readdirSync(componentsCssDir).filter(f => f.endsWith('.css'));
      stepResults.steps.cssSplit = cssFiles.length > 0;
      stepResults.cssFileCount = cssFiles.length;
    }

    stepResults.success = stepResults.steps.fetch && stepResults.steps.annotate && stepResults.steps.split;

    // Quick summary
    console.log(`\n  📊 Page Summary:`);
    console.log(`     HTML: ${(htmlSize / 1024).toFixed(0)} KB`);
    console.log(`     Components: ${componentFiles.length} (${componentFiles.slice(0, 5).map(f => f.replace('.tsx','')).join(', ')}${componentFiles.length > 5 ? '...' : ''})`);
    console.log(`     Status: ${stepResults.success ? '✅ Success' : '❌ Failed'}`);

    results.push(stepResults);
  }

  // ── Final Summary ──
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🏁 Batch Pipeline Complete`);
  console.log(`${'═'.repeat(60)}`);
  
  const succeeded = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`\n  Total: ${results.length} pages`);
  console.log(`  ✅ Succeeded: ${succeeded.length}`);
  console.log(`  ❌ Failed: ${failed.length}`);

  // Group by type
  const byType = {};
  for (const r of results) {
    const t = r.type || 'other';
    if (!byType[t]) byType[t] = { total: 0, success: 0, components: 0 };
    byType[t].total++;
    if (r.success) { byType[t].success++; byType[t].components += (r.componentCount || 0); }
  }

  console.log(`\n  By page type:`);
  for (const [type, stats] of Object.entries(byType)) {
    console.log(`    ${type}: ${stats.success}/${stats.total} succeeded, ${stats.components} total components`);
  }

  // Save batch results
  const batchReportPath = path.join(outputBase, 'batch-report.json');
  fs.writeFileSync(batchReportPath, JSON.stringify({
    source: sitemap.source,
    ranAt: new Date().toISOString(),
    totalPages: results.length,
    succeeded: succeeded.length,
    failed: failed.length,
    byType,
    pages: results,
  }, null, 2), 'utf-8');

  console.log(`\n  📄 Report saved: ${batchReportPath}`);
  console.log('');
}

main();
