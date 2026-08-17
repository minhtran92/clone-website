#!/usr/bin/env node
/**
 * fetch-page.js — Step 1 of the clone-website pipeline
 * 
 * Uses agent-browser to fetch FULL HTML source + computed styles + CSS + screenshots.
 * Falls back to z-ai page_reader if agent-browser is unavailable.
 * 
 * Usage:
 *   node fetch-page.js <url> <output-dir>
 *   node fetch-page.js https://example.com clone-output/html-raw
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 30000, ...opts }).trim();
  } catch (e) {
    return null;
  }
}

function evalJson(expr) {
  const raw = run(`agent-browser eval "${expr.replace(/"/g, '\\"')}"`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {
    try { return JSON.parse(JSON.parse(raw)); } catch { return null; }
  }
}

/**
 * evalString — runs agent-browser eval and parses the JSON result as a string.
 * agent-browser eval returns JSON-encoded values, so strings come back as
 * `"value"` with escaped chars. This function unwraps them.
 */
function evalString(expr) {
  const raw = run(`agent-browser eval "${expr.replace(/"/g, '\\"')}"`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'string' ? parsed : String(parsed);
  } catch {
    // If JSON.parse fails, return raw (might already be unquoted)
    return raw;
  }
}

/**
 * evalNumber — runs agent-browser eval and parses the JSON result as a number.
 */
function evalNumber(expr) {
  const raw = run(`agent-browser eval "${expr.replace(/"/g, '\\"')}"`);
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'number' ? parsed : parseInt(parsed, 10) || 0;
  } catch {
    return parseInt(raw, 10) || 0;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node fetch-page.js <url> <output-dir>');
    process.exit(1);
  }

  const url = args[0];
  const outputDir = path.resolve(args[1]);
  try { new URL(url); } catch { console.error(`Invalid URL: ${url}`); process.exit(1); }
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  console.log(`\n🌐 Fetching: ${url}`);

  const hasAgentBrowser = !!run('which agent-browser');
  if (hasAgentBrowser) {
    console.log('✨ Using agent-browser (full source + computed styles + CSS)\n');
    await fetchWithAgentBrowser(url, outputDir);
  } else {
    console.log('⚠️  agent-browser not found → page_reader fallback\n');
    await fetchWithPageReader(url, outputDir);
  }
}

