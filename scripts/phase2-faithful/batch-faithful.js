#!/usr/bin/env node
/**
 * batch-faithful.js — Mode Faithful orchestrator
 *
 * Chạy toàn bộ pipeline mode-faithful cho 1 page hoặc tất cả pages:
 *   1. port-html-to-jsx.js  → Convert HTML sang JSX (PageFaithful.tsx + MainContent/Header/Footer)
 *   2. download-assets.js   → Tải ảnh remote về public/assets/{page}/ (scan WHOLE page dir, not just sanitized.html)
 *   3. download-fonts.js    → Tải fonts về public/assets/fonts/{page}/ (scan extracted.css AND resolved.css)
 *   4. rewrite-asset-urls.js → Rewrite URL trong JSX (use asset manifest + font manifest)
 *   5. inject-resolved-css.js → Inject resolved.css + extracted.css vào src/app/globals.css
 *
 * Usage:
 *   node batch-faithful.js <clone-output-dir> --src <src-app-dir> --public <public-dir> [--page <slug>] [--all] [--allow-private]
 *
 * Examples:
 *   # Process home page only
 *   node batch-faithful.js clone-output/pages/home --src src --public public --page home
 *
 *   # Process all pages
 *   node batch-faithful.js clone-output/pages --src src --public public --all
 *
 *   # Process localhost-cloned pages (SSRF safe with --allow-private)
 *   node batch-faithful.js clone-output/pages/home --src src --public public --page home --allow-private
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
if (args.length < 3) {
  console.error(`Usage: node batch-faithful.js <clone-output> --src <dir> --public <dir> [--page <slug>] [--all] [--allow-private]

Pipeline:
  1. port-html-to-jsx.js   — HTML → JSX (class→className, attrs camelCase, SVG dashed→camelCase)
  2. download-assets.js     — Download remote images → public/assets/{page}/ (scans whole page dir)
  3. download-fonts.js     — Download @font-face files → public/assets/fonts/{page}/
  4. rewrite-asset-urls.js — Rewrite URLs in JSX (uses asset + font manifests)
  5. inject-resolved-css.js — Inject resolved CSS into src/app/globals.css

Examples:
  node batch-faithful.js clone-output/pages/home --src src --public public --page home
  node batch-faithful.js clone-output/pages --src src --public public --all
`);
  process.exit(1);
}

const inputArg = args[0];
const srcIdx = args.indexOf('--src');
const publicIdx = args.indexOf('--public');
const pageIdx = args.indexOf('--page');
const allIdx = args.indexOf('--all');

const srcDir = srcIdx > -1 && args.length > srcIdx + 1 ? args[srcIdx + 1] : 'src';
const publicDir = publicIdx > -1 && args.length > publicIdx + 1 ? args[publicIdx + 1] : 'public';
const pageSlug = pageIdx > -1 && args.length > pageIdx + 1 ? args[pageIdx + 1] : null;
const allPages = allIdx > -1;
const allowPrivate = args.includes('--allow-private');

const SCRIPTS_DIR = __dirname;

// Run a Node script with proper argument quoting (no shell interpolation)
function runStep(label, scriptPath, scriptArgs) {
  console.log(`\n────────── ${label} ──────────`);
  console.log(`$ node ${scriptPath} ${scriptArgs.map(a => `"${a}"`).join(' ')}`);
  try {
    execFileSync('node', [scriptPath, ...scriptArgs], { stdio: 'inherit', cwd: process.cwd() });
    return true;
  } catch (e) {
    console.error(`❌ Step failed: ${label}`);
    console.error(e.message);
    return false;
  }
}

function processPage(pageName, pageInputDir) {
  console.log(`\n========== Processing page: ${pageName} ==========`);
  const sanitizedHtmlPath = path.join(pageInputDir, 'html-annotated', 'page.sanitized.html');
  const mainContentPath = path.join(pageInputDir, 'components-raw', 'MainContent.tsx');
  const headerPath = path.join(pageInputDir, 'components-raw', 'Header.tsx');
  const footerPath = path.join(pageInputDir, 'components-raw', 'Footer.tsx');
  const extractedCssPath = path.join(pageInputDir, 'html-raw', 'extracted.css');
  const resolvedCssPath = path.join(pageInputDir, 'html-raw', 'resolved.css');

  if (!fs.existsSync(sanitizedHtmlPath)) {
    console.error(`❌ Required file missing: ${sanitizedHtmlPath}`);
    return false;
  }

  // === Step 1: Port HTML → JSX ===
  const jsxOutDir = path.join(srcDir, 'components', 'pages', pageName);
  fs.mkdirSync(jsxOutDir, { recursive: true });

  const allowPrivateArg = allowPrivate ? ['--allow-private'] : [];

  // Port full page as Page component
  const pageOutPath = path.join(jsxOutDir, 'PageFaithful.tsx');
  if (!runStep('1. Port HTML → JSX (full page)',
    path.join(SCRIPTS_DIR, 'port-html-to-jsx.js'),
    [sanitizedHtmlPath, pageOutPath, '--name', 'PageFaithful', '--page', pageName])) return false;

  // Port individual components (if MainContent exists)
  if (fs.existsSync(mainContentPath)) {
    runStep('1b. Port MainContent.tsx',
      path.join(SCRIPTS_DIR, 'port-html-to-jsx.js'),
      [mainContentPath, path.join(jsxOutDir, 'MainContent.tsx'), '--name', 'MainContent', '--page', pageName]);
  }
  if (fs.existsSync(headerPath)) {
    runStep('1c. Port Header.tsx',
      path.join(SCRIPTS_DIR, 'port-html-to-jsx.js'),
      [headerPath, path.join(jsxOutDir, 'Header.tsx'), '--name', 'Header', '--page', pageName]);
  }
  if (fs.existsSync(footerPath)) {
    runStep('1d. Port Footer.tsx',
      path.join(SCRIPTS_DIR, 'port-html-to-jsx.js'),
      [footerPath, path.join(jsxOutDir, 'Footer.tsx'), '--name', 'Footer', '--page', pageName]);
  }

  // === Step 2: Download assets ===
  // Scan the WHOLE page input dir (html-raw, html-annotated, components-raw, components-css)
  // — not just sanitized.html — so we catch URLs in MainContent.tsx (which has the bulk of HTML via dangerouslySetInnerHTML).
  const assetsOutDir = path.join(publicDir, 'assets', pageName);
  if (!runStep('2. Download assets (whole page dir)',
    path.join(SCRIPTS_DIR, 'download-assets.js'),
    [pageInputDir, '--out', assetsOutDir, '--page', pageName, ...allowPrivateArg])) {
    console.warn('⚠️  Asset download had issues, continuing...');
  }
  const manifestPath = path.join(assetsOutDir, `${pageName}-assets-manifest.json`);

  // === Step 3: Download fonts ===
  // Scan both extracted.css AND resolved.css (resolved.css may have additional @font-face declarations)
  const fontsOutDir = path.join(publicDir, 'assets', 'fonts');
  const cssInputsForFonts = [];
  if (fs.existsSync(extractedCssPath)) cssInputsForFonts.push(extractedCssPath);
  if (fs.existsSync(resolvedCssPath) && resolvedCssPath !== extractedCssPath) {
    // download-fonts.js can take a single file or a directory. We pass the html-raw dir
    // so it picks up both extracted.css and resolved.css.
  }
  if (cssInputsForFonts.length > 0) {
    const fontsInputDir = path.join(pageInputDir, 'html-raw');
    if (fs.existsSync(fontsInputDir)) {
      runStep('3. Download fonts (extracted.css + resolved.css)',
        path.join(SCRIPTS_DIR, 'download-fonts.js'),
        [fontsInputDir, '--out', fontsOutDir, '--page', pageName, ...allowPrivateArg]);
    }
  } else {
    console.log('\n────────── 3. Download fonts (skipped, no extracted.css or resolved.css) ──────────');
  }
  const fontsManifestPath = path.join(fontsOutDir, pageName, 'fonts-manifest.json');

  // === Step 4: Rewrite asset URLs in JSX ===
  if (fs.existsSync(manifestPath)) {
    const rewriteArgs = [jsxOutDir, '--manifest', manifestPath];
    if (fs.existsSync(fontsManifestPath)) {
      rewriteArgs.push('--fonts-manifest', fontsManifestPath);
    }
    if (!runStep('4. Rewrite asset URLs (JSX + fonts)', path.join(SCRIPTS_DIR, 'rewrite-asset-urls.js'), rewriteArgs)) {
      console.warn('⚠️  URL rewrite had issues, continuing...');
    }
  } else {
    console.log('\n────────── 4. Rewrite asset URLs (skipped, no manifest) ──────────');
  }

  // === Step 5: Inject resolved CSS into globals.css ===
  const globalsPath = path.join(srcDir, 'app', 'globals.css');
  if (fs.existsSync(resolvedCssPath)) {
    const injectArgs = [resolvedCssPath];
    if (fs.existsSync(extractedCssPath)) {
      injectArgs.push('--extracted', extractedCssPath);
    }
    injectArgs.push('--globals', globalsPath, '--page', pageName);
    runStep('5. Inject resolved CSS', path.join(SCRIPTS_DIR, 'inject-resolved-css.js'), injectArgs);
  } else {
    console.log('\n────────── 5. Inject resolved CSS (skipped, no resolved.css) ──────────');
  }

  console.log(`\n✅ Page "${pageName}" complete.`);
  console.log(`   - JSX components: ${jsxOutDir}/`);
  console.log(`   - Assets: ${assetsOutDir}/`);
  console.log(`   - Fonts: ${fontsOutDir}/${pageName}/`);
  console.log(`   - globals.css updated with [data-page="${pageName}"] scope`);
  console.log(`\n   NEXT: Add 'data-page="${pageName}"' attribute to root element in app/${pageName}/page.tsx`);
  console.log(`         Import components: import PageFaithful from '@/components/pages/${pageName}/PageFaithful';`);
  return true;
}

function main() {
  const resolvedIn = path.resolve(inputArg);
  if (!fs.existsSync(resolvedIn)) {
    console.error(`Input not found: ${resolvedIn}`);
    process.exit(1);
  }

  if (allPages) {
    const pages = fs.readdirSync(resolvedIn, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
    console.log(`\n🌐 Processing ${pages.length} pages...`);
    let okCount = 0;
    for (const page of pages) {
      try {
        if (processPage(page, path.join(resolvedIn, page))) okCount++;
      } catch (e) {
        console.error(`❌ Page "${page}" failed: ${e.message}`);
      }
    }
    console.log(`\n📊 Summary: ${okCount}/${pages.length} pages processed successfully.`);
  } else if (pageSlug) {
    processPage(pageSlug, resolvedIn);
  } else {
    console.error('Either --page <slug> or --all must be specified');
    process.exit(1);
  }
}

main();
