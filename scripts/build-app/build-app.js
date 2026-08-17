#!/usr/bin/env node
/**
 * build-app.js — Full pipeline orchestrator for clone-to-app
 * 
 * Reads clone-output from clone-website skill and produces a Next.js App Router project.
 * 
 * Pipeline:
 *   Step A: CONSOLIDATE — Merge shared components (Header, Footer, etc.)
 *   Step B: REFINE — AI refine each component (CSS → Tailwind + React state)
 *   Step C: GENERATE — Create Next.js App Router routes & layout
 * 
 * Usage:
 *   node build-app.js <clone-output-dir> <app-output-dir> [options]
 * 
 * Options:
 *   --skip-refine    Skip AI refinement (use skeletons as-is)
 *   --model <model>  LLM model for refinement (default: glm-4-flash)
 *   --pages <n>      Limit number of pages to process (default: all)
 *   --verbose        Show detailed progress
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─── CLI Args ────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node build-app.js <clone-output-dir> <app-output-dir> [options]');
  console.error('Options:');
  console.error('  --skip-refine    Skip AI refinement step');
  console.error('  --model <m>      LLM model (default: glm-4-flash)');
  console.error('  --pages <n>      Limit pages to process');
  console.error('  --verbose        Detailed progress');
  process.exit(1);
}

const cloneDir = path.resolve(args[0]);
const appDir = path.resolve(args[1]);
const skipRefine = args.includes('--skip-refine');
const modelIdx = args.indexOf('--model');
const model = modelIdx >= 0 ? args[modelIdx + 1] : 'glm-4-flash';
const pagesIdx = args.indexOf('--pages');
const maxPages = pagesIdx >= 0 ? parseInt(args[pagesIdx + 1]) : Infinity;
const verbose = args.includes('--verbose');

const log = (msg) => console.log(msg);
const vlog = (msg) => verbose && console.log(`  [verbose] ${msg}`);

// ─── Paths ──────────────────────────────────────────────────────
const scriptsDir = __dirname;
const consolidateScript = path.join(scriptsDir, 'consolidate-components.js');
const refineScript = path.join(scriptsDir, 'refine-component.js');
const generateScript = path.join(scriptsDir, 'generate-routes.js');

// ─── Step A: CONSOLIDATE ────────────────────────────────────────
function runConsolidate() {
  log('\n━━━ Step A: CONSOLIDATE — Merge shared components ━━━');
  
  if (!fs.existsSync(consolidateScript)) {
    console.error('  ERROR: consolidate-components.js not found at ' + consolidateScript);
    process.exit(1);
  }

  const cmd = `node "${consolidateScript}" "${cloneDir}"`;
  vlog('Command: ' + cmd);
  
  try {
    const output = execSync(cmd, { 
      cwd: cloneDir, 
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60000 
    });
    log(output);
  } catch (err) {
    console.error('  ERROR in consolidate step:', err.message);
    if (err.stdout) log(err.stdout);
    process.exit(1);
  }

  // Verify output
  const sharedDir = path.join(cloneDir, 'components-shared');
  const reportFile = path.join(cloneDir, 'consolidation-report.json');
  
  if (!fs.existsSync(sharedDir)) {
    console.error('  ERROR: components-shared/ not created');
    process.exit(1);
  }
  
  if (fs.existsSync(reportFile)) {
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf-8'));
    log(`  ✅ Consolidated: ${report.sharedComponents?.length || 0} shared, ${report.pageSpecificCount || '?'} page-specific`);
  }
}

// ─── Step B: REFINE ─────────────────────────────────────────────
function runRefine() {
  log('\n━━━ Step B: REFINE — AI refine components (CSS → Tailwind) ━━━');
  
  if (skipRefine) {
    log('  ⏭️  Skipped (--skip-refine flag)');
    copySkeletonsAsIs();
    return;
  }

  const sharedDir = path.join(cloneDir, 'components-shared');
  const refinedDir = path.join(appDir, 'components', 'shared');
  fs.mkdirSync(refinedDir, { recursive: true });

  // Find design tokens
  let tokensPath = '';
  const tokensCandidates = [
    path.join(cloneDir, 'html-raw', 'design-tokens.json'),
    path.join(cloneDir, 'pages', 'home', 'html-raw', 'design-tokens.json'),
  ];
  for (const p of tokensCandidates) {
    if (fs.existsSync(p)) { tokensPath = p; break; }
  }

  // Collect all components to refine (shared first, then page-specific)
  const componentsToRefine = [];

  // Shared components
  if (fs.existsSync(sharedDir)) {
    for (const file of fs.readdirSync(sharedDir)) {
      if (file.endsWith('.tsx')) {
        componentsToRefine.push({
          name: file.replace('.tsx', ''),
          tsx: path.join(sharedDir, file),
          css: path.join(sharedDir, file.replace('.tsx', '.css')),
          output: refinedDir,
          type: 'shared'
        });
      }
    }
  }

  // Page-specific components
  const reportFile = path.join(cloneDir, 'consolidation-report.json');
  if (fs.existsSync(reportFile)) {
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf-8'));
    for (const [pageName, info] of Object.entries(report.pageSpecific || {})) {
      if (!info.components) continue;
      const pageRefinedDir = path.join(appDir, 'components', 'pages', pageName);
      fs.mkdirSync(pageRefinedDir, { recursive: true });
      
      for (const comp of info.components) {
        const pageCompDir = path.join(cloneDir, 'pages', pageName, 'components-raw');
        const tsxPath = path.join(pageCompDir, comp + '.tsx');
        const cssPath = path.join(cloneDir, 'pages', pageName, 'components-css', comp + '.css');
        
        if (fs.existsSync(tsxPath)) {
          componentsToRefine.push({
            name: comp,
            tsx: tsxPath,
            css: fs.existsSync(cssPath) ? cssPath : '',
            output: pageRefinedDir,
            type: 'page-specific',
            page: pageName
          });
        }
      }
    }
  }

  // Also refine home page components from root level
  const rootCompDir = path.join(cloneDir, 'components-raw');
  if (fs.existsSync(rootCompDir)) {
    const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf-8')) : {};
    const sharedNames = new Set((report.sharedComponents || []).map(c => c.name));
    
    for (const file of fs.readdirSync(rootCompDir)) {
      if (file.endsWith('.tsx') && file !== 'Page.tsx' && !sharedNames.has(file.replace('.tsx', ''))) {
        const compName = file.replace('.tsx', '');
        const homeRefinedDir = path.join(appDir, 'components', 'pages', 'home');
        fs.mkdirSync(homeRefinedDir, { recursive: true });
        
        componentsToRefine.push({
          name: compName,
          tsx: path.join(rootCompDir, file),
          css: path.join(cloneDir, 'components-css', compName + '.css'),
          output: homeRefinedDir,
          type: 'home-specific'
        });
      }
    }
  }

  log(`  Found ${componentsToRefine.length} components to refine`);
  
  let refined = 0;
  let failed = 0;
  let skipped = 0;

  for (const comp of componentsToRefine) {
    const label = comp.type === 'shared' ? `shared/${comp.name}` : `${comp.page || 'home'}/${comp.name}`;
    log(`\n  Refining: ${label}`);
    
    let cmd = `node "${refineScript}" "${comp.tsx}" "${comp.output}"`;
    if (comp.css && fs.existsSync(comp.css)) cmd += ` --css "${comp.css}"`;
    if (tokensPath) cmd += ` --tokens "${tokensPath}"`;
    cmd += ` --model ${model}`;
    
    vlog('Command: ' + cmd);
    
    try {
      const output = execSync(cmd, {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        timeout: 180000 // 3 min per component
      });
      vlog(output);
      refined++;
      log(`    ✅ Refined → ${comp.output}`);
    } catch (err) {
      failed++;
      log(`    ❌ Failed: ${err.message.slice(0, 100)}`);
      // Copy skeleton as fallback
      try {
        const dest = path.join(comp.output, comp.name + '.tsx');
        fs.copyFileSync(comp.tsx, dest);
        log(`    📋 Copied skeleton as fallback`);
      } catch {}
    }
  }

  log(`\n  📊 Refinement summary: ${refined} refined, ${failed} failed, ${skipped} skipped`);
}

function copySkeletonsAsIs() {
  log('\n  Copying skeletons as-is (no AI refinement)...');
  
  // Copy shared components
  const sharedSrc = path.join(cloneDir, 'components-shared');
  const sharedDest = path.join(appDir, 'components', 'shared');
  
  if (fs.existsSync(sharedSrc)) {
    fs.mkdirSync(sharedDest, { recursive: true });
    for (const file of fs.readdirSync(sharedSrc)) {
      if (file.endsWith('.tsx') || file.endsWith('.css')) {
        fs.copyFileSync(path.join(sharedSrc, file), path.join(sharedDest, file));
      }
    }
    log(`  Copied ${fs.readdirSync(sharedDest).length} shared component files`);
  }

  // Copy CSS files too
  const sharedCssSrc = path.join(cloneDir, 'components-shared');
  if (fs.existsSync(sharedCssSrc)) {
    for (const file of fs.readdirSync(sharedCssSrc)) {
      if (file.endsWith('.css')) {
        const dest = path.join(sharedDest, file);
        if (!fs.existsSync(dest)) {
          fs.copyFileSync(path.join(sharedCssSrc, file), dest);
        }
      }
    }
  }
}

// ─── Step C: GENERATE ───────────────────────────────────────────
function runGenerate() {
  log('\n━━━ Step C: GENERATE — Create Next.js App Router structure ━━━');
  
  if (!fs.existsSync(generateScript)) {
    console.error('  ERROR: generate-routes.js not found at ' + generateScript);
    process.exit(1);
  }

  const cmd = `node "${generateScript}" "${cloneDir}" "${appDir}"`;
  vlog('Command: ' + cmd);
  
  try {
    const output = execSync(cmd, { 
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000 
    });
    log(output);
  } catch (err) {
    console.error('  ERROR in generate step:', err.message);
    if (err.stdout) log(err.stdout);
    process.exit(1);
  }

  // Verify output
  const layoutFile = path.join(appDir, 'app', 'layout.tsx');
  if (fs.existsSync(layoutFile)) {
    log('  ✅ layout.tsx generated');
  }
  
  const routesFile = path.join(appDir, 'routes.json');
  if (fs.existsSync(routesFile)) {
    const routes = JSON.parse(fs.readFileSync(routesFile, 'utf-8'));
    log(`  ✅ ${routes.length || 0} routes mapped`);
  }
}

// ─── Step D: COPY ASSETS ────────────────────────────────────────
function copyAssets() {
  log('\n━━━ Step D: COPY ASSETS ━━━');
  
  const publicDir = path.join(appDir, 'public');
  fs.mkdirSync(publicDir, { recursive: true });

  // Copy screenshots as reference
  const qaDir = path.join(cloneDir, 'qa');
  if (fs.existsSync(qaDir)) {
    const refDir = path.join(publicDir, 'reference');
    fs.mkdirSync(refDir, { recursive: true });
    for (const file of fs.readdirSync(qaDir)) {
      if (file.endsWith('.png') || file.endsWith('.jpg')) {
        fs.copyFileSync(path.join(qaDir, file), path.join(refDir, file));
        vlog(`Copied ${file} → public/reference/`);
      }
    }
  }

  // Copy design tokens
  const tokensCandidates = [
    path.join(cloneDir, 'html-raw', 'design-tokens.json'),
    path.join(cloneDir, 'pages', 'home', 'html-raw', 'design-tokens.json'),
  ];
  for (const p of tokensCandidates) {
    if (fs.existsSync(p)) {
      fs.copyFileSync(p, path.join(appDir, 'design-tokens.json'));
      log('  ✅ Design tokens copied');
      break;
    }
  }
}

// ─── Generate Summary ───────────────────────────────────────────
function generateSummary() {
  log('\n━━━ BUILD SUMMARY ━━━');
  
  const summary = {
    builtAt: new Date().toISOString(),
    cloneDir: cloneDir,
    appDir: appDir,
    skipRefine: skipRefine,
    model: model,
    structure: {}
  };

  // Count files
  function countFiles(dir, ext) {
    if (!fs.existsSync(dir)) return 0;
    return fs.readdirSync(dir, { recursive: true })
      .filter(f => typeof f === 'string' && f.endsWith(ext))
      .length;
  }

  summary.structure = {
    sharedComponents: countFiles(path.join(appDir, 'components', 'shared'), '.tsx'),
    pageComponents: countFiles(path.join(appDir, 'components', 'pages'), '.tsx'),
    routes: countFiles(path.join(appDir, 'app'), '.tsx'),
    cssFiles: countFiles(path.join(appDir, 'components'), '.css'),
  };

  log(`  Shared components: ${summary.structure.sharedComponents}`);
  log(`  Page-specific components: ${summary.structure.pageComponents}`);
  log(`  Route files: ${summary.structure.routes}`);
  log(`  CSS files: ${summary.structure.cssFiles}`);
  log(`  Output: ${appDir}`);

  fs.writeFileSync(path.join(appDir, 'build-summary.json'), JSON.stringify(summary, null, 2));
  log('\n  ✅ Build complete! Summary saved to build-summary.json');
}

// ─── Main ───────────────────────────────────────────────────────
function main() {
  log('╔════════════════════════════════════════════════════════════╗');
  log('║           clone-to-app — Full Pipeline Builder             ║');
  log('╚════════════════════════════════════════════════════════════╝');
  log(`  Input:  ${cloneDir}`);
  log(`  Output: ${appDir}`);
  log(`  Model:  ${model}`);
  log(`  Refine: ${skipRefine ? 'SKIPPED' : 'ENABLED'}`);

  // Ensure output directory
  fs.mkdirSync(appDir, { recursive: true });

  // Run pipeline
  runConsolidate();
  runRefine();
  runGenerate();
  copyAssets();
  generateSummary();
}

main();
