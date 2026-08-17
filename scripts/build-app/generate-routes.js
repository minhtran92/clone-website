#!/usr/bin/env node

/**
 * generate-routes.js
 *
 * Reads sitemap.json from clone-output and generates Next.js App Router
 * file structure (route directories + page.tsx stubs + layout.tsx).
 *
 * Usage: node generate-routes.js <clone-output-dir> <app-output-dir>
 */

const fs = require('fs');
const path = require('path');

// ─── Page type → Next.js route mapping ──────────────────────────
const routeMap = {
  home:         { dir: '',                    isDynamic: false, label: 'Home' },
  product:      { dir: 'shop/[slug]',         isDynamic: true,  label: 'Product Detail' },
  category:     { dir: 'categories/[slug]',   isDynamic: true,  label: 'Category' },
  'drops-list': { dir: 'latest-drops',        isDynamic: false, label: 'Latest Drops' },
  'drop-detail':{ dir: 'latest-drops/[slug]', isDynamic: true,  label: 'Drop Detail' },
  ecommerce:    { dir: null,                  isDynamic: false, label: 'E-commerce' },
  info:         { dir: null,                  isDynamic: false, label: 'Info' },
};

// ─── Helpers ────────────────────────────────────────────────────

/** Extract pathname from URL (handles full URLs like https://domain/path) */
function getPathname(url) {
  if (!url) return '/';
  try {
    const parsed = new URL(url, 'http://dummy');
    return parsed.pathname;
  } catch {
    return url.startsWith('/') ? url : '/' + url;
  }
}

/** Derive route dir from pathname: /wishlist → wishlist, /shop/x → shop/[slug] */
function dirFromPathname(pathname, pageType) {
  if (!pathname || pathname === '/') return '';
  const segments = pathname.replace(/^\/+/, '').replace(/\/+$/, '').split('/');
  
  // Don't make the last segment dynamic if it's a fixed route type
  if (pageType === 'ecommerce' || pageType === 'info') {
    return segments.join('/');
  }
  
  return segments.join('/');
}

/** Get components for a page from its components-raw directory */
function getComponentsForPage(page, cloneOutputDir) {
  const components = [];
  
  // Try per-page directory first
  const pageName = getPathname(page.url)
    .replace(/^\/+/, '')
    .replace(/\/+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '') || 'home';
  
  const candidates = [
    path.join(cloneOutputDir, 'pages', pageName, 'components-raw'),
    path.join(cloneOutputDir, 'components-raw'),
  ];
  
  // Also try matching by URL path segments
  const urlPath = getPathname(page.url);
  if (urlPath && urlPath !== '/') {
    const pathSlug = urlPath.replace(/^\/+/, '').replace(/\/+/g, '-');
    candidates.unshift(path.join(cloneOutputDir, 'pages', pathSlug, 'components-raw'));
  }
  
  for (const dir of candidates) {
    if (fs.existsSync(dir)) {
      try {
        const files = fs.readdirSync(dir)
          .filter(f => f.endsWith('.tsx') && f !== 'Page.tsx');
        for (const f of files) {
          components.push(f.replace('.tsx', ''));
        }
        if (components.length > 0) break; // Found components, stop searching
      } catch {}
    }
  }
  
  return components;
}

/** Filter out shared components (Header, Footer, Navbar, MainContent) from page-specific list */
function getPageSpecificComponents(allComponents) {
  const shared = new Set(['Header', 'Footer', 'Navbar', 'MainContent']);
  return allComponents.filter(c => !shared.has(c));
}

// ─── Template generators ────────────────────────────────────────

function generateLayoutTsx() {
  return `import type { Metadata } from 'next';
import Header from '@/components/shared/Header';
import Footer from '@/components/shared/Footer';
import './globals.css';

export const metadata: Metadata = {
  title: 'RAWLINE',
  description: 'Cloned from rawline.framer.website',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
`;
}

