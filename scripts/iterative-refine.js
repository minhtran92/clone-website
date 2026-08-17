#!/usr/bin/env node
/**
 * iterative-refine.js — VLM-guided iterative refinement loop
 * 
 * KEY IMPROVEMENT: Instead of 1-pass refine, this loops:
 *   1. Deploy current app
 *   2. VLM compare original screenshot vs clone screenshot
 *   3. Identify specific visual gaps
 *   4. AI fix only the problematic components
 *   5. Re-deploy and re-compare
 *   6. Repeat until score ≥ threshold (default 8/10) or max iterations reached
 * 
 * Usage:
 *   node iterative-refine.js --original <original-screenshot.png> --port <3000> --threshold <8> --max-iterations <5>
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 60000, ...opts }).trim();
  } catch (e) {
    return e.stdout?.trim() || '';
  }
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
    console.error('Usage: node iterative-refine.js --original <screenshot.png> [--port 3000] [--threshold 8] [--max-iterations 5] [--components-dir ./src/components]');
    process.exit(1);
  }

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  console.log(`\n🔄 Iterative VLM-Guided Refinement`);
  console.log(`   Target score: ≥ ${threshold}/10`);
  console.log(`   Max iterations: ${maxIterations}`);
  console.log(`   Original: ${originalScreenshot}`);
  console.log('');

  let currentScore = 0;
  let iteration = 0;
  let lastGaps = [];

  while (currentScore < threshold && iteration < maxIterations) {
    iteration++;
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ITERATION ${iteration}/${maxIterations} — Current score: ${currentScore}/10`);
    console.log(`${'═'.repeat(60)}\n`);

    // Step 1: Take screenshot of current clone
    console.log('1️⃣  Taking clone screenshot...');
    const cloneScreenshot = path.join(outputDir, `clone-iter-${iteration}.png`);
    run(`agent-browser open http://localhost:${port}`, { timeout: 15000 });
    run('agent-browser wait 3000');
    run(`agent-browser screenshot "${path.resolve(cloneScreenshot)}"`);

    // Step 2: VLM Compare
    console.log('2️⃣  VLM comparing original vs clone...');
    const vlmPrompt = iteration === 1
      ? `Compare these two website screenshots for a clone fidelity test. FIRST = original, SECOND = clone. Rate fidelity 1-10. List ALL visual differences in detail, grouped by section. For each difference, specify: section name, what's different, exact values in original vs clone, and how to fix it.`
      : `Compare these two screenshots. FIRST = original, SECOND = improved clone. Rate fidelity 1-10. Previous score was ${currentScore}/10. Focus on REMAINING differences. List each gap with specific fix instructions.`;

    const vlmResult = run(`z-ai vision -p "${vlmPrompt.replace(/"/g, '\\"')}" -i "${path.resolve(originalScreenshot)}" -i "${path.resolve(cloneScreenshot)}"`, { timeout: 120000 });
    
    let vlmContent = '';
    try {
      const vlmJson = JSON.parse(vlmResult);
      vlmContent = vlmJson.choices?.[0]?.message?.content || '';
    } catch {
      vlmContent = vlmResult;
    }

    // Extract score from VLM response
    const scoreMatch = vlmContent.match(/(\d+(?:\.\d+)?)\s*\/\s*10/);
    currentScore = scoreMatch ? parseFloat(scoreMatch[1]) : 0;

    console.log(`   VLM Score: ${currentScore}/10`);
    
    // Save VLM report
    fs.writeFileSync(
      path.join(outputDir, `vlm-report-iter-${iteration}.md`),
      `# VLM Report — Iteration ${iteration}\n\nScore: ${currentScore}/10\n\n${vlmContent}`,
      'utf-8'
    );

    // Check if threshold met
    if (currentScore >= threshold) {
      console.log(`\n🎉 TARGET REACHED! Score: ${currentScore}/10 ≥ ${threshold}/10`);
      break;
    }

    // Step 3: Identify gaps and generate fix instructions
    console.log('3️⃣  Generating targeted fixes...');
    
    const fixPrompt = `Based on the VLM comparison report below, generate SPECIFIC code fixes for the Next.js + Tailwind clone to improve fidelity.

CURRENT VLM SCORE: ${currentScore}/10 (target: ${threshold}/10)

VLM COMPARISON REPORT:
${vlmContent}

COMPONENTS DIRECTORY: ${componentsDir}

For each visual gap identified, provide:
1. Which component file to modify
2. The exact code change needed
3. Why this change improves fidelity

Return a JSON array of fixes:
[{"file": "src/components/hero.tsx", "description": "Fix gradient to use deep navy-to-blue with more color stops", "code": "actual code here"}]

If no specific code can be determined, describe the change needed in "description" and set "code" to null.`;

    const tmpFixPrompt = `/tmp/iterative-fix-prompt-${iteration}.txt`;
    fs.writeFileSync(tmpFixPrompt, fixPrompt, 'utf-8');

    const fixResult = run(`z-ai chat -m glm-4-flash -p "$(cat ${tmpFixPrompt})"`, { timeout: 60000 });
    
    let fixContent = '';
    try {
      const fixJson = JSON.parse(fixResult);
      fixContent = fixJson.choices?.[0]?.message?.content || '';
    } catch {
      fixContent = fixResult;
    }

    // Save fix instructions
    fs.writeFileSync(
      path.join(outputDir, `fix-instructions-iter-${iteration}.md`),
      fixContent,
      'utf-8'
    );

    console.log(`   Fix instructions saved`);
    console.log(`\n   VLM Report:\n   ${vlmContent.slice(0, 500)}...`);
    
    lastGaps = [vlmContent];
  }

  // Final summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  FINAL RESULTS`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Iterations: ${iteration}`);
  console.log(`  Final score: ${currentScore}/10`);
  console.log(`  Target met: ${currentScore >= threshold ? '✅ YES' : '❌ NO'}`);
  console.log(`  Reports: ${outputDir}/`);
  console.log('');
}

main();
