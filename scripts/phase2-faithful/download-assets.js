#!/usr/bin/env node
/**
 * download-assets.js — Mode Faithful: Tải ảnh + media từ remote URL về local
 *
 * Bước 2.2 của Phase 2 mode-faithful.
 *
 * Mục tiêu:
 *   - Quét HTML/JSX trong clone-output để tìm tất cả URL ảnh/media/fonts remote
 *   - Download về public/assets/{page}/{filename}
 *   - Ghi manifest để bước 2.3 (rewrite-asset-urls.js) dùng
 *
 * Hỗ trợ các pattern URL:
 *   - <img src="https://...">
 *   - <source srcset="https://...">
 *   - <link href="https://..."> (.woff2, .woff, .ttf, .otf, .css với url())
 *   - CSS url(https://...)
 *   - background-image: url(https://...)
 *
 * Skip:
 *   - Data URIs (data:image/...)
 *   - Local URLs (/foo/bar, ./foo/bar)
 *   - Same-origin if URL matches provided --origin
 *
 * Usage:
 *   node download-assets.js <input-dir|input-file> --out <public-assets-dir> --page <slug> [--origin <url>] [--concurrency 8]
 *
 * Examples:
 *   # Download all assets for home page
 *   node download-assets.js clone-output/pages/home/html-annotated/page.sanitized.html \\
 *     --out public/assets/home --page home
 *
 *   # Download all assets for ALL pages
 *   node download-assets.js clone-output/pages --out public/assets --batch
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error(`Usage: node download-assets.js <input> --out <dir> --page <slug> [--origin <url>] [--concurrency 8] [--batch] [--allow-host <hostname>] [--allow-private]

Examples:
  node download-assets.js clone-output/pages/home/html-annotated/page.sanitized.html \\
    --out public/assets/home --page home
  node download-assets.js clone-output/pages --out public/assets --batch

Security:
  By default, requests to private/loopback IPs (127.0.0.1, 10.x, 192.168.x, 169.254.169.254, etc.)
  are blocked to prevent SSRF. Use --allow-private to override (e.g. when cloning localhost).
  Use --allow-host to add specific hostnames to the allowlist (can be repeated).
`);
  process.exit(1);
}

const inputArg = args[0];
const outIdx = args.indexOf('--out');
const pageIdx = args.indexOf('--page');
const originIdx = args.indexOf('--origin');
const concurrencyIdx = args.indexOf('--concurrency');
const batchIdx = args.indexOf('--batch');

const outDir = outIdx > -1 && args.length > outIdx + 1 ? args[outIdx + 1] : 'public/assets';
const pageSlug = pageIdx > -1 && args.length > pageIdx + 1 ? args[pageIdx + 1] : 'unknown';
const origin = originIdx > -1 && args.length > originIdx + 1 ? args[originIdx + 1] : null;
const concurrency = concurrencyIdx > -1 && args.length > concurrencyIdx + 1 ? parseInt(args[concurrencyIdx + 1], 10) : 8;
const batch = batchIdx > -1;

// Collect --allow-host values
const allowHosts = new Set();
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--allow-host' && args.length > i + 1) allowHosts.add(args[i + 1].toLowerCase());
}
const allowPrivate = args.includes('--allow-private');

// Max file size: 25 MB (protect against huge response DoS)
const MAX_FILE_SIZE = 25 * 1024 * 1024;

// === SSRF protection ===
function isPrivateIp(ip) {
  if (!ip) return false;
  // Node v24+ may pass an array (onlookupall) or an object — coerce to string
  if (Array.isArray(ip)) {
    return ip.some(addr => isPrivateIp(addr));
  }
  if (typeof ip !== 'string') {
    ip = String(ip);
  }
  // IPv4
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [parseInt(m[1], 10), parseInt(m[2], 10)];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local + AWS metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  // IPv6
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
  if (lower.startsWith('fe80')) return true; // link-local
  if (lower.startsWith('::ffff:')) {
    // IPv4-mapped IPv6
    const v4 = lower.slice('::ffff:'.length);
    return isPrivateIp(v4);
  }
  return false;
}

// === URL extraction patterns ===
const URL_PATTERNS = [
  // <img src="..."> and <source src="..."> (single URL)
  /\bsrc=["']([^"']+)["']/g,
  // <source srcset="url 1x, url 2x"> OR <img srcset="url 480w, url 800w">
  // We capture the whole srcset value, then split candidates separately (below).
  /\bsrcset=["']([^"']+)["']/g,
  // <link href="...">
  /\bhref=["']([^"']+)["']/g,
  // CSS url(...)
  /url\(["']?([^"')]+)["']?\)/g,
  // Open Graph + meta content (filtered by extension below)
  /\bcontent=["']([^"']+\.(?:jpg|jpeg|png|gif|webp|svg|avif|mp4|webm|mp3|woff2?|ttf|otf|eot|css))["']/gi,
];

function isAllowedRemoteUrl(candidate) {
  if (candidate.startsWith('data:')) return false;
  if (candidate.startsWith('#')) return false;
  if (candidate.startsWith('mailto:')) return false;
  if (candidate.startsWith('javascript:')) return false;
  if (candidate.startsWith('blob:')) return false;
  if (candidate.startsWith('about:')) return false;
  if (!/^https?:\/\//.test(candidate)) return false;
  return true;
}

function extractUrls(content) {
  const urls = new Set();
  for (const re of URL_PATTERNS) {
    let m;
    while ((m = re.exec(content)) !== null) {
      // Decode HTML entities (&amp; → &) — Framer's HTML contains these
      const rawValue = m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      // If this is a srcset value, split candidates and take the URL part of each candidate
      const isSrcset = re.source.includes('srcset');
      const candidates = isSrcset
        ? rawValue.split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean)
        : [rawValue.trim()];
      for (const candidate of candidates) {
        if (!isAllowedRemoteUrl(candidate)) continue;
        // Skip same-origin if specified
        if (origin && candidate.startsWith(origin)) continue;
        urls.add(candidate);
      }
    }
  }
  return [...urls];
}

function urlToLocalPath(remoteUrl, pageSlug) {
  const parsed = new URL(remoteUrl);
  const pathname = parsed.pathname || '';
  let filename = path.basename(pathname).split('?')[0].split('#')[0];
  // Strip query in filename
  filename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!filename || filename === '') {
    filename = 'asset_' + Math.random().toString(36).slice(2, 8);
  }
  // Group by domain to avoid name clashes
  const host = (parsed.hostname || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
  // Limit filename length
  if (filename.length > 80) {
    const ext = path.extname(filename);
    const base = path.basename(filename, ext).slice(0, 80 - ext.length);
    filename = base + ext;
  }
  return path.join(pageSlug, host, filename);
}

// ─── N4: Global content-hash dedup ──────────────────────────────────────
// Files are stored globally (not per-page) by content-hash.
//   public/assets/_hash/{hash-prefix}/{full-hash}.{ext}
// Multiple pages referencing the same remote URL → 1 file on disk.
// Multiple different URLs pointing to identical content → 1 file on disk.
// Saves ~60% storage on multi-page clones.
//
// Map structure (persisted at public/assets/_hash/url-map.json):
//   { remoteUrl: "/assets/_hash/ab/abc123...def.jpg" }
// This map is shared across all pages via --batch mode.

function loadGlobalUrlMap(outDir) {
  const mapPath = path.join(outDir, '_hash', 'url-map.json');
  if (fs.existsSync(mapPath)) {
    try {
      return new Map(Object.entries(JSON.parse(fs.readFileSync(mapPath, 'utf-8'))));
    } catch (e) {
      console.warn(`   ⚠️  Failed to load url-map.json: ${e.message}`);
    }
  }
  return new Map();
}

function saveGlobalUrlMap(outDir, map) {
  const mapPath = path.join(outDir, '_hash', 'url-map.json');
  fs.mkdirSync(path.dirname(mapPath), { recursive: true });
  fs.writeFileSync(mapPath, JSON.stringify(Object.fromEntries(map), null, 2));
  console.log(`   📋 Global URL map: ${map.size} entries → ${mapPath}`);
}

function hashToPath(hash, ext) {
  // Use first 2 chars as a sub-directory shard (like git objects)
  // to avoid 10k+ files in one flat directory
  // NOTE: returns path RELATIVE to public/ (so the URL becomes "/assets/_hash/...")
  // since outDir is typically "public/assets" and Next.js serves public/* at /*
  const prefix = hash.slice(0, 2);
  return path.join('assets', '_hash', prefix, `${hash}${ext}`);
}

function getExtFromUrl(remoteUrl, contentType) {
  // Try URL path extension first
  let ext = path.extname(new URL(remoteUrl).pathname || '').toLowerCase();
  // Fallback to content-type
  if (!ext && contentType) {
    const ct = contentType.split(';')[0].trim();
    const ctMap = {
      'image/jpeg': '.jpg', 'image/jpg': '.jpg',
      'image/png': '.png', 'image/gif': '.gif',
      'image/webp': '.webp', 'image/svg+xml': '.svg',
      'image/avif': '.avif', 'image/bmp': '.bmp',
      'video/mp4': '.mp4', 'video/webm': '.webm',
      'audio/mpeg': '.mp3', 'audio/ogg': '.ogg',
      'font/woff2': '.woff2', 'font/woff': '.woff',
      'application/font-woff2': '.woff2', 'application/font-woff': '.woff',
      'application/octet-stream': '', // unknown — leave to URL ext
    };
    ext = ctMap[ct] || ext;
  }
  // Normalize .jpeg → .jpg
  if (ext === '.jpeg') ext = '.jpg';
  return ext;
}

// Global cache of already-downloaded URLs (in-memory, for current process run)
const globalUrlMap = new Map();
const globalHashMap = new Set(); // hash strings we've already written this run

function fetchWithRedirects(targetUrl, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (e) {
      return reject(new Error(`Invalid URL: ${targetUrl}`));
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const hostname = parsed.hostname.toLowerCase();
    if (!allowPrivate && !allowHosts.has(hostname) && isPrivateIp(parsed.hostname)) {
      return reject(new Error(`SSRF blocked: ${parsed.hostname} is private/loopback. Use --allow-private to override.`));
    }

    // ─── SSRF protection via DNS pre-resolution ───────────────────────────
    // Node v24's http.get `lookup` option has issues with callback signature.
    // Instead, we pre-resolve the hostname, check if it's private,
    // then connect to the IP directly with proper servername for TLS SNI.
    if (allowPrivate || allowHosts.has(hostname)) {
      // Skip DNS check — use default behavior
      const req = lib.get(targetUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; clone-website/1.0)', 'Accept': '*/*' },
        timeout: 30000,
      }, handleResponse);
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('timeout')));
      return;
    }
    const dns = require('dns');
    dns.resolve4(parsed.hostname, (err, addresses) => {
      if (err) {
        // Fallback to default behavior (Node will use its own lookup)
        const req = lib.get(targetUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; clone-website/1.0)', 'Accept': '*/*' },
          timeout: 30000,
        }, handleResponse);
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('timeout')));
        return;
      }
      if (!addresses || addresses.length === 0) {
        return reject(new Error(`No DNS records for ${parsed.hostname}`));
      }
      // Check all resolved IPs for SSRF
      for (const addr of addresses) {
        if (isPrivateIp(addr) && !allowHosts.has(hostname)) {
          return reject(new Error(`SSRF blocked: ${hostname} resolves to private IP ${addr}. Use --allow-private to override.`));
        }
      }
      // Connect to first IP with servername for TLS SNI
      const req = lib.get({
        host: addresses[0],
        servername: parsed.hostname,
        path: parsed.pathname + parsed.search,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; clone-website/1.0)',
          'Accept': '*/*',
          'Host': parsed.hostname,
        },
        timeout: 30000,
      }, handleResponse);
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('timeout')));
    });

    function handleResponse(res) {
      // Handle redirects
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
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] || '' }));
    }
  });
}

