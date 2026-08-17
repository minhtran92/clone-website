#!/usr/bin/env node
/**
 * split-components.js — Step 3: Split annotated HTML into React component files
 * 
 * Uses cheerio to split HTML by data-component attributes into
 * individual .tsx component skeleton files.
 * 
 * This is MORE ROBUST than html-to-react-components CLI for complex HTML
 * (Framer, Webflow) because cheerio can handle any valid HTML, while
 * html2react's babylon parser crashes on modern JS/CSS syntax.
 * 
 * Fallback: If no data-component attrs found, tries html2react CLI.
 * 
 * Usage:
 *   node split-components.js <input.html> <output-dir>
 *   node split-components.js clone-output/html-annotated/page.sanitized.html clone-output/components-raw
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node split-components.js <input.html> <output-dir>');
    process.exit(1);
  }

  const inputPath = path.resolve(args[0]);
  const outputDir = path.resolve(args[1]);

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const html = fs.readFileSync(inputPath, 'utf-8');
  const $ = cheerio.load(html);

  const components = [];

  // 1. Extract components by data-component attributes
  //    Track top-level vs nested: a component is top-level if none of its
  //    ancestors carries a data-component attribute. Nested components are
  //    still split (so their CSS can be distributed per-component) but they
  //    should NOT be rendered again at the page level — their HTML already
  //    lives inside the parent component's dangerouslySetInnerHTML. Rendering
  //    them twice would duplicate content. (See component-order.json below.)
  $('[data-component]').each((_, el) => {
    const componentName = $(el).attr('data-component');
    if (!componentName) return;

    const tagName = el.tagName || 'div';
    const attrs = { ...$(el).attr() };
    delete attrs['data-component']; // Remove annotation attr

    // Top-level? (no data-component ancestor)
    const isTopLevel = $(el).parents('[data-component]').length === 0;

    // Get inner HTML (children only, not self)
    const innerHtml = $(el).html() || '';

    // Get all class names
    const classes = attrs.class || '';
    delete attrs.class;

    // Get inline style
    const inlineStyle = attrs.style || '';
    delete attrs.style;

    // Collect text content (first 500 chars for preview)
    const textContent = $(el).text().trim().slice(0, 500);

    components.push({
      name: componentName,
      tagName,
      classes,
      inlineStyle,
      innerHtml,
      textContent,
      attrs,
      isTopLevel,
    });
  });

  // 2. If no data-component found, fall back to semantic structure
  if (components.length === 0) {
    console.log('⚠️  No data-component attributes found. Falling back to semantic structure...');
    
    const semanticSelectors = [
      { selector: 'header', name: 'Header' },
      { selector: 'nav', name: 'Navbar' },
      { selector: 'main', name: 'MainContent' },
      { selector: 'footer', name: 'Footer' },
    ];

    for (const { selector, name } of semanticSelectors) {
      const el = $(selector).first();
      if (el.length) {
        components.push({
          name,
          tagName: selector,
          classes: el.attr('class') || '',
          inlineStyle: el.attr('style') || '',
          innerHtml: el.html() || '',
          textContent: el.text().trim().slice(0, 500),
          attrs: {},
        });
      }
    }

    // Also check for <section> tags
    $('section').each((i, el) => {
      const id = $(el).attr('id') || `section-${i + 1}`;
      const name = id.charAt(0).toUpperCase() + id.slice(1).replace(/[-_](\w)/g, (_, c) => c.toUpperCase());
      components.push({
        name,
        tagName: 'section',
        classes: $(el).attr('class') || '',
        inlineStyle: $(el).attr('style') || '',
        innerHtml: $(el).html() || '',
        textContent: $(el).text().trim().slice(0, 500),
        attrs: {},
      });
    });
  }

  // 3. Generate .tsx skeleton files
  console.log(`\n✂️  Splitting into ${components.length} components...\n`);

  const generatedFiles = [];

  for (const comp of components) {
    // Clean inner HTML for the skeleton
    let cleanInnerHtml = comp.innerHtml
      .replace(/\s*data-component="[^"]*"/g, '') // Remove annotation attrs
      .trim();

    // Keep full HTML content — Step 4 (AI Refine) needs the complete data
    // (prices, text, structure) to generate correct Tailwind components.
    // Truncation was causing product prices and deep content to be lost.
    // If HTML is extremely large (>500K), truncate with a warning.
    const MAX_HTML_LEN = 500000;
    if (cleanInnerHtml.length > MAX_HTML_LEN) {
      console.log(`   ⚠️  ${comp.name}: HTML truncated (${cleanInnerHtml.length.toLocaleString()} → ${MAX_HTML_LEN.toLocaleString()} chars)`);
      cleanInnerHtml = cleanInnerHtml.slice(0, MAX_HTML_LEN) + '\n      {/* ... content truncated (exceeds 500K limit) ... */}';
    }

    // Build class string
    const classAttr = comp.classes ? `className="${comp.classes}"` : '';
    
    // Build style string
    const styleAttr = comp.inlineStyle ? `style={{${styleToJsx(comp.inlineStyle)}}}` : '';

    // Build other attributes
    const otherAttrs = Object.entries(comp.attrs)
      .filter(([k]) => k !== 'data-component')
      .map(([k, v]) => `${k}="${v}"`)
      .join(' ');

    // Generate React component code
    const code = generateComponentCode(comp, classAttr, styleAttr, cleanInnerHtml);

    // Write file
    const filename = `${comp.name}.tsx`;
    const filePath = path.join(outputDir, filename);
    fs.writeFileSync(filePath, code, 'utf-8');
    generatedFiles.push(filename);

    console.log(`   📄 ${filename.padEnd(30)} ${comp.tagName.padEnd(10)} ${(comp.textContent.length || 0).toLocaleString().padStart(6)} chars text`);
  }

  // 4. Generate page.tsx that imports all components
  const imports = components
    .map(c => `import ${c.name} from './${c.name}';`)
    .join('\n');

  const jsx = components
    .map(c => `      <${c.name} />`)
    .join('\n');

  const pageCode = `// Auto-generated by clone-website skill — Step 3 output
// This is the SKELETON. Step 4 (AI Refine) will convert to Tailwind + Next.js

import React from 'react';
${imports}

export default function Page() {
  return (
    <div>
${jsx}
    </div>
  );
}
`;

  fs.writeFileSync(path.join(outputDir, 'Page.tsx'), pageCode, 'utf-8');
  generatedFiles.push('Page.tsx');

  // 5. Write component-order.json — document order + top-level vs nested.
  //    generate-page.js renders ONLY top-level components (Navbar, Header,
  //    MainContent, Footer, ...) and imports the CSS of nested ones, because
  //    their HTML already lives inside the parent's dangerouslySetInnerHTML.
  //
  //    ALSO extract the "root wrapper" — Framer wraps the whole page in a
  //    <div class="framer-o7S0T framer-3SRWy ..."> inside <body>. Nearly all
  //    component CSS rules are descendant selectors scoped to that root class
  //    (e.g. `.framer-o7S0T .framer-16mosj6 { display:flex }`). If the clone
  //    omits the wrapper, those rules never match → layout collapses. We capture
  //    the wrapper's tag + className + style here so generate-page.js can re-wrap.
  // ─── Capture the wrapper skeleton ───────────────────────────────────
  // Framer pages have a nested wrapper structure where each top-level component
  // sits inside its OWN intermediate wrapper, and those wrappers are SIBLINGS
  // inside a common ancestor. Example (rawline.framer.website):
  //   <div id="main">
  //     <div class="framer-fXuuj">            ← LCA (common ancestor)
  //       <div class="framer-1oxjr89-container"> <nav/> (Navbar) </div>
  //       <div class="framer-o7S0T" data-framer-root> <main/> (MainContent) </div>
  //       <div class="framer-1bu7syk-container"> <footer/> (Footer) </div>
  //     </div>
  //   </div>
  //
  // Rendering all top-level components inside ONE wrapper (the old approach)
  // breaks the layout — Navbar needs framer-1oxjr89-container's CSS context,
  // MainContent needs framer-o7S0T, Footer needs framer-1bu7syk-container.
  //
  // FIX: capture (a) the COMMON ancestor chain (body → LCA) as rootWrappers,
  // and (b) for each top-level component, the wrapper chain from LCA's child
  // down to (but not including) the component itself, as perComponentWrappers.
  // generate-page.js renders: rootWrappers → [perComponentWrappers → <Comp/>].
  //
  // Helper: serialize a cheerio element into a wrapper descriptor.
  function serializeWrapper(node) {
    const el = node.get(0);
    const a = { ...node.attr() };
    return {
      tag: (el && el.tagName) || 'div',
      className: a.class || '',
      style: a.style || '',
      attrs: Object.fromEntries(Object.entries(a).filter(([k]) => k !== 'class' && k !== 'style')),
    };
  }

  // Top-level components (no data-component ancestor)
  const topLevelComps = components.filter(c => c.isTopLevel);

  // Find LCA (lowest common ancestor) of all top-level component elements.
  // For each top-level comp, build its ancestor path (cheerio elements) up to body.
  // LCA = the last element that is identical across ALL paths (by DOM identity).
  function ancestorPath(compName) {
    const el = $(`[data-component="${compName}"]`).first();
    const path = [];
    let n = el.parent();
    while (n.length && !n.is('body') && !n.is('html')) {
      path.push(n);
      n = n.parent();
    }
    return path; // innermost (direct parent) first, outermost last
  }

  const paths = topLevelComps.map(c => ({ name: c.name, path: ancestorPath(c.name) }));

  // Find LCA: the FIRST index (from innermost=0 outward) where ALL paths converge.
  // In a DOM tree, paths diverge for the first K levels (different branches) then
  // converge at the LCA and stay converged up to <body>. So the LCA is the first
  // index where allSame=true, NOT the last.
  //   Example: Navbar path = [1oxjr89-container, framer-fXuuj, #main]
  //            Main   path = [framer-o7S0T,     framer-fXuuj, #main]
  //            Footer path = [1bu7syk-container, framer-fXuuj, #main]
  //   i=0: all different → not LCA.  i=1: all framer-fXuuj → LCA (depth 1).
  let lcaDepth = Infinity;
  if (paths.length > 0 && paths[0].path.length > 0) {
    const minLen = Math.min(...paths.map(p => p.path.length));
    for (let i = 0; i < minLen; i++) {
      const ref = paths[0].path[i];
      const allSame = paths.every(p => p.path[i] && p.path[i].get(0) === ref.get(0));
      if (allSame) { lcaDepth = i; break; } // first convergence = LCA
    }
  }
  // lcaDepth is the index in each path that is the LCA (the common ancestor).
  // If lcaDepth = Infinity (no common ancestor — shouldn't happen), fall back to body.

  // rootWrappers: from LCA up to (not including) body — outermost first.
  const rootWrappers = [];
  if (paths.length > 0 && lcaDepth !== Infinity) {
    const lcaEl = paths[0].path[lcaDepth];
    // Walk from LCA up to body
    let node = lcaEl;
    while (node.length && !node.is('body') && !node.is('html')) {
      rootWrappers.unshift(serializeWrapper(node));
      node = node.parent();
    }
  }

  // perComponentWrappers: for each top-level comp, the wrappers from LCA's child
  // down to (not including) the component. These sit INSIDE the LCA, as siblings.
  // path[0..lcaDepth-1] are between LCA (path[lcaDepth]) and the component.
  // We want path[lcaDepth-1] down to path[0] (outermost-to-innermost within LCA).
  const perComponentWrappers = {};
  for (const p of paths) {
    // path[0] = direct parent of component; path[lcaDepth] = LCA
    // wrappers between LCA and component = path[lcaDepth-1] ... path[0]
    // (outermost-first order: path[lcaDepth-1] is the LCA's direct child)
    const wrappers = [];
    for (let i = lcaDepth - 1; i >= 0; i--) {
      wrappers.push(serializeWrapper(p.path[i]));
    }
    perComponentWrappers[p.name] = wrappers;
  }

  // ─── Extract SVG sprites (referenced by <use href="#svg-...">) ────────
  // Framer injects <svg id="svg-..." viewBox="..."> sprite definitions at the
  // END of <body> (not inside any [data-component]). They're referenced via
  // <use href="#svg-..."> inside component HTML. Without them, icons (chevrons,
  // logos, etc.) don't render. We extract them as a block so generate-page.js
  // can inject them into the page via a hidden SVG.
  const spriteSvgs = $('svg[id]').filter(function () {
    return /^svg[-0-9]/i.test($(this).attr('id') || '');
  });
  const svgSprites = spriteSvgs.toArray().map(s => $.html(s)).join('\n');
  if (svgSprites) {
    fs.writeFileSync(path.join(outputDir, 'svg-sprites.html'), svgSprites, 'utf-8');
    console.log(`   🎨 SVG sprites: ${spriteSvgs.length} extracted (referenced by <use href="#svg-...">)`);
  }

  const orderManifest = {
    topLevel: components.filter(c => c.isTopLevel).map(c => c.name),
    nested: components.filter(c => !c.isTopLevel).map(c => c.name),
    all: components.map(c => c.name),
    rootWrappers,
    perComponentWrappers,
    hasSvgSprites: svgSprites.length > 0,
  };
  fs.writeFileSync(path.join(outputDir, 'component-order.json'), JSON.stringify(orderManifest, null, 2), 'utf-8');

  console.log(`\n✅ Split complete! Generated ${generatedFiles.length} files in ${outputDir}/`);
  console.log(`   Components: ${components.map(c => c.name).join(', ')}`);
  console.log(`   Top-level: ${orderManifest.topLevel.join(', ')}`);
  console.log(`   Nested (CSS-only): ${orderManifest.nested.join(', ')}`);
  console.log(`   Root wrappers (body→LCA): ${rootWrappers.length} layer(s)`);
  for (const [name, ws] of Object.entries(perComponentWrappers)) {
    console.log(`   ${name} private wrappers: ${ws.length} (${ws.map(w => w.className.split(/\s+/)[0] || w.attrs.id || w.tag).join(' > ') || 'none'})`);
  }
  console.log('');
}

