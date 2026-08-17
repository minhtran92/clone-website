#!/usr/bin/env node
/**
 * rewrite-asset-urls.js — Mode Faithful: Rewrite remote URLs → local paths trong JSX/CSS
 *
 * Bước 2.4 của Phase 2 mode-faithful.
 *
 * Mục tiêu:
 *   - Đọc asset manifest từ bước 2.2 (download-assets.js output: <page>-assets-manifest.json)
 *   - Đọc font manifest từ bước 2.3 (download-fonts.js output: <page>/fonts-manifest.json)
 *   - Scan component .tsx files và CSS files, tìm remote URLs đã download
 *   - Replace bằng local path (e.g. https://.../landscaper.jpg → /assets/home/.../landscaper.jpg)
 *   - Write file gốc (in-place) hoặc --out <dir>
 *
 * Usage:
 *   node rewrite-asset-urls.js <input-dir|input-file> --manifest <manifest.json> [--fonts-manifest <fonts-manifest.json>] [--out <dir>]
 *
 * Examples:
 *   # Rewrite JSX component with both asset + font manifests
 *   node rewrite-asset-urls.js src/components/pages/home \\
 *     --manifest public/assets/home/home-assets-manifest.json \\
 *     --fonts-manifest public/assets/fonts/home/fonts-manifest.json
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error(`Usage: node rewrite-asset-urls.js <input> --manifest <manifest.json> [--fonts-manifest <fonts-manifest.json>] [--out <dir>]

Examples:
  node rewrite-asset-urls.js src/components/pages/home \\
    --manifest public/assets/home/home-assets-manifest.json \\
    --fonts-manifest public/assets/fonts/home/fonts-manifest.json
`);
  process.exit(1);
}

const inputArg = args[0];
const manifestIdx = args.indexOf('--manifest');
const fontsManifestIdx = args.indexOf('--fonts-manifest');
const outIdx = args.indexOf('--out');

const manifestPath = manifestIdx > -1 && args.length > manifestIdx + 1 ? args[manifestIdx + 1] : null;
const fontsManifestPath = fontsManifestIdx > -1 && args.length > fontsManifestIdx + 1 ? args[fontsManifestIdx + 1] : null;
const outDir = outIdx > -1 && args.length > outIdx + 1 ? args[outIdx + 1] : null;

if (!manifestPath || !fs.existsSync(manifestPath)) {
  console.error(`✖ Manifest not found: ${manifestPath}`);
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
} catch (e) {
  console.error(`✖ Invalid manifest JSON at ${manifestPath}: ${e.message}`);
  process.exit(1);
}
if (!manifest.downloads || !Array.isArray(manifest.downloads)) {
  console.error('✖ Invalid manifest: missing "downloads" array');
  process.exit(1);
}

// Build URL → localPath map from asset manifest
const urlMap = new Map();
for (const d of manifest.downloads) {
  if (d.remoteUrl && d.localPath) {
    urlMap.set(d.remoteUrl, d.localPath);
  }
}
console.log(`📦 Loaded asset manifest: ${urlMap.size} URL rewrites available`);

// Build font URL → localPath map from font manifest (if available)
const fontUrlMap = new Map();
if (fontsManifestPath) {
  if (!fs.existsSync(fontsManifestPath)) {
    console.warn(`⚠️  Font manifest not found: ${fontsManifestPath} (font URLs will NOT be rewritten)`);
  } else {
    let fontManifest;
    try {
      fontManifest = JSON.parse(fs.readFileSync(fontsManifestPath, 'utf-8'));
    } catch (e) {
      console.warn(`⚠️  Invalid font manifest JSON at ${fontsManifestPath}: ${e.message}`);
      fontManifest = null;
    }
    if (fontManifest && Array.isArray(fontManifest.downloads)) {
      for (const d of fontManifest.downloads) {
        if (d.remoteUrl && d.localPath) {
          fontUrlMap.set(d.remoteUrl, d.localPath);
        }
      }
      console.log(`🔤 Loaded font manifest: ${fontUrlMap.size} font URL rewrites available`);
    }
  }
} else {
  // Auto-detect fonts-manifest.json next to fonts.css
  // Default location: <asset-dir>/../fonts/<page>/fonts-manifest.json
  const pageSlug = manifest.pageSlug || 'unknown';
  const manifestDir = path.dirname(manifestPath);
  const candidate = path.join(manifestDir, '..', 'fonts', pageSlug, 'fonts-manifest.json');
  if (fs.existsSync(candidate)) {
    try {
      const fontManifest = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
      if (Array.isArray(fontManifest.downloads)) {
        for (const d of fontManifest.downloads) {
          if (d.remoteUrl && d.localPath) fontUrlMap.set(d.remoteUrl, d.localPath);
        }
        console.log(`🔤 Auto-detected font manifest: ${candidate} (${fontUrlMap.size} font URLs)`);
      }
    } catch (e) {
      console.warn(`⚠️  Failed to parse auto-detected font manifest at ${candidate}: ${e.message}`);
    }
  }
}

// Merge asset map + font map (font map wins on conflict — more specific)
const mergedMap = new Map([...urlMap, ...fontUrlMap]);

function rewriteContent(content) {
  let rewritten = content;
  let count = 0;
  // Sort URLs by length desc to avoid partial replacement issues
  // (e.g. "https://example.com/img.jpg?w=100" should be matched before "https://example.com/img.jpg")
  const sortedUrls = [...mergedMap.keys()].sort((a, b) => b.length - a.length);
  for (const remoteUrl of sortedUrls) {
    // Escape regex special chars in URL
    const escaped = remoteUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'g');
    const matches = rewritten.match(re);
    if (matches) {
      rewritten = rewritten.replace(re, mergedMap.get(remoteUrl));
      count += matches.length;
    }
  }
  return { content: rewritten, count };
}

function processFile(inputFile, outputFile) {
  const content = fs.readFileSync(inputFile, 'utf-8');
  const { content: newContent, count } = rewriteContent(content);
  if (count === 0) {
    return 0;
  }
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, newContent, 'utf-8');
  console.log(`   ✅ ${inputFile}: ${count} URL${count > 1 ? 's' : ''} rewritten${outputFile !== inputFile ? ' → ' + outputFile : ''}`);
  return count;
}

function main() {
  const resolvedIn = path.resolve(inputArg);
  if (!fs.existsSync(resolvedIn)) {
    console.error(`Input not found: ${resolvedIn}`);
    process.exit(1);
  }
  const stat = fs.statSync(resolvedIn);
  const files = [];
  if (stat.isDirectory()) {
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, f.name);
        if (f.isDirectory()) walk(full);
        else if (/\.(tsx?|jsx?|html?|css)$/.test(f.name)) files.push(full);
      }
    };
    walk(resolvedIn);
  } else {
    files.push(resolvedIn);
  }
  console.log(`\n🔍 Scanning ${files.length} files for URL rewrites...`);
  let totalRewrites = 0;
  let filesChanged = 0;
  for (const f of files) {
    const out = outDir
      ? path.join(outDir, path.relative(resolvedIn, f))
      : f;
    const count = processFile(f, out);
    if (count > 0) {
      totalRewrites += count;
      filesChanged++;
    } else if (outDir) {
      // Copy file as-is to --out dir to preserve structure
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.copyFileSync(f, out);
    }
  }
  console.log(`\n✅ Done. ${filesChanged}/${files.length} files changed, ${totalRewrites} total URL rewrites.`);
}

main();