async function downloadOne(remoteUrl, outDir, pageSlug) {
  // ─── N4: Check global URL cache ──────────────────────────────────────
  // If we've already downloaded this exact URL in this session, reuse
  if (globalUrlMap.has(remoteUrl)) {
    return {
      remoteUrl,
      localPath: globalUrlMap.get(remoteUrl), // already includes leading "/"
      localRel: globalUrlMap.get(remoteUrl),
      bytes: 0, // we don't re-read the file to compute size; cost is zero
      contentType: '',
      dedupHit: true,
    };
  }

  const localRel = urlToLocalPath(remoteUrl, pageSlug);
  const localAbs = path.join(outDir, localRel);
  fs.mkdirSync(path.dirname(localAbs), { recursive: true });
  try {
    const { buffer, contentType } = await fetchWithRedirects(remoteUrl);

    // ─── N4: Compute content-hash, store globally ───────────────────────
    const hash = crypto.createHash('sha1').update(buffer).digest('hex');
    const ext = getExtFromUrl(remoteUrl, contentType);
    const globalRel = hashToPath(hash, ext);
    const globalAbs = path.join(outDir, globalRel);

    if (fs.existsSync(globalAbs)) {
      // Hash collision (same content from different URL) — reuse existing file
      const localPath = '/' + globalRel.replace(/\\/g, '/');
      globalUrlMap.set(remoteUrl, localPath);
      return {
        remoteUrl,
        localPath,
        localRel,
        bytes: buffer.length,
        contentType,
        dedupHit: true,
      };
    }

    // Write to global hash-based path
    fs.mkdirSync(path.dirname(globalAbs), { recursive: true });
    fs.writeFileSync(globalAbs, buffer);

    const localPath = '/' + globalRel.replace(/\\/g, '/');
    globalUrlMap.set(remoteUrl, localPath);
    globalHashMap.add(hash);

    return {
      remoteUrl,
      localPath,
      localRel: localPath, // alias for rewrite-asset-urls.js compatibility
      bytes: buffer.length,
      contentType,
      dedupHit: false,
    };
  } catch (e) {
    return { remoteUrl, error: e.message, localPath: null };
  }
}

