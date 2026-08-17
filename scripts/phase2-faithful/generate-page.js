#!/usr/bin/env node
/**
 * generate-page.js — F4 + N9: Generate real React component tree in page.tsx
 *
 * F4 (NEW): Bỏ dangerouslySetInnerHTML — dùng real React component tree
 *   - Trước đây: page.tsx = `fs.readFileSync(html) + dangerouslySetInnerHTML`
 *   - Bây giờ: page.tsx = imports {Header, HeroSection, MainContent, Footer} + composes
 *   - Lợi ích: React tree thực sự, có thể customize per-component, hot-reload nhanh hơn
 *
 * N9 (NEW): Real React component tree
 *   - Mỗi component từ components-raw/ → ported sang src/components/pages/{page}/
 *   - page.tsx imports và compose các components này
 *   - Layout: <Header/> + <MainContent/> + <Footer/>
 *
 * Output:
 *   - src/app/{route}/page.tsx — Next.js App Router page that imports real components
 *
 * Usage:
 *   node generate-page.js <components-dir> <output-page.tsx> --page <slug> [--route <path>]
 *
 * Examples:
 *   node generate-page.js src/components/pages/home src/app/page.tsx --page home --route /
 *   node generate-page.js src/components/pages/about src/app/about/page.tsx --page about --route /about
 */

