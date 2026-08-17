#!/usr/bin/env node
/**
 * download-fonts.js — Mode Faithful: Download @font-face font files locally
 *
 * Bước 2.3 của Phase 2 mode-faithful.
 *
 * Mục tiêu:
 *   - Parse extracted.css + resolved.css từ clone Phase 1 để tìm @font-face declarations
 *   - Download chỉ woff2 (preferred format — covers all modern browsers, ~30% smaller than woff)
 *     — fallback to woff → ttf → otf if woff2 unavailable
 *   - Save vào public/assets/fonts/{page}/{font-slug}.woff2
 *   - Generate fonts.css với URL đã rewrite (local paths)
 *   - Also write fonts-manifest.json để rewrite-asset-urls.js consume
 *
 * Usage:
 *   node download-fonts.js <input.css|dir> --out <public-assets-fonts-dir> --page <slug> [--batch] [--allow-private] [--allow-host <hostname>]
 *
 * Examples:
 *   node download-fonts.js clone-output/pages/home/html-raw/extracted.css \
 *     --out public/assets/fonts --page home
 *   node download-fonts.js clone-output/pages --batch --out public/assets/fonts
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error(`Usage: node download-fonts.js <input.css|dir> --out <dir> --page <slug> [--batch] [--allow-private] [--allow-host <hostname>]

Examples:
  node download-fonts.js clone-output/pages/home/html-raw/extracted.css --out public/assets/fonts --page home
  node download-fonts.js clone-output/pages --batch --out public/assets/fonts
`);
  process.exit(1);
}

const inputArg = args[0];
const outIdx = args.indexOf('--out');
const pageIdx = args.indexOf('--page');
const batchIdx = args.indexOf('--batch');

const outDir = outIdx > -1 && args.length > outIdx + 1 ? args[outIdx + 1] : 'public/assets/fonts';
const pageSlug = pageIdx > -1 && args.length > pageIdx + 1 ? args[pageIdx + 1] : 'unknown';
const batch = batchIdx > -1;

// Collect --allow-host values
const allowHosts = new Set();
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--allow-host' && args.length > i + 1) allowHosts.add(args[i + 1].toLowerCase());
}
const allowPrivate = args.includes('--allow-private');

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

// SSRF protection
function isPrivateIp(ip) {
  if (!ip) return false;
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [parseInt(m[1], 10), parseInt(m[2], 10)];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('fe80')) return true;
  if (lower.startsWith('::ffff:')) return isPrivateIp(lower.slice('::ffff:'.length));
  return false;
}

// Parse @font-face declarations from CSS.
// We use a brace-matching state machine to handle @font-face blocks correctly
// (the old regex /@font-face\s*\{([^}]+)\}/g broke on `}` inside strings or nested @media).
function parseFontFaces(css) {
  const faces = [];
  const re = /@font-face\s*\{/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const startIdx = re.lastIndex; // position right after the `{`
    let depth = 1;
    let i = startIdx;
    let inString = null;
    while (i < css.length && depth > 0) {
      const c = css[i];
      if (inString) {
        if (c === '\\' && i + 1 < css.length) { i += 2; continue; }
        if (c === inString) inString = null;
        i++;
        continue;
      }
      if (c === '"' || c === "'") { inString = c; i++; continue; }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) break;
      }
      i++;
    }
    const blockContent = css.slice(startIdx, i);
    faces.push(parseFontFace(blockContent));
  }
  return faces;
}

function parseFontFace(block) {
  // Match `property: value;` — the trailing `;` is OPTIONAL (last property may omit it)
  const get = (prop) => {
    const re = new RegExp(`${prop}\\s*:\\s*([^;]+?)(?:;|$)`, 'i');
    const m = block.match(re);
    return m ? m[1].trim() : null;
  };
  const family = get('font-family');
  const weight = get('font-weight') || '400';
  const style = get('font-style') || 'normal';
  const display = get('font-display') || 'swap';
  const srcRaw = get('src') || '';
  // Extract url(...) entries — handle data: URIs and quoted strings
  const srcEntries = [];
  const urlRe = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]+))\s*\)\s*(?:format\(\s*(?:"([^"]*)"|'([^']*)'|([^)]+))\s*\))?/g;
  let um;
  while ((um = urlRe.exec(srcRaw)) !== null) {
    const u = um[1] || um[2] || um[3] || '';
    const fmt = um[4] || um[5] || um[6] || null;
    srcEntries.push({ url: u.trim(), format: fmt ? fmt.trim() : null });
  }
  return { family, weight, style, display, src: srcEntries };
}

function slugifyFont(family, weight, style) {
  const fam = (family || 'unknown').replace(/["']/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
  const w = (weight || '400').replace(/\s+/g, '');
  const s = (style || 'normal').replace(/\s+/g, '');
  return `${fam}-${w}-${s}`;
}

function fetchWithRedirects(targetUrl, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(targetUrl); }
    catch (e) { return reject(new Error(`Invalid URL: ${targetUrl}`)); }
    const lib = parsed.protocol === 'https:' ? https : http;
    const hostname = parsed.hostname.toLowerCase();
    if (!allowPrivate && !allowHosts.has(hostname) && isPrivateIp(parsed.hostname)) {
      return reject(new Error(`SSRF blocked: ${parsed.hostname} is private/loopback. Use --allow-private to override.`));
    }
    const req = lib.get(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; clone-website/1.0)', 'Accept': '*/*' },
      timeout: 30000,
      lookup: allowPrivate ? undefined : (host, opts, cb) => {
        const dns = require('dns');
        dns.lookup(host, opts, (err, address, family) => {
          if (err) return cb(err);
          if (isPrivateIp(address) && !allowHosts.has(host.toLowerCase())) {
            return cb(new Error(`SSRF blocked: ${host} resolves to private IP ${address}. Use --allow-private to override.`));
          }
          cb(null, address, family);
        });
      },
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        const nextUrl = new URL(res.headers.location, targetUrl).href;
        res.resume();
        return resolve(fetchWithRedirects(nextUrl, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const contentLength = parseInt(res.headers['content-length'] || '0', 10);
      if (contentLength > MAX_FILE_SIZE) {
        res.resume();
        return reject(new Error(`Response too large: ${contentLength} bytes (max ${MAX_FILE_SIZE})`));
      }
      const chunks = [];
      let totalSize = 0;
      let tooLarge = false;
      res.on('data', c => {
        if (tooLarge) return;
        totalSize += c.length;
        if (totalSize > MAX_FILE_SIZE) {
          tooLarge = true;
          res.destroy();
          return reject(new Error(`Response exceeded ${MAX_FILE_SIZE} bytes (streaming abort)`));
        }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

async function downloadFont(fontUrl, outAbs) {
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  try {
    const buffer = await fetchWithRedirects(fontUrl);
    fs.writeFileSync(outAbs, buffer);
    return { ok: true, bytes: buffer.length, buffer };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── N4: Global font dedup (hash-based) ─────────────────────────────────
// Fonts are shared across ALL pages (Inter, Azeret Mono, Source Serif 4 etc.)
// Without dedup: 148 fonts × 9 pages = 1332 files (~85% wasted space)
// With dedup: ~20 unique fonts total, reused across pages
const globalFontUrlMap = new Map();

function loadGlobalFontMap(outDir) {
  const mapPath = path.join(outDir, '_font-url-map.json');
  if (fs.existsSync(mapPath)) {
    try {
      return new Map(Object.entries(JSON.parse(fs.readFileSync(mapPath, 'utf-8'))));
    } catch (e) {
      console.warn(`   ⚠️  Failed to load _font-url-map.json: ${e.message}`);
    }
  }
  return new Map();
}

function saveGlobalFontMap(outDir, map) {
  const mapPath = path.join(outDir, '_font-url-map.json');
  fs.writeFileSync(mapPath, JSON.stringify(Object.fromEntries(map), null, 2));
}

function hashFontPath(hash, ext) {
  const prefix = hash.slice(0, 2);
  return path.join('_hash', prefix, `${hash}${ext}`);
}

function formatScore(src) {
  // Lower = better. woff2 = 0 (best), woff = 1, ttf = 2, otf = 3, eot = 4, unknown = 5
  const f = (src.format || '').toLowerCase();
  if (f === 'woff2' || src.url.match(/\.woff2(\?|#|$)/i)) return 0;
  if (f === 'woff' || src.url.match(/\.woff(\?|#|$)/i)) return 1;
  if (f === 'truetype' || src.url.match(/\.ttf(\?|#|$)/i)) return 2;
  if (f === 'opentype' || src.url.match(/\.otf(\?|#|$)/i)) return 3;
  if (f === 'embedded-opentype' || src.url.match(/\.eot(\?|#|$)/i)) return 4;
  return 5;
}

async function processCssFile(cssPath, outDir, pageSlug) {
  console.log(`\n📝 Processing: ${cssPath}`);
  const css = fs.readFileSync(cssPath, 'utf-8');
  const faces = parseFontFaces(css);
  if (faces.length === 0) {
    console.log(`   No @font-face found.`);
    return { cssPath, faces: [], downloads: [], rewrittenCss: '' };
  }
  console.log(`   Found ${faces.length} @font-face declarations`);

  const downloads = [];
  const rewrittenFaces = [];
  for (const face of faces) {
    const slug = slugifyFont(face.family, face.weight, face.style);
    // Sort by format preference — woff2 first, then fallbacks
    const ordered = [...face.src].sort((a, b) => formatScore(a) - formatScore(b));

    // Skip data: URIs — they're already embedded, no download needed
    const downloadable = ordered.filter(s => /^https?:\/\//.test(s.url));
    const dataUris = ordered.filter(s => s.url.startsWith('data:'));
    // Keep relative URLs as-is (would need base URL to download)
    const relativeUrls = ordered.filter(s => !/^https?:\/\//.test(s.url) && !s.url.startsWith('data:'));

    const newSrcEntries = [];

    // Only download the FIRST downloadable URL (best format, usually woff2)
    // This avoids wasting 3-4x bandwidth on redundant format downloads.
    // Browsers will fall back to next format only if the first fails to load —
    // for local mode-faithful clones, woff2 alone is sufficient (98%+ browser support).
    if (downloadable.length > 0) {
      const srcEntry = downloadable[0];
      const parsedUrl = new URL(srcEntry.url);
      const pathname = parsedUrl.pathname || '';
      const ext = path.extname(pathname).toLowerCase()
        || (srcEntry.format === 'woff2' ? '.woff2' : srcEntry.format === 'woff' ? '.woff' : srcEntry.format === 'truetype' ? '.ttf' : '.woff2');

      // ─── N4: Use global font dedup (hash-based) ────────────────────────
      // Check if we've already downloaded this URL
      if (globalFontUrlMap.has(srcEntry.url)) {
        const localRel = globalFontUrlMap.get(srcEntry.url);
        downloads.push({ remoteUrl: srcEntry.url, localPath: localRel, bytes: 0, family: face.family, weight: face.weight, dedupHit: true });
        newSrcEntries.push({ url: localRel, format: srcEntry.format || (ext === '.woff2' ? 'woff2' : ext === '.woff' ? 'woff' : ext === '.ttf' ? 'truetype' : null) });
        continue;
      }

      const filename = `${slug}${ext}`;
      // Write to a temp path first to compute hash, then move to global hash path
      const tmpOutAbs = path.join(outDir, pageSlug, filename);
      const r = await downloadFont(srcEntry.url, tmpOutAbs);
      if (r.ok) {
        // Compute content hash and move to global path
        const hash = crypto.createHash('sha1').update(r.buffer).digest('hex');
        const hashRel = hashFontPath(hash, ext);
        const hashAbs = path.join(outDir, hashRel);
        const localRel = '/' + hashRel.split(path.sep).join('/').replace(/^assets\//, 'assets/fonts/').replace(/^\/?/, '/');
        // For simplicity, use /assets/fonts/_hash/... path
        const fontLocalRel = `/assets/fonts/_hash/${hash.slice(0, 2)}/${hash}${ext}`;

        if (!fs.existsSync(hashAbs)) {
          fs.mkdirSync(path.dirname(hashAbs), { recursive: true });
          fs.copyFileSync(tmpOutAbs, hashAbs);
        }
        // Remove the per-page temp file (keep only the hash-based global file)
        if (fs.existsSync(tmpOutAbs)) fs.unlinkSync(tmpOutAbs);

        console.log(`   ✅ ${face.family} ${face.weight}/${face.style} → ${fontLocalRel} (${(r.bytes / 1024).toFixed(1)} KB)`);
        globalFontUrlMap.set(srcEntry.url, fontLocalRel);
        downloads.push({ remoteUrl: srcEntry.url, localPath: fontLocalRel, bytes: r.bytes, family: face.family, weight: face.weight });
        newSrcEntries.push({ url: fontLocalRel, format: srcEntry.format || (ext === '.woff2' ? 'woff2' : ext === '.woff' ? 'woff' : ext === '.ttf' ? 'truetype' : null) });
      } else {
        console.log(`   ❌ ${face.family} ${face.weight}/${face.style}: ${r.error}`);
        // Try next-best format if available
        for (let i = 1; i < downloadable.length; i++) {
          const fallback = downloadable[i];
          const fbExt = path.extname(new URL(fallback.url).pathname || '') || '.woff2';
          const fbFilename = `${slug}${fbExt}`;
          const fbTmpOutAbs = path.join(outDir, pageSlug, fbFilename);
          const fbR = await downloadFont(fallback.url, fbTmpOutAbs);
          if (fbR.ok) {
            const fbHash = crypto.createHash('sha1').update(fbR.buffer).digest('hex');
            const fbHashRel = hashFontPath(fbHash, fbExt);
            const fbHashAbs = path.join(outDir, fbHashRel);
            const fbLocalRel = `/assets/fonts/_hash/${fbHash.slice(0, 2)}/${fbHash}${fbExt}`;

            if (!fs.existsSync(fbHashAbs)) {
              fs.mkdirSync(path.dirname(fbHashAbs), { recursive: true });
              fs.copyFileSync(fbTmpOutAbs, fbHashAbs);
            }
            if (fs.existsSync(fbTmpOutAbs)) fs.unlinkSync(fbTmpOutAbs);

            console.log(`   ↳ fallback ✅ ${face.family}: ${fbLocalRel} (${(fbR.bytes / 1024).toFixed(1)} KB)`);
            globalFontUrlMap.set(fallback.url, fbLocalRel);
            downloads.push({ remoteUrl: fallback.url, localPath: fbLocalRel, bytes: fbR.bytes, family: face.family, weight: face.weight });
            newSrcEntries.push({ url: fbLocalRel, format: fallback.format });
            break;
          }
        }
        if (newSrcEntries.length === 0) newSrcEntries.push(srcEntry); // give up, keep remote
      }
    }
    // Preserve data: URIs (they're already local)
    for (const du of dataUris) newSrcEntries.push(du);
    // Preserve relative URLs as-is
    for (const ru of relativeUrls) newSrcEntries.push(ru);

    if (newSrcEntries.length === 0) continue; // nothing to emit

    const srcStr = newSrcEntries.map(s => `url(${s.url})${s.format ? ` format("${s.format}")` : ''}`).join(', ');
    rewrittenFaces.push(`@font-face {
  font-family: ${face.family};
  font-weight: ${face.weight};
  font-style: ${face.style};
  font-display: ${face.display};
  src: ${srcStr};
}`);
  }

  const rewrittenCss = rewrittenFaces.join('\n\n');
  return { cssPath, faces, downloads, rewrittenCss };
}

async function processInput(inputPath, outDir, pageSlug) {
  const stat = fs.statSync(inputPath);
  const cssFiles = [];
  if (stat.isDirectory()) {
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, f.name);
        if (f.isDirectory()) walk(full);
        else if (/\.css$/.test(f.name)) cssFiles.push(full);
      }
    };
    walk(inputPath);
  } else {
    cssFiles.push(inputPath);
  }

  const allDownloads = [];
  const allRewrittenCss = [];
  for (const cssFile of cssFiles) {
    const r = await processCssFile(cssFile, outDir, pageSlug);
    if (r.downloads.length) {
      allDownloads.push(...r.downloads);
      allRewrittenCss.push(`/* Source: ${r.cssPath} */\n${r.rewrittenCss}`);
    }
  }

  if (allRewrittenCss.length) {
    const outCssPath = path.join(outDir, pageSlug, 'fonts.css');
    fs.mkdirSync(path.dirname(outCssPath), { recursive: true });
    fs.writeFileSync(outCssPath, allRewrittenCss.join('\n\n'));
    console.log(`\n📄 Generated fonts.css: ${outCssPath}`);
    console.log(`✅ ${allDownloads.length} font files downloaded`);

    // Write fonts-manifest.json for rewrite-asset-urls.js to consume
    const manifestPath = path.join(outDir, pageSlug, 'fonts-manifest.json');
    const manifest = {
      pageSlug,
      outDir: path.resolve(outDir),
      generatedCss: outCssPath,
      downloads: allDownloads.map(d => ({
        remoteUrl: d.remoteUrl,
        localPath: d.localPath,
        family: d.family,
        weight: d.weight,
        bytes: d.bytes,
      })),
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`📋 Wrote fonts-manifest.json: ${manifestPath}`);
  }
  return { downloads: allDownloads, rewrittenCss: allRewrittenCss.join('\n\n') };
}

async function main() {
  const resolvedIn = path.resolve(inputArg);
  if (!fs.existsSync(resolvedIn)) {
    console.error(`Input not found: ${resolvedIn}`);
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });

  // ─── N4: Load existing global font URL map (dedup across pages) ────────
  const existingMap = loadGlobalFontMap(outDir);
  for (const [url, localPath] of existingMap) {
    globalFontUrlMap.set(url, localPath);
  }
  if (existingMap.size > 0) {
    console.log(`\n   📋 Loaded ${existingMap.size} entries from global font URL map (will dedup hits)`);
  }

  if (batch) {
    const pagesDir = resolvedIn;
    const pages = fs.readdirSync(pagesDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
    console.log(`\n🌐 Batch mode: ${pages.length} pages`);
    for (const page of pages) {
      console.log(`\n========== Page: ${page} ==========`);
      await processInput(path.join(pagesDir, page), outDir, page);
    }
  } else {
    await processInput(resolvedIn, outDir, pageSlug);
  }

  // ─── N4: Persist global font URL map for next run ──────────────────────
  saveGlobalFontMap(outDir, globalFontUrlMap);
  console.log(`\n📋 Saved global font URL map (${globalFontUrlMap.size} entries)`);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
