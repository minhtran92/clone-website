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
  $('[data-component]').each((_, el) => {
    const componentName = $(el).attr('data-component');
    if (!componentName) return;

    const tagName = el.tagName || 'div';
    const attrs = { ...$(el).attr() };
    delete attrs['data-component']; // Remove annotation attr

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

  console.log(`\n✅ Split complete! Generated ${generatedFiles.length} files in ${outputDir}/`);
  console.log(`   Components: ${components.map(c => c.name).join(', ')}`);
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