function generateComponentCode(comp, classAttr, styleAttr, innerHtml) {
  // For components with simple text content, generate proper JSX
  // For complex HTML, use dangerouslySetInnerHTML as skeleton (Step 4 will fix)
  
  const hasComplexHtml = innerHtml.length > 1000 || innerHtml.includes('<div') || innerHtml.includes('<section');
  
  if (hasComplexHtml) {
    // Complex: use dangerouslySetInnerHTML as skeleton
    const escapedHtml = innerHtml
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$');

    return `// Auto-generated skeleton by clone-website skill
// Step 4 (AI Refine) will convert to Tailwind + proper JSX
import React from 'react';

interface ${comp.name}Props {
  className?: string;
}

export default function ${comp.name}({ className }: ${comp.name}Props) {
  return (
    <${comp.tagName} ${classAttr} ${styleAttr} {...(className ? { className } : {})}>
      <div dangerouslySetInnerHTML={{ __html: \`${escapedHtml}\` }} />
    </${comp.tagName}>
  );
}
`;
  }

  // Simple: try to generate basic JSX structure
  return `// Auto-generated skeleton by clone-website skill
// Step 4 (AI Refine) will convert to Tailwind + proper JSX
import React from 'react';

interface ${comp.name}Props {
  className?: string;
}

export default function ${comp.name}({ className }: ${comp.name}Props) {
  return (
    <${comp.tagName} ${classAttr} ${styleAttr} {...(className ? { className } : {})}>
      {/* Original content — Step 4 will refine */}
      <div dangerouslySetInnerHTML={{ __html: \`${innerHtml.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$')}\` }} />
    </${comp.tagName}>
  );
}
`;
}

function styleToJsx(styleStr) {
  // Convert CSS style string to JSX style object
  return styleStr
    .split(';')
    .filter(s => s.trim())
    .map(s => {
      const [prop, val] = s.split(':').map(x => x.trim());
      if (!prop || !val) return '';
      // Convert kebab-case to camelCase
      const jsxProp = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      return `${jsxProp}: '${val}'`;
    })
    .filter(Boolean)
    .join(', ');
}

main();
