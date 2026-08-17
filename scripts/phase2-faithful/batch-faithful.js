#!/usr/bin/env node
/**
 * batch-faithful.js — Mode Faithful orchestrator
 *
 * Chạy toàn bộ pipeline mode-faithful cho 1 page hoặc tất cả pages:
 *   1. port-html-to-jsx.js   → Convert HTML sang JSX (PER-COMPONENT — N5)
 *                              (N6: strip opacity:0, N8: detect data-framer-appear-id)
 *   2. download-assets.js    → Tải ảnh remote (N4: global hash-based dedup)
 *   3. download-fonts.js     → Tải fonts (N4: global hash-based dedup)
 *   4. rewrite-asset-urls.js → Rewrite URL trong JSX
 *   5. split-component-css.js → Option 1: per-component PLAIN .css + small globals
 *                              (literal selectors → fidelity 1:1, animations keep working)
 *   6. (REMOVED — inject-resolved-css.js gộp vào bước 5, không còn dump blob vào globals)
 *   7. generate-page.js      → F4+N9: Generate real React component tree in page.tsx
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
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
if (args.length < 3) {
  console.error(`Usage: node batch-faithful.js <clone-output> --src <dir> --public <dir> [--page <slug>] [--all] [--allow-private]

Pipeline:
  1. port-html-to-jsx.js    — PER-COMPONENT JSX (N5+N6+N8)
  2. download-assets.js     — Global hash dedup (N4)
  3. download-fonts.js      — Global hash dedup (N4)
  4. rewrite-asset-urls.js  — Rewrite URLs in JSX
  5. split-component-css.js — Option 1: per-component PLAIN .css + small globals
  6. (REMOVED)              — was inject-resolved-css.js (merged into step 5)
  7. generate-page.js       — Real React tree in page.tsx (F4+N9)

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
  const componentsRawDir = path.join(pageInputDir, 'components-raw');
  const extractedCssPath = path.join(pageInputDir, 'html-raw', 'extracted.css');
  const resolvedCssPath = path.join(pageInputDir, 'html-raw', 'resolved.css');
  const tokensJsonPath = path.join(pageInputDir, 'html-raw', 'design-tokens.json');

  if (!fs.existsSync(sanitizedHtmlPath)) {
    console.error(`❌ Required file missing: ${sanitizedHtmlPath}`);
    return false;
  }

  // === Step 1: Port HTML → JSX (PER-COMPONENT — N5) ===
  // If components-raw/ exists with .tsx files, port each individually.
  // Otherwise, port the sanitized.html as a single PageFaithful.tsx.
  const jsxOutDir = path.join(srcDir, 'components', 'pages', pageName);
  fs.mkdirSync(jsxOutDir, { recursive: true });

  const allowPrivateArg = allowPrivate ? ['--allow-private'] : [];

  if (fs.existsSync(componentsRawDir)) {
    // N5: Per-component porting
    const componentFiles = fs.readdirSync(componentsRawDir).filter(f => f.endsWith('.tsx') && f !== 'Page.tsx');
    if (componentFiles.length > 0) {
      console.log(`   📦 N5: Per-component porting (${componentFiles.length} components found)`);
      if (!runStep('1. Port HTML → JSX (PER-COMPONENT — N5+N6+N8)',
        path.join(SCRIPTS_DIR, 'port-html-to-jsx.js'),
        [componentsRawDir, jsxOutDir, '--page', pageName, '--css-modules'])) return false;
      // Copy component-order.json (top-level vs nested manifest) from components-raw
      // to the ported JSX dir, so generate-page.js (step 7) can render only top-level
      // components and import nested CSS instead of duplicating content.
      const orderManifest = path.join(componentsRawDir, 'component-order.json');
      if (fs.existsSync(orderManifest)) {
        fs.copyFileSync(orderManifest, path.join(jsxOutDir, 'component-order.json'));
        console.log(`   📋 Copied component-order.json → ${jsxOutDir}`);
      }
    } else {
      // Fall back to single-file port
      if (!runStep('1. Port HTML → JSX (single PageFaithful)',
        path.join(SCRIPTS_DIR, 'port-html-to-jsx.js'),
        [sanitizedHtmlPath, path.join(jsxOutDir, 'PageFaithful.tsx'), '--name', 'PageFaithful', '--page', pageName])) return false;
    }
  } else {
    if (!runStep('1. Port HTML → JSX (single PageFaithful)',
      path.join(SCRIPTS_DIR, 'port-html-to-jsx.js'),
      [sanitizedHtmlPath, path.join(jsxOutDir, 'PageFaithful.tsx'), '--name', 'PageFaithful', '--page', pageName])) return false;
  }

  // === Step 2: Download assets (N4: global hash dedup) ===
  const assetsOutDir = path.join(publicDir, 'assets');
  if (!runStep('2. Download assets (N4: global hash dedup)',
    path.join(SCRIPTS_DIR, 'download-assets.js'),
    [pageInputDir, '--out', assetsOutDir, '--page', pageName, ...allowPrivateArg])) {
    console.warn('⚠️  Asset download had issues, continuing...');
  }
  const manifestPath = path.join(assetsOutDir, `${pageName}-assets-manifest.json`);

  // === Step 3: Download fonts (N4: global hash dedup) ===
  const fontsOutDir = path.join(publicDir, 'assets', 'fonts');
  const fontsInputDir = path.join(pageInputDir, 'html-raw');
  if (fs.existsSync(fontsInputDir)) {
    runStep('3. Download fonts (N4: global hash dedup)',
      path.join(SCRIPTS_DIR, 'download-fonts.js'),
      [fontsInputDir, '--out', fontsOutDir, '--page', pageName, ...allowPrivateArg]);
  } else {
    console.log('\n────────── 3. Download fonts (skipped, no html-raw dir) ──────────');
  }
  const fontsManifestPath = path.join(fontsOutDir, pageName, 'fonts-manifest.json');

  // === Step 4: Rewrite asset URLs in JSX ===
  if (fs.existsSync(manifestPath)) {
    const rewriteArgs = [jsxOutDir, '--manifest', manifestPath];
    if (fs.existsSync(fontsManifestPath)) {
      rewriteArgs.push('--fonts-manifest', fontsManifestPath);
    }
    if (!runStep('4. Rewrite asset URLs', path.join(SCRIPTS_DIR, 'rewrite-asset-urls.js'), rewriteArgs)) {
      console.warn('⚠️  URL rewrite had issues, continuing...');
    }
  } else {
    console.log('\n────────── 4. Rewrite asset URLs (skipped, no manifest) ──────────');
  }

  // === Step 5: Split CSS into per-component PLAIN .css + small globals (Option 1) ===
  // Replaces old step 5 (split-css-modules.js) + step 6 (inject-resolved-css.js).
  // Uses extracted.css as single CSS source (resolved.css is an identical verbatim
  // copy per resolve-css-vars.js F2 — injecting both was a source of duplication/OOM).
  // Global fragment (:root, @font-face, @keyframes, html/body/*) → src/app/globals.css
  // Per-component CSS → src/components/pages/{page}/{Name}.css (literal selectors).
  const globalsPath = path.join(srcDir, 'app', 'globals.css');
  const splitComponentsDir = fs.existsSync(componentsRawDir) ? componentsRawDir : jsxOutDir;
  if (fs.existsSync(extractedCssPath)) {
    const splitArgs = [extractedCssPath, splitComponentsDir, jsxOutDir,
      '--globals', globalsPath, '--page', pageName];
    if (fs.existsSync(tokensJsonPath)) {
      splitArgs.push('--tokens', tokensJsonPath);
    }
    runStep('5. Split CSS → per-component .css + small globals (Option 1)',
      path.join(SCRIPTS_DIR, 'split-component-css.js'),
      splitArgs);
  } else {
    console.log('\n────────── 5. Split CSS (skipped, no extracted.css) ──────────');
  }

  // === Step 7: Generate page.tsx with real React component tree (F4+N9) ===
  // Determine the route path from pageName
  const routePath = pageName === 'home' ? '/' : `/${pageName.replace(/_/g, '/')}`;
  const pageOutputPath = pageName === 'home'
    ? path.join(srcDir, 'app', 'page.tsx')
    : path.join(srcDir, 'app', ...pageName.split('_'), 'page.tsx');

  // Only generate if components were ported individually (not single PageFaithful)
  const portedComponents = fs.existsSync(jsxOutDir)
    ? fs.readdirSync(jsxOutDir).filter(f => f.endsWith('.tsx') && f !== 'PageFaithful.tsx')
    : [];
  if (portedComponents.length > 0) {
    runStep('7. Generate page.tsx (F4+N9: real React tree)',
      path.join(SCRIPTS_DIR, 'generate-page.js'),
      [jsxOutDir, pageOutputPath, '--page', pageName, '--route', routePath]);
  } else {
    // Single PageFaithful.tsx — generate a simpler page.tsx that imports it
    const pageDir = path.dirname(pageOutputPath);
    fs.mkdirSync(pageDir, { recursive: true });
    const simplePage = `// Auto-generated by batch-faithful.js
import PageFaithful from '@/components/pages/${pageName}/PageFaithful';

export const metadata = {
  title: '${pageName}',
  description: 'Cloned page (Mode Faithful)',
};

export default function Page() {
  return (
    <main data-page="${pageName}">
      <PageFaithful />
    </main>
  );
}
`;
    fs.writeFileSync(pageOutputPath, simplePage, 'utf-8');
    console.log(`\n────────── 7. Generated simple page.tsx (PageFaithful) ──────────`);
    console.log(`   ${pageOutputPath}`);
  }

  console.log(`\n✅ Page "${pageName}" complete.`);
  console.log(`   - JSX components: ${jsxOutDir}/`);
  console.log(`   - Per-component CSS: ${jsxOutDir}/*.css (plain, literal selectors → fidelity 1:1)`);
  console.log(`   - Assets: ${assetsOutDir}/ (global hash-based)`);
  console.log(`   - Fonts: ${fontsOutDir}/ (global hash-based)`);
  console.log(`   - globals.css: small (:root vars, @keyframes, @font-face, html/body reset only)`);
  console.log(`   - page.tsx: ${pageOutputPath}`);
  console.log(`\n   NEXT: Run dev server and visit ${routePath === '/' ? '/' : routePath}`);
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