async function processInput(inputPath, outDir, pageSlug) {
  const stat = fs.statSync(inputPath);
  const files = [];
  if (stat.isDirectory()) {
    // Walk dir, find .html, .tsx, .css files
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, f.name);
        if (f.isDirectory()) walk(full);
        else if (/\.(html?|tsx?|jsx?|css)$/.test(f.name)) files.push(full);
      }
    };
    walk(inputPath);
  } else {
    files.push(inputPath);
  }

  const allUrls = new Set();
  const perFile = [];
  for (const f of files) {
    const content = fs.readFileSync(f, 'utf-8');
    const urls = extractUrls(content);
    if (urls.length) {
      perFile.push({ file: f, urls });
      urls.forEach(u => allUrls.add(u));
    }
  }

  console.log(`\n📦 Found ${allUrls.size} unique remote URLs across ${perFile.length} files`);
  if (allUrls.size === 0) {
    console.log('   Nothing to download. Exiting.');
    return { total: 0, ok: 0, failed: 0, manifest: { files: [], downloads: [] } };
  }

  const urlArr = [...allUrls];
  const results = [];
  // Limited concurrency
  let i = 0;
  const queue = async () => {
    while (i < urlArr.length) {
      const idx = i++;
      const u = urlArr[idx];
      process.stdout.write(`   [${idx + 1}/${urlArr.length}] ${u.slice(0, 100)}... `);
      const r = await downloadOne(u, outDir, pageSlug);
      if (r.error) {
        console.log(`❌ ${r.error}`);
      } else {
        console.log(`✅ ${(r.bytes / 1024).toFixed(1)} KB → ${r.localRel}`);
      }
      results.push(r);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, queue));

  const ok = results.filter(r => !r.error);
  const failed = results.filter(r => r.error);

  // Write manifest
  const manifest = {
    pageSlug,
    inputDir: path.resolve(inputPath),
    outDir: path.resolve(outDir),
    totalUrls: urlArr.length,
    ok: ok.length,
    failed: failed.length,
    dedupHits: ok.filter(r => r.dedupHit).length,
    newDownloads: ok.filter(r => !r.dedupHit).length,
    files: perFile.map(f => ({ file: f.file, urls: f.urls })),
    downloads: ok.map(r => ({
      remoteUrl: r.remoteUrl,
      localPath: r.localPath,
      bytes: r.bytes,
      contentType: r.contentType,
      dedupHit: r.dedupHit || false,
    })),
    failures: failed.map(r => ({ remoteUrl: r.remoteUrl, error: r.error })),
  };
  const manifestPath = path.join(outDir, `${pageSlug}-assets-manifest.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // ─── N4: Persist global URL map for next run ────────────────────────
  saveGlobalUrlMap(outDir, globalUrlMap);

  console.log(`\n📄 Manifest: ${manifestPath}`);
  console.log(`✅ Downloaded ${ok.length}/${urlArr.length} assets (${(ok.reduce((s, r) => s + r.bytes, 0) / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`   📊 New: ${manifest.newDownloads} | Dedup hits: ${manifest.dedupHits}`);
  if (failed.length) {
    console.log(`❌ Failed: ${failed.length}`);
    failed.slice(0, 5).forEach(f => console.log(`   - ${f.remoteUrl.slice(0, 100)}: ${f.error}`));
  }
  return manifest;
}

async function main() {
  const resolvedIn = path.resolve(inputArg);
  if (!fs.existsSync(resolvedIn)) {
    console.error(`Input not found: ${resolvedIn}`);
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });

  // ─── N4: Load existing global URL map (so dedup persists across runs) ───
  const existingMap = loadGlobalUrlMap(outDir);
  for (const [url, localPath] of existingMap) {
    globalUrlMap.set(url, localPath);
  }
  if (existingMap.size > 0) {
    console.log(`\n   📋 Loaded ${existingMap.size} entries from global URL map (will dedup hits)`);
  }

  if (batch) {
    // Iterate all subdirs of pages/
    const pagesDir = resolvedIn;
    const pages = fs.readdirSync(pagesDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
    console.log(`\n🌐 Batch mode: ${pages.length} pages found`);
    for (const page of pages) {
      const pageOutDir = path.join(outDir, page);
      const pageInputDir = path.join(pagesDir, page);
      console.log(`\n────── Page: ${page} ──────`);
      await processInput(pageInputDir, pageOutDir, page);
    }
  } else {
    await processInput(resolvedIn, outDir, pageSlug);
  }
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
