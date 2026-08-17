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
      const rawValue = m[1];
      // If this is a srcset value, split candidates and take the URL part of each candidate
      // (srcset format: "url1 1x, url2 2x" or "url1 480w, url2 800w")
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

function fetchWithRedirects(targetUrl, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (e) {
      return reject(new Error(`Invalid URL: ${targetUrl}`));
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    // SSRF check: block private/loopback IPs unless --allow-private is set
    const hostname = parsed.hostname.toLowerCase();
    if (!allowPrivate && !allowHosts.has(hostname)) {
      // Resolve hostname and check IPs (covers both literal IPs and hostnames that resolve to private IPs)
      // Synchronous DNS lookup is unavailable in pure Node without dns module; use dns.resolve
      // For simplicity, check literal IPs here; DNS-level check is done at the socket-level via lookup
      if (isPrivateIp(parsed.hostname)) {
        return reject(new Error(`SSRF blocked: ${parsed.hostname} is a private/loopback IP. Use --allow-private to override.`));
      }
    }
    const req = lib.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; clone-website/1.0)',
        'Accept': '*/*',
      },
      timeout: 30000,
      lookup: allowPrivate ? undefined : (hostname, opts, cb) => {
        // Custom DNS lookup that blocks private IPs
        const dns = require('dns');
        dns.lookup(hostname, opts, (err, address, family) => {
          if (err) return cb(err);
          if (isPrivateIp(address) && !allowHosts.has(hostname.toLowerCase())) {
            return cb(new Error(`SSRF blocked: ${hostname} resolves to private IP ${address}. Use --allow-private to override.`));
          }
          cb(null, address, family);
        });
      },
    }, (res) => {
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
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

async function downloadOne(remoteUrl, outDir, pageSlug) {
  const localRel = urlToLocalPath(remoteUrl, pageSlug);
  const localAbs = path.join(outDir, localRel);
  fs.mkdirSync(path.dirname(localAbs), { recursive: true });
  try {
    const { buffer, contentType } = await fetchWithRedirects(remoteUrl);
    fs.writeFileSync(localAbs, buffer);
    return { remoteUrl, localPath: localAbs, localRel: '/' + localRel.replace(/\\/g, '/'), bytes: buffer.length, contentType };
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
    files: perFile.map(f => ({ file: f.file, urls: f.urls })),
    downloads: ok.map(r => ({
      remoteUrl: r.remoteUrl,
      localPath: r.localRel,
      bytes: r.bytes,
      contentType: r.contentType,
    })),
    failures: failed.map(r => ({ remoteUrl: r.remoteUrl, error: r.error })),
  };
  const manifestPath = path.join(outDir, `${pageSlug}-assets-manifest.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\n📄 Manifest: ${manifestPath}`);
  console.log(`✅ Downloaded ${ok.length}/${urlArr.length} assets (${(ok.reduce((s, r) => s + r.bytes, 0) / 1024 / 1024).toFixed(2)} MB)`);
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
