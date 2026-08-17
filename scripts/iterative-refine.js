#!/usr/bin/env node
/**
 * iterative-refine.js — VLM-guided iterative refinement loop
 * 
 * COMPLETE FLOW (not just instructions — actually applies fixes):
 *   1. Take clone screenshots at multiple scroll positions
 *   2. VLM compare original vs clone (per section)
 *   3. Identify specific visual gaps with fix instructions
 *   4. AI generate ACTUAL code fixes for each component
 *   5. APPLY fixes to component files (write to disk)
 *   6. Wait for dev server HMR, re-compare
 *   7. Repeat until score ≥ threshold (default 8/10) or max iterations
 * 
 * Usage:
 *   node iterative-refine.js --original <original-screenshot.png> --port <3000> --threshold <8> --max-iterations <5> --components-dir <./src/components>
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 90000, ...opts }).trim();
  } catch (e) {
    return (e.stdout || '').trim() || '';
  }
}

function parseAIResponse(raw) {
  // Try to parse as JSON (z-ai API format)
  try {
    const json = JSON.parse(raw);
    return json.choices?.[0]?.message?.content || '';
  } catch {}
  return raw;
}

function extractCodeFromMarkdown(text) {
  // Extract code from ```tsx ... ``` blocks
  const match = text.match(/```(?:tsx|jsx|typescript|javascript)\s*\n([\s\S]*?)```/);
  if (match) return match[1];
  // Try any code block
  const match2 = text.match(/```\s*\n([\s\S]*?)```/);
  if (match2) return match2[1];
  return '';
}

function extractScore(text) {
  // Look for score patterns: "7/10", "7.5/10", "Score: 7"
  const match = text.match(/(\d+(?:\.\d+)?)\s*\/\s*10/);
  if (match) return parseFloat(match[1]);
  const match2 = text.match(/score[:\s]*(\d+(?:\.\d+)?)/i);
  if (match2) return parseFloat(match2[1]);
  return 0;
}

function main() {
  const args = process.argv.slice(2);
  const getArg = (flag) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
  };

  const originalScreenshot = getArg('--original') || '';
  const port = parseInt(getArg('--port') || '3000');
  const threshold = parseInt(getArg('--threshold') || '8');
  const maxIterations = parseInt(getArg('--max-iterations') || '5');
  const componentsDir = getArg('--components-dir') || './src/components';
  const outputDir = getArg('--output-dir') || './qa-iterative';

  if (!originalScreenshot || !fs.existsSync(originalScreenshot)) {
    console.error('Usage: node iterative-refine.js --original <screenshot.png> [--port 3000] [--threshold 8] [--max-iterations 5] [--components-dir ./src/components] [--output-dir ./qa-iterative]');
    process.exit(1);
  }

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  console.log(`\n🔄 Iterative VLM-Guided Refinement (with auto-apply)`);
  console.log(`   Target score: ≥ ${threshold}/10`);
  console.log(`   Max iterations: ${maxIterations}`);
  console.log(`   Original: ${originalScreenshot}`);
  console.log(`   Components dir: ${componentsDir}`);
  console.log(`   Output dir: ${outputDir}`);
  console.log('');

  let currentScore = 0;
  let iteration = 0;
  const scores = [];

  while (currentScore < threshold && iteration < maxIterations) {
    iteration++;
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ITERATION ${iteration}/${maxIterations} — Current score: ${currentScore}/10`);
    console.log(`${'═'.repeat(60)}\n`);

    // ── Step 1: Take clone screenshots at multiple scroll positions ──
    console.log('1️⃣  Taking clone screenshots (multi-scroll)...');
    run(`agent-browser open http://localhost:${port}`, { timeout: 15000 });
    run('agent-browser wait 3000');

    const scrollPositions = [0, 800, 2000, 4000, 6000, 8000];
    const cloneScreenshots = [];

    for (const scrollY of scrollPositions) {
      const shot = path.join(outputDir, `clone-iter${iteration}-scroll${scrollY}.png`);
      run(`agent-browser eval "window.scrollTo(0, ${scrollY})"`, { timeout: 5000 });
      run('agent-browser wait 800');
      run(`agent-browser screenshot "${path.resolve(shot)}"`);
      cloneScreenshots.push({ scrollY, path: shot });
    }
    // Reset scroll
    run('agent-browser eval "window.scrollTo(0, 0)"');

    // ── Step 2: VLM Compare (hero section first, then full page) ──
    console.log('2️⃣  VLM comparing original vs clone...');

    // Full page comparison (top of page)
    const heroVlmPrompt = `You are a pixel-perfect clone reviewer. Compare FIRST (original) vs SECOND (clone). 
Rate fidelity 1-10. 
For EACH difference found, specify:
1. Section name (hero/projects/services/workflow/testimonials/faq/footer)
2. Property that differs (gradient/color/font-size/font-weight/spacing/border-radius/animation/content)
3. Original value (be specific: hex, px, rem, weight number)
4. Clone value (what we currently have)
5. Fix instruction (exact CSS/Tailwind change needed)

Format each issue as:
[SECTION] property: original → clone | Fix: ...`;

    const vlmResult = run(
      `z-ai vision -p "${heroVlmPrompt.replace(/"/g, '\\"')}" -i "${path.resolve(originalScreenshot)}" -i "${path.resolve(cloneScreenshots[0].path)}"`,
      { timeout: 120000 }
    );

    let vlmContent = parseAIResponse(vlmResult);
    currentScore = extractScore(vlmContent);
    scores.push(currentScore);

    console.log(`   VLM Score: ${currentScore}/10`);
    console.log(`   VLM diff chars: ${vlmContent.length}`);

    // Save VLM report
    const reportPath = path.join(outputDir, `vlm-report-iter-${iteration}.md`);
    fs.writeFileSync(reportPath, `# VLM Report — Iteration ${iteration}\n\nScore: ${currentScore}/10\n\n${vlmContent}`, 'utf-8');

    // Check if threshold met
    if (currentScore >= threshold) {
      console.log(`\n🎉 TARGET REACHED! Score: ${currentScore}/10 ≥ ${threshold}/10`);
      break;
    }

    // ── Step 3: Read current component files ──
    console.log('3️⃣  Reading current component files...');
    const componentFiles = {};
    if (fs.existsSync(componentsDir)) {
      const files = fs.readdirSync(componentsDir).filter(f => f.endsWith('.tsx') || f.endsWith('.ts'));
      for (const file of files) {
        const filePath = path.join(componentsDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        componentFiles[file] = content;
        console.log(`   ${file}: ${content.length} chars`);
      }
    }

    // ── Step 4: Generate ACTUAL code fixes ──
    console.log('4️⃣  Generating code fixes (AI)...');

    const componentList = Object.entries(componentFiles)
      .map(([file, code]) => `--- ${file} (${code.length} chars) ---\n${code.slice(0, 2000)}...`)
      .join('\n\n');

    const fixPrompt = `You are fixing a Next.js clone to match the original website. Based on the VLM comparison, generate ACTUAL code fixes.

CURRENT VLM SCORE: ${currentScore}/10 (target: ${threshold}/10)

VLM COMPARISON REPORT:
${vlmContent}

CURRENT COMPONENT CODE (abbreviated):
${componentList}

INSTRUCTIONS:
For EACH visual gap in the VLM report, output the COMPLETE fixed file content.

Rules:
- Output the ENTIRE file content, not just the changed parts
- Use Tailwind v4 utility classes
- Use shadcn/ui components where appropriate  
- Use Framer Motion for animations
- Match EXACT colors, font sizes, font weights from VLM report
- Fix gradient effects (background-clip: text with proper color stops)
- Fix spacing (padding, margin, gap values)
- Fix typography (font-weight, font-size, letter-spacing, line-height)
- Add missing animations (scroll reveal, hover effects)
- Preserve ALL text content

Output format — for each file that needs fixing:
<<<FILE:filename.tsx>>>
(complete file content here)
<<<ENDFILE>>>

Only output files that need changes. Skip files that are already correct.`;

    const tmpFixPrompt = `/tmp/iterative-fix-prompt-${iteration}.txt`;
    fs.writeFileSync(tmpFixPrompt, fixPrompt, 'utf-8');

    const fixResult = run(`z-ai chat -m glm-4-flash -p "$(cat ${tmpFixPrompt})"`, { timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
    let fixContent = parseAIResponse(fixResult);

    // Save fix instructions for debugging
    fs.writeFileSync(
      path.join(outputDir, `fix-raw-iter-${iteration}.md`),
      fixContent,
      'utf-8'
    );

    // ── Step 5: APPLY fixes to component files ──
    console.log('5️⃣  Applying fixes to component files...');

    // Parse <<<FILE:filename.tsx>>> ... <<<ENDFILE>>> blocks
    const fileBlockRegex = /<<<FILE:(.+?)>>>\n([\s\S]*?)<<<ENDFILE>>>/g;
    let match;
    let appliedCount = 0;

    while ((match = fileBlockRegex.exec(fixContent)) !== null) {
      const fileName = match[1].trim();
      const newCode = match[2].trim();

      // Validate the code looks like valid React component
      if (newCode.length > 100 && (newCode.includes('export') || newCode.includes('function') || newCode.includes('const'))) {
        const targetPath = path.join(componentsDir, fileName);

        // Backup original
        if (fs.existsSync(targetPath)) {
          const backupPath = path.join(outputDir, `backup-iter${iteration}-${fileName}`);
          fs.copyFileSync(targetPath, backupPath);
        }

        // Write new code
        fs.writeFileSync(targetPath, newCode, 'utf-8');
        console.log(`   ✅ Applied fix: ${fileName} (${newCode.length} chars)`);
        appliedCount++;
      } else {
        console.log(`   ⚠️  Skipped: ${fileName} — code doesn't look valid (${newCode.length} chars)`);
      }
    }

    // Fallback: if no <<<FILE>>> blocks found, try markdown code blocks
    if (appliedCount === 0) {
      console.log('   No <<<FILE>>> blocks found, trying markdown code blocks...');
      
      // Try to extract component from code blocks with filename hints
      const codeBlockRegex = /```(?:tsx|jsx|typescript)\s*\n([\s\S]*?)```/g;
      let codeMatch;
      let codeBlockIndex = 0;
      
      while ((codeMatch = codeBlockRegex.exec(fixContent)) !== null) {
        const code = codeMatch[1].trim();
        if (code.length > 200 && (code.includes('export') || code.includes('function'))) {
          // Try to determine component name from code
          const nameMatch = code.match(/(?:export\s+default\s+function\s+(\w+)|export\s+function\s+(\w+)|const\s+(\w+)\s*=)/);
          const componentName = nameMatch ? (nameMatch[1] || nameMatch[2] || nameMatch[3]) : null;
          
          if (componentName) {
            const fileName = `${componentName}.tsx`;
            const targetPath = path.join(componentsDir, fileName);
            
            if (fs.existsSync(targetPath)) {
              // Backup
              const backupPath = path.join(outputDir, `backup-iter${iteration}-${fileName}`);
              fs.copyFileSync(targetPath, backupPath);
              
              // Write
              fs.writeFileSync(targetPath, code, 'utf-8');
              console.log(`   ✅ Applied fix (code block): ${fileName} (${code.length} chars)`);
              appliedCount++;
            }
          }
          codeBlockIndex++;
        }
      }
    }

    if (appliedCount === 0) {
      console.log('   ⚠️  No fixes could be applied automatically');
      console.log('   Fix instructions saved to fix-raw-iter for manual review');
    }

    // ── Step 6: Wait for HMR and prepare for next iteration ──
    console.log('6️⃣  Waiting for HMR...');
    // Wait for Next.js HMR to pick up changes
    const waitMs = appliedCount > 0 ? 5000 : 2000;
    run(`sleep ${waitMs / 1000}`);

    console.log(`\n   Iteration ${iteration} summary:`);
    console.log(`   - VLM score: ${currentScore}/10`);
    console.log(`   - Fixes applied: ${appliedCount}`);
    console.log(`   - Report: ${reportPath}`);
    console.log('');

    // If score didn't improve, log warning
    if (scores.length >= 2 && scores[scores.length - 1] <= scores[scores.length - 2]) {
      console.log('   ⚠️  Score did not improve — may need manual intervention');
    }
  }

  // ── Final Summary ──
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  FINAL RESULTS`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Iterations: ${iteration}`);
  console.log(`  Score history: ${scores.join(' → ')}`);
  console.log(`  Final score: ${currentScore}/10`);
  console.log(`  Target met: ${currentScore >= threshold ? '✅ YES' : '❌ NO'}`);
  console.log(`  Reports: ${outputDir}/`);
  console.log(`  Components: ${componentsDir}/`);
  console.log('');

  // Write final summary
  fs.writeFileSync(
    path.join(outputDir, 'summary.md'),
    `# Iterative Refinement Summary\n\n` +
    `- Iterations: ${iteration}\n` +
    `- Score history: ${scores.join(' → ')}\n` +
    `- Final score: ${currentScore}/10\n` +
    `- Target: ${threshold}/10\n` +
    `- Target met: ${currentScore >= threshold ? 'YES' : 'NO'}\n`,
    'utf-8'
  );
}

main();