const fs = require('fs');
const path = require('path');

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error(`Usage: node generate-page.js <components-dir> <output-page.tsx> --page <slug> [--route <path>]

Examples:
  node generate-page.js src/components/pages/home src/app/page.tsx --page home --route /
  node generate-page.js src/components/pages/about src/app/about/page.tsx --page about --route /about
`);
    process.exit(1);
  }

  const componentsDir = path.resolve(args[0]);
  const outputPagePath = path.resolve(args[1]);
  const pageIdx = args.indexOf('--page');
  const routeIdx = args.indexOf('--route');

  const pageSlug = pageIdx > -1 && args.length > pageIdx + 1 ? args[pageIdx + 1] : 'unknown';
  const routePath = routeIdx > -1 && args.length > routeIdx + 1 ? args[routeIdx + 1] : `/${pageSlug}`;

  if (!fs.existsSync(componentsDir)) {
    console.error(`✖ Components dir not found: ${componentsDir}`);
    process.exit(1);
  }

  // ─── 1. Discover component files ───────────────────────────────────
  const componentFiles = fs.readdirSync(componentsDir)
    .filter(f => f.endsWith('.tsx') && f !== 'Page.tsx' && f !== 'PageFaithful.tsx')
    .map(f => f.replace('.tsx', ''));

  if (componentFiles.length === 0) {
    console.error(`✖ No component .tsx files found in ${componentsDir}`);
    process.exit(1);
  }

  // ─── 1b. Read component-order.json (top-level vs nested) ──────────
  // Written by split-components.js. top-level components are rendered as React
  // components; nested components live INSIDE a parent's dangerouslySetInnerHTML
  // (e.g. Hero/About/Features sit inside <MainContent>), so rendering them again
  // would duplicate content. We still import their .css so the styles apply to
  // the HTML inside the parent.
  const orderManifestPath = path.join(componentsDir, 'component-order.json');
  let topLevel = [];
  let allNames = [];
  let rootWrappers = [];
  let perComponentWrappers = {};
  if (fs.existsSync(orderManifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(orderManifestPath, 'utf-8'));
      topLevel = (manifest.topLevel || []).filter(n => componentFiles.includes(n));
      allNames = manifest.all || componentFiles;
      rootWrappers = manifest.rootWrappers || (manifest.rootWrapper ? [manifest.rootWrapper] : []);
      perComponentWrappers = manifest.perComponentWrappers || {};
    } catch (e) {
      console.warn(`   ⚠️  Failed to parse component-order.json: ${e.message}`);
    }
  }
  // Fallback (legacy): no manifest → treat all as top-level, heuristic order
  if (topLevel.length === 0) {
    const order = ['Header', 'Navbar', 'MainContent', 'HeroSection', 'HeroSlider', 'Banner', 'Carousel', 'FeaturesGrid', 'ServicesSection', 'AboutSection', 'TeamSection', 'Testimonials', 'Reviews', 'PricingSection', 'CTASection', 'ContactSection', 'FAQSection', 'StatsSection', 'BlogSection', 'Gallery', 'VideoSection', 'MapSection', 'Sidebar', 'Footer'];
    for (const name of order) if (componentFiles.includes(name)) topLevel.push(name);
    for (const name of componentFiles) if (!topLevel.includes(name)) topLevel.push(name);
    allNames = componentFiles;
  }
  const nestedNames = allNames.filter(n => !topLevel.includes(n));

  console.log(`\n📄 N9: Generating page.tsx with real React component tree`);
  console.log(`   Components dir: ${componentsDir}`);
  console.log(`   Output: ${outputPagePath}`);
  console.log(`   Total components: ${componentFiles.length}`);
  console.log(`   Render (top-level): ${topLevel.join(' → ')}`);
  console.log(`   CSS-only (nested): ${nestedNames.join(', ') || '(none)'}`);

  // ─── 3. Generate page.tsx ─────────────────────────────────────────
  // Use relative import path from outputPagePath to componentsDir
  const relPath = path.relative(path.dirname(outputPagePath), componentsDir);
  const importPath = relPath.startsWith('.') ? relPath : './' + relPath;

  // React imports: ONLY top-level components (rendered below).
  const reactImports = topLevel
    .map(name => `import ${name} from '${importPath}/${name}';`)
    .join('\n');

  // FramerReveal: client component that re-enables Framer's scroll-reveal
  // animations for [data-framer-appear-id] elements WITHOUT the Framer runtime.
  // (Framer runtime is stripped in sanitize — N3; appear-id attrs preserved — N8.)
  // Only included if the component file exists in the components dir.
  const framerRevealPath = path.join(componentsDir, 'FramerReveal.tsx');
  const framerRevealImport = fs.existsSync(framerRevealPath)
    ? `import FramerReveal from '${importPath}/FramerReveal';\n`
    : '';
  const framerRevealJsx = fs.existsSync(framerRevealPath) ? `      <FramerReveal />\n` : '';

  // SVG sprites — Framer injects <svg id="svg-..."> sprite definitions at the
  // end of <body>. Component HTML references them via <use href="#svg-...">.
  // Without them, icons (chevrons, logos, cart icon) don't render.
  // We inject them as a hidden <svg> block via dangerouslySetInnerHTML.
  const svgSpritesPath = path.join(componentsDir, 'svg-sprites.html');
  let svgSpritesJsx = '';
  if (fs.existsSync(svgSpritesPath)) {
    const spritesHtml = fs.readFileSync(svgSpritesPath, 'utf-8');
    // Escape for JSX template literal
    const escaped = spritesHtml.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    svgSpritesJsx = `      <svg aria-hidden="true" style={{ position: 'absolute', width: '0', height: '0', overflow: 'hidden' }} dangerouslySetInnerHTML={{ __html: \`${escaped}\` }} />\n`;
    console.log(`   🎨 SVG sprites: injected (${spritesHtml.length} chars)`);
  }

  // CSS imports: nested components' .css (top-level ones import their own .css
  // via port-html-to-jsx). The nested sections' HTML lives inside a parent
  // component's dangerouslySetInnerHTML, so their styles must be loaded here to
  // apply. Also import shared.css (unmatched classed rules). Side-effect imports
  // keep selectors literal (no hashing) → fidelity 1:1.
  const cssImports = [];
  for (const name of nestedNames) {
    if (fs.existsSync(path.join(componentsDir, `${name}.css`))) {
      cssImports.push(`import '${importPath}/${name}.css';`);
    }
  }
  if (fs.existsSync(path.join(componentsDir, 'shared.css'))) {
    cssImports.push(`import '${importPath}/shared.css';`);
  }
  const cssImportsStr = cssImports.length > 0 ? cssImports.join('\n') + '\n' : '';

  // ─── Build the wrapper skeleton ─────────────────────────────────────
  // Framer wraps each top-level component in its OWN intermediate wrapper, and
  // those wrappers are SIBLINGS inside a common ancestor (LCA). The structure:
  //   <LCA>
  //     <nav-wrapper> <Navbar/> </nav-wrapper>
  //     <main-wrapper data-framer-root> <MainContent/> </main-wrapper>
  //     <footer-wrapper> <Footer/> </footer-wrapper>
  //   </LCA>
  // We render: rootWrappers (body→LCA) wrapping a list of [perComponentWrappers → <Comp/>].
  // Captured by split-components.js (LCA = lowest common ancestor of top-level comps).

  // Helper: serialize a wrapper descriptor → JSX opening tag (with className/style/attrs)
  function wrapperToOpen(w, indent) {
    const tag = w.tag || 'div';
    const parts = [];
    if (w.className) parts.push(`className="${w.className}"`);
    if (w.style) {
      const styleObj = w.style
        .split(';').map(s => s.trim()).filter(Boolean)
        .map(decl => {
          const idx = decl.indexOf(':');
          if (idx === -1) return null;
          let prop = decl.slice(0, idx).trim();
          const val = decl.slice(idx + 1).trim();
          if (!prop || !val) return null;
          let jsxProp;
          if (prop.startsWith('--')) jsxProp = `'${prop}'`;
          else jsxProp = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase()).replace(/^-([a-z])/, (_, c) => c.toUpperCase());
          return `${jsxProp}: '${val.replace(/'/g, "\\'")}'`;
        })
        .filter(Boolean)
        .join(', ');
      if (styleObj) parts.push(`style={{ ${styleObj} }}`);
    }
    for (const [k, v] of Object.entries(w.attrs || {})) {
      parts.push(`${k}="${String(v).replace(/"/g, '&quot;')}"`);
    }
    return `${indent}<${tag} ${parts.join(' ')}>`;
  }
  function wrapperToClose(w, indent) {
    return `${indent}</${w.tag || 'div'}>`;
  }

  // Build the full indented JSX for the page body.
  // Structure:
  //   <rootWrapper[0]>
  //     <rootWrapper[1]>
  //       ...<rootWrapper[N-1]>   (LCA — innermost root wrapper)
  //         <perCompWrapper[0]>...<perCompWrapper[M-1]>
  //           <Component />
  //         </perCompWrapper[M-1]>...</perCompWrapper[0]>
  //         ... (next top-level comp)
  //       </rootWrapper[N-1]>
  //     </rootWrapper[1]>
  //   </rootWrapper[0]>
  const bodyLines = [];
  const ROOT_BASE = '      '; // 6 spaces (under <main data-page>)
  let wrapperNote = '';

  if (rootWrappers && rootWrappers.length > 0) {
    // Open root wrappers (outermost → innermost=LCA)
    rootWrappers.forEach((w, i) => {
      bodyLines.push(wrapperToOpen(w, ROOT_BASE + '  '.repeat(i)));
    });
    const lcaDepth = rootWrappers.length; // indentation level inside LCA
    const compBaseIndent = ROOT_BASE + '  '.repeat(lcaDepth);

    // For each top-level component, render its private wrappers + the component
    topLevel.forEach((name, ci) => {
      const privWrappers = (perComponentWrappers && perComponentWrappers[name]) || [];
      privWrappers.forEach((w, i) => {
        bodyLines.push(wrapperToOpen(w, compBaseIndent + '  '.repeat(i)));
      });
      const compIndent = compBaseIndent + '  '.repeat(privWrappers.length);
      bodyLines.push(`${compIndent}<${name} />`);
      // close private wrappers (innermost → outermost)
      for (let i = privWrappers.length - 1; i >= 0; i--) {
        bodyLines.push(wrapperToClose(privWrappers[i], compBaseIndent + '  '.repeat(i)));
      }
    });

    // Close root wrappers (innermost=LCA → outermost)
    for (let i = rootWrappers.length - 1; i >= 0; i--) {
      bodyLines.push(wrapperToClose(rootWrappers[i], ROOT_BASE + '  '.repeat(i)));
    }

    const lca = rootWrappers[rootWrappers.length - 1];
    wrapperNote = `// Wrapped in ${rootWrappers.length} root wrapper(s) (body→LCA${lca.className ? `: .${lca.className.split(/\s+/)[0]}` : ''}). Each top-level component sits inside its OWN intermediate wrapper (captured from the original DOM) so descendant CSS selectors match.`;
    console.log(`   🎯 Root wrappers (body→LCA): ${rootWrappers.length} layer(s)${lca.className ? ` — LCA: .${lca.className.split(/\s+/)[0]}` : ''}`);
    for (const name of topLevel) {
      const ws = (perComponentWrappers && perComponentWrappers[name]) || [];
      console.log(`   ${name}: ${ws.length} private wrapper(s)${ws.length ? ` — .${(ws[ws.length-1].className || ws[ws.length-1].attrs.id || '').split(/\s+/)[0]}` : ''}`);
    }
  } else {
    wrapperNote = `// ⚠️  No root wrappers found in manifest — rendering components flat (layout may break).`;
    topLevel.forEach(name => bodyLines.push(`${ROOT_BASE}<${name} />`));
    console.warn(`   ⚠️  No rootWrappers in manifest — descendant CSS rules may not match.`);
  }

  const bodyJsx = bodyLines.join('\n');

  const pageCode = `// Auto-generated by clone-website/scripts/phase2-faithful/generate-page.js
// Real React component tree (F4: no dangerouslySetInnerHTML, N9: imports real components)
// Option 1: per-component plain .css (literal selectors) — <main data-page> scopes the page.
// Top-level components are rendered; nested sections' CSS is imported so styles apply
// to the HTML inside parent components' dangerouslySetInnerHTML.
${wrapperNote}

${reactImports}
${framerRevealImport}${cssImportsStr}
export const metadata = {
  title: '${pageSlug}',
  description: 'Cloned page from rawline.framer.website (Mode Faithful)',
};

export default function Page() {
  return (
    <main data-page="${pageSlug}">
${bodyJsx}
${framerRevealJsx}${svgSpritesJsx}    </main>
  );
}
`;

  fs.mkdirSync(path.dirname(outputPagePath), { recursive: true });
  fs.writeFileSync(outputPagePath, pageCode, 'utf-8');

  console.log(`\n✅ Generated ${outputPagePath}`);
  console.log(`   ${topLevel.length} top-level components rendered`);
  console.log(`   ${cssImports.length} CSS imports (nested + shared)`);
  console.log(`   Each component is a real React component (not HTML blob)`);
  console.log(`\n   💡 Run dev server to see your cloned page:`);
  console.log(`      Visit: http://localhost:3000${routePath === '/' ? '' : routePath}`);
  console.log('');
}

main();