function generateStaticPage(compName, components) {
  const pageComps = getPageSpecificComponents(components);
  const imports = pageComps.length > 0
    ? pageComps.map(c => `import ${c} from '@/components/pages/${compName.toLowerCase()}/${c}';`).join('\n')
    : '';
  
  const renderBody = pageComps.length > 0
    ? pageComps.map(c => `      <${c} />`).join('\n')
    : `      <div>{/* ${compName} content — TODO */}</div>`;

  return `${imports ? imports + '\n\n' : ''}export default function ${compName}Page() {
  return (
    <>
${renderBody}
    </>
  );
}
`;
}

function generateDynamicPage(compName, components) {
  const pageComps = getPageSpecificComponents(components);
  const imports = pageComps.length > 0
    ? pageComps.map(c => `import ${c} from '@/components/pages/${compName.toLowerCase()}/${c}';`).join('\n')
    : '';

  const renderBody = pageComps.length > 0
    ? pageComps.map(c => `      <${c} slug={slug} />`).join('\n')
    : `      <div>{/* ${compName} content for slug: {slug} */}</div>`;

  return `interface PageProps {
  params: { slug: string };
}

${imports ? imports + '\n\n' : ''}export default async function ${compName}Page({ params }: PageProps) {
  const { slug } = params;

  return (
    <>
${renderBody}
    </>
  );
}
`;
}

function generateGlobalsCss() {
  return `@tailwind base;
@tailwind components;
@tailwind utilities;

/* Custom global styles */
`;
}

// ─── Core logic ─────────────────────────────────────────────────