async function fetchWithAgentBrowser(url, outputDir) {
  // 1. Open page
  console.log('1️⃣  Opening page...');
  run(`agent-browser open "${url}"`, { timeout: 20000 });
  run('agent-browser wait 3000');

  // 2. Full HTML source
  console.log('2️⃣  Full HTML source...');
  const fullHtml = evalString('document.documentElement.outerHTML');
  if (!fullHtml || fullHtml.length < 100) {
    console.error('❌ Failed to get HTML, falling back to page_reader');
    return fetchWithPageReader(url, outputDir);
  }
  fs.writeFileSync(path.join(outputDir, 'page.html'), fullHtml, 'utf-8');
  console.log(`   HTML: ${fullHtml.length.toLocaleString()} chars`);

  const title = evalString('document.title') || 'Untitled';

  // 3. Design tokens — extracted via small evals (now with per-element styles + animations)
  console.log('3️⃣  Extracting design tokens (computed styles + per-element + animations)...');

  const tokens = {};

  // Colors (expanded to 500 elements)
  tokens.colors = evalJson(
    `[...new Set([...document.querySelectorAll('*')].slice(0,500).map(e=>{try{return getComputedStyle(e).color}catch{return''}}).filter(c=>c&&c!=='rgba(0, 0, 0, 0)'))].slice(0,50)`
  ) || [];

  // Background colors
  tokens.bgColors = evalJson(
    `[...new Set([...document.querySelectorAll('*')].slice(0,500).map(e=>{try{return getComputedStyle(e).backgroundColor}catch{return''}}).filter(c=>c&&c!=='rgba(0, 0, 0, 0)'&&c!=='transparent'))].slice(0,50)`
  ) || [];

  // Fonts
  tokens.fonts = evalJson(
    `[...new Set([...document.querySelectorAll('*')].slice(0,500).map(e=>{try{return getComputedStyle(e).fontFamily}catch{return''}}).filter(Boolean))]`
  ) || [];

  // Font sizes
  tokens.fontSizes = evalJson(
    `[...new Set([...document.querySelectorAll('*')].slice(0,500).map(e=>{try{return getComputedStyle(e).fontSize}catch{return''}}).filter(c=>c&&c!=='0px'))].sort()`
  ) || [];

  // NEW: Font weights
  tokens.fontWeights = evalJson(
    `[...new Set([...document.querySelectorAll('*')].slice(0,500).map(e=>{try{return getComputedStyle(e).fontWeight}catch{return''}}).filter(Boolean))].sort()`
  ) || [];

  // NEW: Letter spacings
  tokens.letterSpacings = evalJson(
    `[...new Set([...document.querySelectorAll('*')].slice(0,500).map(e=>{try{return getComputedStyle(e).letterSpacing}catch{return''}}).filter(Boolean))].sort()`
  ) || [];

  // Element count
  tokens.totalElements = evalNumber("document.querySelectorAll('*').length");

  // Style tag count
  tokens.inlineStyleCount = evalNumber("document.querySelectorAll('style').length");

  // Image count
  tokens.imageCount = evalNumber("document.querySelectorAll('img').length");

  // Images (first 50)
  tokens.images = evalJson(
    `[...document.querySelectorAll('img')].slice(0,50).map(i=>({src:i.src,alt:i.alt||'',w:i.naturalWidth,h:i.naturalHeight})).filter(i=>i.src)`
  ) || [];

  // NEW: Per-element computed styles for important elements
  console.log('3b️⃣  Extracting per-element computed styles...');
  const elementStyles = evalJson(
    `(function(){const els=document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,button,nav,header,footer,section,img,[class*=hero],[class*=title],[class*=cta],[class*=btn],[class*=card],[class*=nav],[class*=logo],[class*=feature],[class*=price],[class*=testimonial],[class*=step],[class*=badge],[id]');const r=[];for(const el of els){try{const cs=getComputedStyle(el);const t=(el.textContent||'').trim().slice(0,150);r.push({tag:el.tagName.toLowerCase(),id:el.id||undefined,cls:(el.className||'').toString().slice(0,100)||undefined,text:t||undefined,style:{color:cs.color,backgroundColor:cs.backgroundColor!=='rgba(0,0,0,0)'&&cs.backgroundColor!=='transparent'?cs.backgroundColor:undefined,fontFamily:cs.fontFamily,fontSize:cs.fontSize,fontWeight:cs.fontWeight,letterSpacing:cs.letterSpacing,lineHeight:cs.lineHeight,textTransform:cs.textTransform,paddingTop:cs.paddingTop,paddingRight:cs.paddingRight,paddingBottom:cs.paddingBottom,paddingLeft:cs.paddingLeft,marginTop:cs.marginTop,marginBottom:cs.marginBottom,borderRadius:cs.borderRadius!=='0px'?cs.borderRadius:undefined,boxShadow:cs.boxShadow!=='none'?cs.boxShadow:undefined,display:cs.display,width:cs.width,height:cs.height,maxWidth:cs.maxWidth!=='none'?cs.maxWidth:undefined,gap:cs.gap!=='normal'&&cs.gap!=='0px'?cs.gap:undefined,backgroundImage:cs.backgroundImage!=='none'?cs.backgroundImage.slice(0,200):undefined,transition:cs.transition!=='all 0s ease 0s'?cs.transition.slice(0,200):undefined}})}catch(e){}}return r})()`
  ) || [];
  tokens.elementStyles = elementStyles;
  console.log(`   Element styles: ${elementStyles.length} important elements`);

  // NEW: Animation data
  console.log('3c️⃣  Extracting animation data...');
  const animations = evalJson(
    `(function(){const r=[];try{for(const s of document.styleSheets){try{for(const rule of s.cssRules){if(rule.type===7&&rule.name){r.push({type:'keyframes',name:rule.name,css:rule.cssText.slice(0,1500)})}if(rule.style&&rule.style.transition&&rule.style.transition!=='all 0s ease 0s'&&rule.selectorText&&!rule.selectorText.match(/^framer/)){r.push({type:'transition',selector:rule.selectorText.slice(0,80),value:rule.style.transition.slice(0,200)})}if(rule.style&&rule.style.animation&&rule.selectorText){r.push({type:'animation-prop',selector:rule.selectorText.slice(0,80),value:rule.style.animation.slice(0,200)})}}}catch(e){}}}catch(e){}return r.slice(0,50)})()`
  ) || [];
  tokens.animations = animations;
  console.log(`   Animations: ${animations.length} (keyframes + transitions)`);

  // CSS variables
  console.log('4️⃣  Extracting CSS variables...');
  const cssVarsResult = evalJson(
    `(function(){const v={};try{for(const s of document.styleSheets){try{for(const r of s.cssRules){if(r&&r.style){for(const p of r.style){if(p.startsWith('--')){v[p]=r.style.getPropertyValue(p).trim()}}}}}catch(e){}}}catch(e){}return v})()`
  );
  tokens.cssVars = cssVarsResult || {};

  // Inline CSS text from <style> tags
  console.log('5️⃣  Extracting inline CSS...');
  const styleSizes = evalJson(
    `[...document.querySelectorAll('style')].map(s=>s.textContent.length)`
  ) || [];
  console.log(`   <style> tags: ${tokens.inlineStyleCount} (sizes: ${styleSizes.join(', ')})`);

  // Extract each <style> tag content
  const cssTexts = [];
  for (let i = 0; i < tokens.inlineStyleCount; i++) {
    const cssText = evalString(`document.querySelectorAll('style')[${i}].textContent`);
    if (cssText && cssText.length > 0 && cssText.length < 500000) {
      cssTexts.push(cssText);
    }
  }
  tokens.cssTexts = cssTexts;

  // External stylesheet URLs
  tokens.stylesheets = evalJson(
    `[...document.querySelectorAll('link[rel=stylesheet]')].map(l=>l.href)`
  ) || [];

  // Save design tokens
  fs.writeFileSync(path.join(outputDir, 'design-tokens.json'), JSON.stringify(tokens, null, 2), 'utf-8');

  const allCss = cssTexts.join('\n\n');
  if (allCss) {
    fs.writeFileSync(path.join(outputDir, 'extracted.css'), allCss, 'utf-8');
  }
  if (tokens.stylesheets.length > 0) {
    fs.writeFileSync(path.join(outputDir, 'stylesheets.json'), JSON.stringify(tokens.stylesheets, null, 2), 'utf-8');
  }

  console.log(`   Colors: ${tokens.colors.length}, BG: ${tokens.bgColors.length}, Fonts: ${tokens.fonts.length}`);
  console.log(`   Font weights: ${(tokens.fontWeights||[]).length}, Letter spacings: ${(tokens.letterSpacings||[]).length}`);
  console.log(`   Element styles: ${(tokens.elementStyles||[]).length}, Animations: ${(tokens.animations||[]).length}`);
  console.log(`   CSS vars: ${Object.keys(tokens.cssVars).length}, Images: ${tokens.images.length}`);
  console.log(`   Inline CSS: ${allCss.length.toLocaleString()} chars, External sheets: ${tokens.stylesheets.length}`);

  // 6. Screenshots
  console.log('6️⃣  Screenshots...');
  const qaDir = path.join(outputDir, '..', 'qa');
  if (!fs.existsSync(qaDir)) fs.mkdirSync(qaDir, { recursive: true });

  run('agent-browser set viewport 1440 900');
  run('agent-browser wait 1500');
  run(`agent-browser screenshot "${path.resolve(qaDir, 'screenshot-original-desktop.png')}"`);
  run('agent-browser set viewport 390 844');
  run('agent-browser wait 1500');
  run(`agent-browser screenshot "${path.resolve(qaDir, 'screenshot-original-mobile.png')}"`);
  run('agent-browser set viewport 1440 900');
  console.log('   Desktop ✅ + Mobile ✅');

  // 7. Metadata
  fs.writeFileSync(path.join(outputDir, 'meta.json'), JSON.stringify({
    url, title,
    htmlLength: fullHtml.length,
    cssLength: allCss.length,
    totalElements: tokens.totalElements,
    fetchMethod: 'agent-browser',
    fetchedAt: new Date().toISOString(),
    stats: {
      colors: tokens.colors.length,
      fonts: tokens.fonts.length,
      images: tokens.images.length,
      cssVars: Object.keys(tokens.cssVars).length,
      inlineStyles: tokens.inlineStyleCount,
      stylesheets: tokens.stylesheets.length,
    },
  }, null, 2), 'utf-8');

  console.log(`\n✅ Fetch complete!`);
  console.log(`   Title: ${title}`);
  console.log(`   HTML: ${fullHtml.length.toLocaleString()} chars | CSS: ${allCss.length.toLocaleString()} chars`);
  console.log(`   Elements: ${tokens.totalElements} | Images: ${tokens.images.length}`);
  console.log('');
}

async function fetchWithPageReader(url, outputDir) {
  const jsonOutputPath = path.join(outputDir, 'page-data.json');
  console.log('⏳ Running page_reader (fallback)...');
  run(`z-ai function -n page_reader -a '{"url": "${url}"}' -o "${jsonOutputPath}"`, { stdio: 'inherit' });

  const data = JSON.parse(fs.readFileSync(jsonOutputPath, 'utf-8'));
  const html = data?.data?.html || data?.html || '';
  const title = data?.data?.title || data?.title || 'Untitled';

  if (!html) { console.error('❌ No HTML content'); process.exit(1); }

  fs.writeFileSync(path.join(outputDir, 'page.html'), html, 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'meta.json'), JSON.stringify({
    url, title, htmlLength: html.length,
    fetchMethod: 'page_reader (partial — no scripts/styles)',
    fetchedAt: new Date().toISOString(),
  }, null, 2), 'utf-8');

  console.log(`\n✅ Fetch complete (page_reader fallback)!`);
  console.log(`   ⚠️  Only article content — missing <script>, <style>, external CSS`);
  console.log('');
}

main();
