#!/usr/bin/env node
/**
 * consolidate-components.js — Compare component skeletons across all cloned pages,
 * identify shared components (Header, Footer, Navbar, etc.), and consolidate them.
 *
 * What it does:
 *  1. Read sitemap.json from clone-output to get all pages
 *  2. For each page, read its components-raw/ directory
 *  3. Find components that appear in multiple pages (by filename)
 *  4. For shared components, compare content using string similarity
 *  5. If identical  → copy ONE version to clone-output/components-shared/
 *  6. If similar (score > 0.8) → copy the best version to components-shared/ and note differences
 *  7. If unique → keep in page-specific directory
 *  8. Also copy their CSS files from components-css/ to shared
 *  9. Generate consolidation-report.json
 *
 * Usage:
 *   node consolidate-components.js <clone-output-dir> [output-dir]
 *   node consolidate-components.js ./clone-output
 *   node consolidate-components.js ./clone-output ./my-app
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// String similarity (simple ratio of matching characters / max length)
// ---------------------------------------------------------------------------

/**
 * Compute a simple similarity ratio between two strings.
 * Uses a fast longest-common-subsequence-length approach via the
 * classic DP table (O(n*m) time, O(min(n,m)) space via row compression).
 * Returns a value in [0, 1] where 1 = identical.
 */
function similarity(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;

  // Normalise whitespace so layout-only diffs don't hurt the score
  const normalize = (s) => s.replace(/\s+/g, ' ').trim();
  const sa = normalize(a);
  const sb = normalize(b);

  const lenA = sa.length;
  const lenB = sb.length;
  if (lenA === 0 && lenB === 0) return 1;
  if (lenA === 0 || lenB === 0) return 0;

  // LCS length via two-row DP
  let prev = new Uint16Array(lenB + 1);
  let curr = new Uint16Array(lenB + 1);

  for (let i = 1; i <= lenA; i++) {
    curr[0] = 0;
    for (let j = 1; j <= lenB; j++) {
      if (sa[i - 1] === sb[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
  }

  const lcsLen = prev[lenB];
  return lcsLen / Math.max(lenA, lenB);
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * List files in a directory (non-recursive), returning full paths.
 * Returns [] if the directory does not exist.
 */
function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name);
}

/**
 * Derive the CSS file name that corresponds to a component file.
 * e.g. Header.tsx → Header.css, Navbar.jsx → Navbar.css
 */
function componentToCssName(compFile) {
  const base = compFile.replace(/\.\w+$/, ''); // strip extension
  return `${base}.css`;
}

/**
 * Read a text file safely. Returns null if it doesn't exist.
 */
function readFileText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Copy a file if it exists. Returns true if copied, false if source missing.
 */
function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) return false;
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  return true;
}

// ---------------------------------------------------------------------------
// Page key helpers — turn a sitemap page entry into a stable directory key
// ---------------------------------------------------------------------------