function run(cloneOutputDir, appOutputDir) {
  const sitemapPath = path.join(cloneOutputDir, 'sitemap.json');
  if (!fs.existsSync(sitemapPath)) {
    console.error(`ERROR: sitemap.json not found at ${sitemapPath}`);
    process.exit(1);
  }

  const sitemap = JSON.parse(fs.readFileSync(sitemapPath, 'utf8'));
  const pages = Array.isArray(sitemap) ? sitemap : (sitemap.pages || []);

  if (pages.length === 0) {
    console.warn('No pages in sitemap — nothing to generate.');
    process.exit(0);
  }

  // Load consolidation report
  let report = null;
  const reportPath = path.join(cloneOutputDir, 'consolidation-report.json');
  if (fs.existsSync(reportPath)) {
    try { report = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch {}
  }

  const appDir = path.join(appOutputDir, 'app');
  const sharedCompDir = path.join(appOutputDir, 'components', 'shared');
  fs.mkdirSync(appDir, { recursive: true });
  fs.mkdirSync(sharedCompDir, { recursive: true });

  // ── globals.css ──
  fs.writeFileSync(path.join(appDir, 'globals.css'), generateGlobalsCss(), 'utf8');
  console.log('  ✓ app/globals.css');

  // ── layout.tsx ──
  fs.writeFileSync(path.join(appDir, 'layout.tsx'), generateLayoutTsx(), 'utf8');
  console.log('  ✓ app/layout.tsx');

  // ── Collect unique routes (deduplicate) ──
  const routeMap_unique = new Map(); // routeDir → { pages, components, isDynamic }
  
  for (const page of pages) {
    const pathname = getPathname(page.url);
    let routeDir, isDynamic;
    
    // Resolve route directory
    if (routeMap[page.type] && routeMap[page.type].dir !== null) {
      routeDir = routeMap[page.type].dir;
      isDynamic = routeMap[page.type].isDynamic;
    } else if (routeMap[page.type] && routeMap[page.type].dir === null) {
      // Virtual type (ecommerce/info) — derive from pathname
      routeDir = dirFromPathname(pathname, page.type);
      isDynamic = false;
    } else {
      // Unknown type — derive from pathname
      routeDir = dirFromPathname(pathname, page.type);
      isDynamic = routeDir.includes('[slug]');
    }
    
    // Get components for this page
    const components = getComponentsForPage(page, cloneOutputDir);
    
    if (!routeMap_unique.has(routeDir)) {
      routeMap_unique.set(routeDir, {
        pages: [],
        components: [...components],
        isDynamic,
        pageType: page.type,
        label: page.title || page.type,
      });
    } else {
      // Merge components (union)
      const existing = routeMap_unique.get(routeDir);
      for (const c of components) {
        if (!existing.components.includes(c)) existing.components.push(c);
      }
      existing.pages.push(page);
    }
  }

  // ── Generate page.tsx for each unique route ──
  const routeMetadata = [];
  
  for (const [routeDir, info] of routeMap_unique) {
    const pageDir = path.join(appDir, routeDir);
    fs.mkdirSync(pageDir, { recursive: true });
    
    // Derive component name from route
    const segments = routeDir.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1] || 'Home';
    const compName = lastSegment
      .replace(/\[slug\]/g, 'Detail')
      .replace(/(^|[-_])([a-z])/g, (_, _s, c) => c.toUpperCase());
    
    const content = info.isDynamic
      ? generateDynamicPage(compName, info.components)
      : generateStaticPage(compName, info.components);
    
    const filePath = path.join(pageDir, 'page.tsx');
    fs.writeFileSync(filePath, content, 'utf8');
    
    const relPath = path.relative(appOutputDir, filePath).replace(/\\/g, '/');
    const pageComps = getPageSpecificComponents(info.components);
    console.log(`  ✓ ${relPath}  (${pageComps.length} page-specific components)`);
    
    routeMetadata.push({
      route: routeDir ? `/${routeDir}` : '/',
      filePath: relPath,
      isDynamic: info.isDynamic,
      components: info.components,
      pageSpecificComponents: pageComps,
      label: info.label,
    });
  }

  // ── Copy shared components from components-shared/ ──
  const sharedSrcDir = path.join(cloneOutputDir, 'components-shared');
  let sharedCount = 0;
  if (fs.existsSync(sharedSrcDir)) {
    for (const file of fs.readdirSync(sharedSrcDir)) {
      if (file.endsWith('.tsx') || file.endsWith('.css')) {
        const srcFile = path.join(sharedSrcDir, file);
        const destFile = path.join(sharedCompDir, file);
        if (!fs.existsSync(destFile)) {
          fs.copyFileSync(srcFile, destFile);
          sharedCount++;
        }
      }
    }
  }
  
  // Ensure Header and Footer exist
  for (const name of ['Header', 'Footer', 'Navbar']) {
    const p = path.join(sharedCompDir, `${name}.tsx`);
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, `export default function ${name}() {\n  return <div>{/* ${name} */}</div>;\n}\n`, 'utf8');
      sharedCount++;
    }
  }
  console.log(`  ✓ components/shared/ (${sharedCount} files)`);

  // ── Write routes.json ──
  fs.writeFileSync(
    path.join(appOutputDir, 'routes.json'),
    JSON.stringify(routeMetadata, null, 2),
    'utf8'
  );
  console.log(`  ✓ routes.json (${routeMetadata.length} routes)`);

  // ── Summary ──
  console.log('\n──────────────────────────────────────────');
  console.log(`  Routes generated : ${routeMetadata.length}`);
  console.log(`  Dynamic routes   : ${routeMetadata.filter(r => r.isDynamic).length}`);
  console.log(`  Shared components: ${sharedCount}`);
  console.log(`  Output directory : ${appOutputDir}`);
  console.log('──────────────────────────────────────────\n');
}

// ─── CLI ────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node generate-routes.js <clone-output-dir> <app-output-dir>');
    process.exit(1);
  }

  const cloneOutputDir = path.resolve(args[0]);
  const appOutputDir = path.resolve(args[1]);

  console.log('generate-routes.js');
  console.log(`  clone-output : ${cloneOutputDir}`);
  console.log(`  app-output   : ${appOutputDir}\n`);

  run(cloneOutputDir, appOutputDir);
}

main();
