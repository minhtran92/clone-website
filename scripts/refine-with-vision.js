#!/usr/bin/env node
/**
 * refine-with-vision.js — Phase 2 Creative: VLM-guided component refinement
 * 
 * KEY IMPROVEMENT over refine-component.js:
 * 1. Uses VLM to ANALYZE the original screenshot → generate detailed visual spec
 * 2. Feeds visual spec + skeleton + per-element styles + design tokens to LLM
 * 3. LLM produces Next.js + Tailwind v4 + shadcn/ui code matching the visual spec
 * 
 * Usage:
 *   node refine-with-vision.js <component> --screenshot <original.png> --skeleton <Component.tsx> --tokens <design-tokens.json> --output <output-dir>
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 120000, ...opts }).trim();
  } catch (e) {
    return e.stdout?.trim() || '';
  }
}

function main() {
  const args = process.argv.slice(2);
  const componentName = args[0];
  
  // Parse args
  const getArg = (flag) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
  };

  const screenshotPath = getArg('--screenshot');
  const skeletonPath = getArg('--skeleton');
  const tokensPath = getArg('--tokens');
  const elementStylesPath = getArg('--element-styles');
  const outputDir = getArg('--output') || '.';
  const cssPath = getArg('--css');

  if (!componentName || !screenshotPath) {
    console.error('Usage: node refine-with-vision.js <ComponentName> --screenshot <original.png> --skeleton <Component.tsx> --tokens <tokens.json> [--element-styles <styles.json>] [--output <dir>] [--css <Component.css>]');
    process.exit(1);
  }

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  console.log(`\n🎨 Refining: ${componentName} (VLM-guided)`);

  // Step 1: VLM Analyze the screenshot for this section
  console.log('1️⃣  VLM analyzing original screenshot...');
  let visualSpec = '';
  
  if (fs.existsSync(screenshotPath)) {
    const vlmPrompt = `You are a senior UI/UX designer analyzing a website section for pixel-perfect cloning into Next.js + Tailwind v4 + shadcn/ui.

Analyze this screenshot of the "${componentName}" section in extreme detail:

1. EXACT LAYOUT: Describe the precise layout structure (flex/grid, direction, gaps, alignment)
2. EXACT COLORS: List every visible color with hex values (backgrounds, text, borders, gradients, overlays)
3. EXACT TYPOGRAPHY: For each text element, specify: font-family, font-size (px/rem), font-weight, letter-spacing, line-height, text-transform, color
4. EXACT SPACING: Padding and margin values for each container and element
5. VISUAL EFFECTS: Gradients (exact color stops), shadows (exact values), border-radius, opacity, backdrop-blur
6. INTERACTIVE STATES: Describe hover effects, transitions, animations visible
7. IMAGES/MEDIA: Describe any images, their aspect ratios, positioning, overlays
8. RESPONSIVE NOTES: How this section would adapt to mobile/tablet

Output as a structured specification that a developer can follow exactly. Use specific pixel/rem values, not vague descriptions.`;

    const vlmResult = run(`z-ai vision -p "${vlmPrompt.replace(/"/g, '\\"')}" -i "${path.resolve(screenshotPath)}"`);
    
    // Parse VLM response
    try {
      const vlmJson = JSON.parse(vlmResult);
      visualSpec = vlmJson.choices?.[0]?.message?.content || '';
    } catch {
      visualSpec = vlmResult.slice(0, 5000);
    }
    
    console.log(`   VLM spec: ${visualSpec.length} chars`);
  } else {
    console.log('   ⚠️  No screenshot found, skipping VLM analysis');
  }

  // Step 2: Load skeleton component (actual HTML content)
  console.log('2️⃣  Loading skeleton + styles...');
  let skeletonCode = '';
  if (skeletonPath && fs.existsSync(skeletonPath)) {
    skeletonCode = fs.readFileSync(skeletonPath, 'utf-8');
    console.log(`   Skeleton: ${skeletonCode.length} chars`);
  }

  // Step 3: Load design tokens (with per-element styles)
  console.log('3️⃣  Loading design tokens...');
  let tokensData = {};
  if (tokensPath && fs.existsSync(tokensPath)) {
    tokensData = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
  }
  
  // Load per-element computed styles
  let elementStyles = [];
  if (elementStylesPath && fs.existsSync(elementStylesPath)) {
    const esData = JSON.parse(fs.readFileSync(elementStylesPath, 'utf-8'));
    elementStyles = esData.elementStyles || [];
    console.log(`   Element styles: ${elementStyles.length} elements`);
  }

  // Load component CSS
  let componentCss = '';
  if (cssPath && fs.existsSync(cssPath)) {
    componentCss = fs.readFileSync(cssPath, 'utf-8');
    console.log(`   CSS: ${componentCss.length} chars`);
  }

  // Step 4: Build comprehensive LLM prompt with ALL data
  console.log('4️⃣  Building AI refine prompt...');
  
  // Summarize tokens (keep it concise but complete)
  const tokensSummary = {
    colors: tokensData.colors || [],
    bgColors: tokensData.bgColors || [],
    fonts: tokensData.fonts || [],
    fontSizes: tokensData.fontSizes || [],
    font: tokensData.fontWeights || [],
    letterSpacings: tokensData.letterSpacings || [],
    lineHeights: tokensData.lineHeights || [],
    borderRadius: tokensData.borderRadius || [],
    shadows: tokensData.shadows || [],
    animations: (tokensData.animations || []).slice(0, 20),
  };

  // Filter element styles for this component only
  const relevantStyles = elementStyles.filter(el => {
    const cls = el.cls || '';
    const text = el.text || '';
    return cls.toLowerCase().includes(componentName.toLowerCase()) ||
           text.length > 0;
  }).slice(0, 100);

  const REFINE_PROMPT = `You are an expert React/Next.js developer creating a pixel-perfect clone component.

## TASK
Convert the "${componentName}" section into a production-ready Next.js + Tailwind v4 + shadcn/ui component that EXACTLY matches the original design.

## VISUAL SPECIFICATION (from VLM analysis of original screenshot)
${visualSpec || 'No VLM spec available — use the skeleton and styles below'}

## ORIGINAL HTML CONTENT (from extracted page)
\`\`\`tsx
${skeletonCode.slice(0, 30000) || 'No skeleton available'}
\`\`\`

## PER-ELEMENT COMPUTED STYLES (from browser extraction)
\`\`\`json
${JSON.stringify(relevantStyles.slice(0, 80), null, 2)}
\`\`\`

## DESIGN TOKENS
\`\`\`json
${JSON.stringify(tokensSummary, null, 2)}
\`\`\`

## COMPONENT CSS (resolved)
\`\`\`css
${componentCss.slice(0, 10000) || 'No component CSS'}
\`\`\`

## REQUIREMENTS
1. Use 'use client' directive
2. Use Tailwind v4 utility classes (NOT custom CSS)
3. Use shadcn/ui components where appropriate (Button, Card, Accordion, Badge, Sheet)
4. Use Framer Motion for animations (scroll reveal, hover effects)
5. Match EXACT colors from?font sizes, font weights, spacing from the visual spec and per-element styles
6. Use Inter font from next/font/google
7. Add proper TypeScript types
8. Make responsive (mobile-first)
9. NO hardcoded hex colors — use Tailwind semantic tokens or CSS variables
10. Preserve ALL text content from the original
11. Match the gradient effect if present (background-clip: text for hero gradients)
12. Add hover states with smooth transitions (200-300ms)
13. Add scroll-triggered fade-in animations with Framer Motion

## OUTPUT
Return ONLY the complete .tsx component code, no explanations.`;

  // Step 5: Call LLM to refine
  console.log('5️⃣  Calling LLM for AI refinement...');
  
  // Write prompt to temp file (avoid shell arg length limit)
  const tmpPrompt = `/tmp/refine-prompt-${componentName}.txt`;
  fs.writeFileSync(tmpPrompt, REFINE_PROMPT, 'utf-8');
  
  const llmResult = run(`z-ai chat -m glm-4-flash -p "$(cat ${tmpPrompt})"`, { timeout: 120000, maxBuffer: 1024 * 1024 });
  
  let refinedCode = '';
  try {
    const llmJson = JSON.parse(llmResult);
    refinedCode = llmJson.choices?.[0]?.message?.content || '';
  } catch {
    refinedCode = llmResult;
  }
  
  // Extract code from markdown code blocks if present
  const codeMatch = refinedCode.match(/```(?:tsx|jsx|typescript|javascript)?\s*\n([\s\S]*?)```/);
  if (codeMatch) {
    refinedCode = codeMatch[1];
  }
  
  // Clean up: remove non-code content
  if (!refinedCode.includes('export') && !refinedCode.includes('function')) {
    console.log('   ⚠️  LLM output does not contain valid component code');
    refinedCode = skeletonCode; // fallback to skeleton
  }

  // Step 6: Write output
  const outputPath = path.join(outputDir, `${componentName}.tsx`);
  fs.writeFileSync(outputPath, refinedCode, 'utf-8');
  
  console.log(`\n✅ Refined component written to: ${outputPath}`);
  console.log(`   Code size: ${refinedCode.length} chars`);
  console.log('');
}

main();