function pageKey(page, index) {
  // Prefer an explicit name field; fall back to pathname-based slug
  if (page.name) return page.name;
  const slug = (page.pathname || page.url || `page-${index}`)
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return slug || `page-${index}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: node consolidate-components.js <clone-output-dir> [output-dir]');
    console.error('  clone-output-dir   Root of the clone output (contains sitemap.json)');
    console.error('  output-dir         Optional: where to write shared components (defaults to clone-output-dir)');
    process.exit(1);
  }

  const cloneDir = path.resolve(args[0]);
  const outputDir = path.resolve(args[1] || cloneDir);

  // ── 1. Read sitemap.json ──────────────────────────────────────────────
  const sitemapPath = path.join(cloneDir, 'sitemap.json');
  if (!fs.existsSync(sitemapPath)) {
    console.error(`sitemap.json not found at ${sitemapPath}`);
    console.error('Run crawl-pages.js first to generate the sitemap.');
    process.exit(1);
  }

  const sitemap = JSON.parse(fs.readFileSync(sitemapPath, 'utf-8'));
  const pages = sitemap.pages || [];
  if (pages.length === 0) {
    console.error('No pages found in sitemap.json.');
    process.exit(1);
  }

  console.log(`\n📦 Consolidating components across ${pages.length} pages...`);
  console.log(`   Clone dir:  ${cloneDir}`);
  console.log(`   Output dir: ${outputDir}\n`);

  // ── 2. Collect all component files per page ────────────────────────────
  //    Structure: Map<pageName, Map<filename, { filePath, content }>>

  /**
   * @type {Map<string, Map<string, {filePath: string, content: string}>>}
   */
  const pageComponents = new Map();
  const homePageKey = null; // will be set below

  // Home page components (root-level components-raw/)
  const homeKey = '__home__';
  const homeCompDir = path.join(cloneDir, 'components-raw');
  const homeCssDir = path.join(cloneDir, 'components-css');

  if (fs.existsSync(homeCompDir)) {
    const comps = new Map();
    for (const file of listFiles(homeCompDir)) {
      // Only component-like files (.tsx, .jsx, .js, .ts, .html)
      if (!/\.(tsx|jsx|js|ts|html)$/i.test(file)) continue;
      const filePath = path.join(homeCompDir, file);
      const content = readFileText(filePath);
      if (content !== null) {
        comps.set(file, { filePath, content, cssDir: homeCssDir });
      }
    }
    if (comps.size > 0) {
      pageComponents.set(homeKey, comps);
    }
  }

  // Per-page components
  for (let i = 0; i < pages.length; i++) {
    const pk = pageKey(pages[i], i);
    const compDir = path.join(cloneDir, 'pages', pk, 'components-raw');
    const cssDir = path.join(cloneDir, 'pages', pk, 'components-css');

    if (!fs.existsSync(compDir)) continue;

    const comps = new Map();
    for (const file of listFiles(compDir)) {
      if (!/\.(tsx|jsx|js|ts|html)$/i.test(file)) continue;
      const filePath = path.join(compDir, file);
      const content = readFileText(filePath);
      if (content !== null) {
        comps.set(file, { filePath, content, cssDir });
      }
    }

    if (comps.size > 0) {
      pageComponents.set(pk, comps);
    }
  }

  if (pageComponents.size === 0) {
    console.error('No components-raw/ directories found. Run split-components.js first.');
    process.exit(1);
  }

  // ── 3. Index components by filename across pages ───────────────────────
  //    Map<filename, Array<{page, filePath, content, cssDir}>>

  /** @type {Map<string, Array<{page: string, filePath: string, content: string, cssDir: string}>>} */
  const componentIndex = new Map();

  for (const [page, comps] of pageComponents) {
    for (const [filename, info] of comps) {
      if (!componentIndex.has(filename)) {
        componentIndex.set(filename, []);
      }
      componentIndex.get(filename).push({
        page,
        filePath: info.filePath,
        content: info.content,
        cssDir: info.cssDir,
      });
    }
  }

  // ── 4. Classify: shared vs unique ──────────────────────────────────────
  const SIMILARITY_THRESHOLD = 0.8;
  const sharedDir = path.join(outputDir, 'components-shared');
  ensureDir(sharedDir);

  const report = {
    generatedAt: new Date().toISOString(),
    sourceDir: cloneDir,
    outputDir,
    sharedComponents: [],
    pageSpecificComponents: {},
    similarityScores: {},
    bestVersionChosen: {},
    differences: {},
  };

  for (const [filename, occurrences] of componentIndex) {
    const pageCount = occurrences.length;

    if (pageCount === 1) {
      // Unique — page-specific
      const page = occurrences[0].page;
      if (!report.pageSpecificComponents[page]) {
        report.pageSpecificComponents[page] = [];
      }
      report.pageSpecificComponents[page].push({
        filename,
        filePath: occurrences[0].filePath,
      });
      continue;
    }

    // ── Shared component: compare versions ─────────────────────────────
    // Compute pairwise similarities
    const pairwiseScores = [];
    let allIdentical = true;
    let bestScore = -1;

    // Pick a reference version (prefer home page, then longest content)
    let refIdx = occurrences.findIndex((o) => o.page === homeKey);
    if (refIdx === -1) {
      // Fall back to the version with the longest content
      refIdx = 0;
      let maxLen = occurrences[0].content.length;
      for (let i = 1; i < occurrences.length; i++) {
        if (occurrences[i].content.length > maxLen) {
          maxLen = occurrences[i].content.length;
          refIdx = i;
        }
      }
    }

    const refContent = occurrences[refIdx].content;

    const scoresMap = {};
    for (let i = 0; i < occurrences.length; i++) {
      const score = similarity(refContent, occurrences[i].content);
      scoresMap[occurrences[i].page] = Math.round(score * 10000) / 10000;
      if (score < 1) allIdentical = false;
      if (score > bestScore) bestScore = score;
      if (i !== refIdx) {
        pairwiseScores.push({
          page: occurrences[i].page,
          score,
        });
      }
    }

    // Decide: identical, similar, or divergent
    const isSimilarEnough = allIdentical || bestScore >= SIMILARITY_THRESHOLD;
    const status = allIdentical ? 'identical' : isSimilarEnough ? 'similar' : 'divergent';

    // Choose the best version: prefer home page, then longest
    const chosen = occurrences[refIdx];

    // ── Copy the best component to components-shared/ ──────────────────
    const destCompPath = path.join(sharedDir, filename);
    fs.copyFileSync(chosen.filePath, destCompPath);

    // ── Copy CSS if it exists ──────────────────────────────────────────
    const cssFilename = componentToCssName(filename);
    let cssCopied = false;
    // Try the chosen version's cssDir first, then other versions
    const cssDirs = [
      chosen.cssDir,
      ...occurrences.filter((o) => o !== chosen).map((o) => o.cssDir),
    ].filter(Boolean);

    // Also try root-level css dir
    cssDirs.push(path.join(cloneDir, 'components-css'));

    for (const cssDir of cssDirs) {
      const srcCss = path.join(cssDir, cssFilename);
      if (fs.existsSync(srcCss)) {
        const destCss = path.join(sharedDir, cssFilename);
        fs.copyFileSync(srcCss, destCss);
        cssCopied = true;
        break;
      }
    }

    // Record in report
    const sharedEntry = {
      filename,
      status,
      appearsInPages: occurrences.map((o) => o.page),
      cssFile: cssCopied ? cssFilename : null,
    };
    report.sharedComponents.push(sharedEntry);
    report.similarityScores[filename] = scoresMap;
    report.bestVersionChosen[filename] = {
      page: chosen.page,
      reason: chosen.page === homeKey ? 'home page preferred' : 'longest/most detailed version',
    };

    if (status === 'similar') {
      // Note differences — list which pages differ and by how much
      const diffs = [];
      for (const ps of pairwiseScores) {
        if (ps.score < 1) {
          diffs.push({
            page: ps.page,
            similarity: ps.score,
            note: `Similarity ${(ps.score * 100).toFixed(1)}% to chosen version — minor differences`,
          });
        }
      }
      report.differences[filename] = diffs;
    }

    if (status === 'divergent') {
      // All versions are quite different — still pick one but note it
      const diffs = [];
      for (const ps of pairwiseScores) {
        diffs.push({
          page: ps.page,
          similarity: ps.score,
          note: `Similarity ${(ps.score * 100).toFixed(1)}% — significant differences, review recommended`,
        });
      }
      report.differences[filename] = diffs;
    }

    // Console output
    const statusIcon = status === 'identical' ? '✅' : status === 'similar' ? '🔄' : '⚠️';
    console.log(
      `   ${statusIcon} ${filename.padEnd(25)} ${status.padEnd(10)} across ${pageCount} pages  (best from: ${chosen.page})`
    );
    if (cssCopied) {
      console.log(`      └─ ${cssFilename} (CSS copied)`);
    }
  }

  // ── 5. Also record page-specific components in the report ──────────────
  // (Already populated above for unique components.)

  // ── 6. Copy page-specific CSS files alongside their components ─────────
  // For components that are unique to a page, also note their CSS
  for (const [page, compList] of Object.entries(report.pageSpecificComponents)) {
    for (const comp of compList) {
      const cssName = componentToCssName(comp.filename);
      // Try to find the CSS next to the component
      const compDir = path.dirname(comp.filePath);
      const cssPath = path.join(compDir, '..', 'components-css', cssName);
      if (fs.existsSync(cssPath)) {
        comp.cssFile = cssName;
      }
    }
  }

  // ── 7. Write consolidation-report.json ────────────────────────────────
  const reportPath = path.join(outputDir, 'consolidation-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

  // ── 8. Print summary ──────────────────────────────────────────────────
  const sharedCount = report.sharedComponents.length;
  const identicalCount = report.sharedComponents.filter((c) => c.status === 'identical').length;
  const similarCount = report.sharedComponents.filter((c) => c.status === 'similar').length;
  const divergentCount = report.sharedComponents.filter((c) => c.status === 'divergent').length;
  const pageSpecificCount = Object.values(report.pageSpecificComponents).reduce(
    (sum, list) => sum + list.length,
    0
  );

  console.log(`\n📊 Consolidation Summary:`);
  console.log(`   Shared components:    ${sharedCount}`);
  console.log(`     ✅ Identical:       ${identicalCount}`);
  console.log(`     🔄 Similar (>80%):  ${similarCount}`);
  console.log(`     ⚠️  Divergent:       ${divergentCount}`);
  console.log(`   Page-specific:        ${pageSpecificCount}`);
  console.log(`\n   📁 Shared written to: ${sharedDir}`);
  console.log(`   📄 Report saved to:   ${reportPath}`);
  console.log('');
}

main();
