#!/usr/bin/env node

/**
 * refine-component.js
 *
 * Use AI (z-ai-web-dev-sdk LLM CLI) to refine a skeleton component
 * into production-ready Tailwind + Next.js code.
 *
 * Handles large prompts by:
 * - Summarizing design tokens (only colors, fonts, key values)
 * - Truncating CSS to 20K chars
 * - Summarizing dangerouslySetInnerHTML content
 * - Using spawn (not exec) to avoid shell arg length limits
 *
 * Usage:
 *   node refine-component.js <component.tsx> <output-dir> [options]
 *
 * Options:
 *   --css <path>      Path to component CSS file
 *   --tokens <path>   Path to design-tokens.json
 *   --model <model>   LLM model to use (default: glm-4-flash)
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const os = require('os');

const DEFAULT_MODEL = 'glm-4-flash';
const MAX_CSS_LENGTH = 20000;     // Truncate CSS beyond this
const MAX_COMPONENT_LENGTH = 50000; // Truncate component code beyond this

// ─── Refinement prompt ──────────────────────────────────────────

const REFINE_PROMPT = `You are an expert Next.js 16 + Tailwind CSS 4 + TypeScript developer. Convert this React component skeleton into production-ready Next.js code.

Rules:
1. CSS → Tailwind: Convert ALL inline styles and CSS classes to Tailwind utility classes
2. Next.js: Add 'use client' if interactive, use next/image for images, next/link for links
3. React State: Add useState/useEffect for interactive elements (menus, accordions, tabs)
4. Responsive: Mobile-first with sm:, md:, lg: prefixes
5. Accessibility: ARIA labels, alt text, keyboard nav
6. Remove dangerouslySetInnerHTML — convert to proper JSX
7. Clean TypeScript types (no any)

Component skeleton:
{COMPONENT_CODE}

Component CSS:
{CSS_CODE}

Design tokens (key colors & fonts):
{DESIGN_TOKENS}

Return ONLY the complete .tsx file content. No markdown, no code blocks, no explanations.`;

// ─── CLI Args ───────────────────────────────────────────────────

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { options[key] = next; i++; }
      else { options[key] = true; }
    } else { positional.push(arg); }
  }
  return { positional, options };
}

// ─── Helpers ────────────────────────────────────────────────────

function die(msg) { console.error(`[refine] ERROR: ${msg}`); process.exit(1); }
function log(msg) { console.log(`[refine] ${msg}`); }

function readFileSafe(filePath) {
  try { return fs.readFileSync(filePath, 'utf-8'); } catch { return ''; }
}

function deriveCssPath(tsxPath) {
  const dir = path.dirname(tsxPath);
  const base = path.basename(tsxPath, '.tsx');
  const cssDir = dir.replace(/components-raw/, 'components-css');
  return path.join(cssDir, `${base}.css`);
}

function deriveTokensPath(tsxPath) {
  let dir = path.dirname(tsxPath);
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'html-raw', 'design-tokens.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '';
}

/** Summarize design tokens — only keep essential colors, fonts, spacing */
function summarizeTokens(rawJson) {
  try {
    const data = JSON.parse(rawJson);
    const summary = {};
    
    // Colors
    if (data.colors) summary.colors = data.colors;
    if (data.uniqueColors) summary.uniqueColors = data.uniqueColors.slice(0, 30);
    
    // Fonts
    if (data.fonts) summary.fonts = data.fonts;
    if (data.fontFamilies) summary.fontFamilies = data.fontFamilies.slice(0, 10);
    if (data.uniqueFontFamilies) summary.uniqueFontFamilies = data.uniqueFontFamilies.slice(0, 10);
    
    // Key CSS variables
    if (data.cssVariables) {
      summary.cssVariablesCount = Object.keys(data.cssVariables).length;
      summary.cssVariablesSample = Object.fromEntries(
        Object.entries(data.cssVariables).slice(0, 50)
      );
    }
    
    // Font sizes
    if (data.fontSizes) summary.fontSizes = data.fontSizes;
    if (data.uniqueFontSizes) summary.uniqueFontSizes = data.uniqueFontSizes.slice(0, 15);
    
    return JSON.stringify(summary, null, 2);
  } catch {
    // If can't parse, return first 3000 chars
    return rawJson.slice(0, 3000);
  }
}

/** Truncate component code, summarizing dangerouslySetInnerHTML */
function summarizeComponent(code) {
  if (code.length <= MAX_COMPONENT_LENGTH) return code;
  
  // Replace dangerouslySetInnerHTML content with a summary
  let result = code;
  const dsiRegex = /dangerouslySetInnerHTML=\{\{\s*__html:\s*`([\s\S]*?)`\s*\}\}/g;
  
  result = result.replace(dsiRegex, (match, htmlContent) => {
    const contentLength = htmlContent.length;
    const preview = htmlContent.slice(0, 2000);
    return `dangerouslySetInnerHTML={{ __html: \`
[TRUNCATED: ${contentLength} chars of HTML content]
Preview (first 2000 chars):
${preview}
... rest truncated for LLM context window
\` }}`;
  });
  
  if (result.length <= MAX_COMPONENT_LENGTH) return result;
  
  // Still too long — hard truncate with notice
  return result.slice(0, MAX_COMPONENT_LENGTH) + '\n\n// [TRUNCATED: original was ' + code.length + ' chars]';
}

/** Truncate CSS to reasonable length */
function truncateCss(css) {
  if (css.length <= MAX_CSS_LENGTH) return css;
  return css.slice(0, MAX_CSS_LENGTH) + '\n\n/* [TRUNCATED: original CSS was ' + css.length + ' chars] */';
}

/** Parse LLM output — handles z-ai CLI JSON response, code fences, and raw text */
function parseLLMOutput(text) {
  // 1. Try to parse as z-ai API JSON response
  //    Format: lines like "🚀 Initializing..." then { "choices": [{ "message": { "content": "..." } }] }
  const jsonMatch = text.match(/\{[\s\S]*"choices"[\s\S]*"content"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[0]);
      if (data.choices?.[0]?.message?.content) {
        text = data.choices[0].message.content;
      }
    } catch { /* not valid JSON, continue */ }
  }
  
  // 2. Strip markdown code fences
  const fenceRegex = /```(?:tsx|typescript|jsx|javascript)?\s*\n([\s\S]*?)```/;
  const match = text.match(fenceRegex);
  if (match) return match[1].trim();
  
  const lines = text.split('\n');
  if (lines[0] && lines[0].match(/^```(?:tsx|typescript|jsx|javascript)?\s*$/)) {
    return lines.slice(1).join('\n').trim();
  }
  return text.trim();
}

/** Call LLM using z-ai chat CLI via spawnSync (avoids shell arg length limits) */
function callLLM(prompt, model) {
  log(`Calling LLM (model: ${model}, prompt: ${prompt.length} chars)...`);
  
  // Write prompt to temp file to avoid shell escaping issues
  const tmpDir = os.tmpdir();
  const promptFile = path.join(tmpDir, `refine-prompt-${Date.now()}.txt`);
  fs.writeFileSync(promptFile, prompt, 'utf-8');
  
  // Use a helper script that reads the file and calls z-ai
  const helperScript = path.join(tmpDir, `refine-call-${Date.now()}.mjs`);
  const helperCode = `
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
const prompt = readFileSync('${promptFile}', 'utf-8');
const result = execFileSync('z-ai', ['chat', '-m', '${model}', '-p', prompt], {
  encoding: 'utf-8',
  maxBuffer: 10 * 1024 * 1024,
  timeout: 120000,
});
process.stdout.write(result);
`;
  fs.writeFileSync(helperScript, helperCode, 'utf-8');
  
  try {
    const result = spawnSync('node', [helperScript], {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 180_000, // 3 min
    });
    
    if (result.error) {
      // If spawn error (like E2BIG), try another approach
      if (result.error.code === 'E2BIG') {
        log('Prompt too large for execFileSync, trying stdin pipe approach...');
        return callLLMViaStdin(prompt, model, promptFile);
      }
      die(`LLM spawn failed: ${result.error.message}`);
    }
    
    if (result.status !== 0 && !result.stdout) {
      die(`LLM exited with code ${result.status}: ${result.stderr?.slice(0, 500)}`);
    }
    
    const output = result.stdout || '';
    if (output.trim()) return output;
    
    // Try stderr as fallback (some z-ai versions output to stderr)
    if (result.stderr && result.stderr.trim()) {
      log('Using stderr output as fallback');
      return result.stderr;
    }
    
    die('LLM returned empty output');
  } finally {
    try { fs.unlinkSync(promptFile); } catch {}
    try { fs.unlinkSync(helperScript); } catch {}
  }
}

/** Fallback: call LLM by piping prompt via stdin */
function callLLMViaStdin(prompt, model, promptFile) {
  // Use z-ai chat with prompt from stdin
  const result = spawnSync('z-ai', ['chat', '-m', model, '-p', prompt], {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 180_000,
    // Don't use shell — pass args directly
    shell: false,
  });
  
  if (result.stdout && result.stdout.trim()) return result.stdout;
  if (result.stderr && result.stderr.trim()) return result.stderr;
  die('LLM returned empty output via stdin approach');
}

// ─── Main ───────────────────────────────────────────────────────

function main() {
  const { positional, options } = parseArgs(process.argv);

  const componentPath = positional[0];
  const outputDir = positional[1];
  if (!componentPath) die('Missing <component.tsx>');
  if (!outputDir) die('Missing <output-dir>');

  const absComponentPath = path.resolve(componentPath);
  const absOutputDir = path.resolve(outputDir);
  if (!fs.existsSync(absComponentPath)) die(`File not found: ${absComponentPath}`);

  const model = options.model || DEFAULT_MODEL;
  let cssPath = options.css ? path.resolve(options.css) : deriveCssPath(absComponentPath);
  let tokensPath = options.tokens ? path.resolve(options.tokens) : deriveTokensPath(absComponentPath);

  // ── Read inputs ──
  log(`Reading component: ${absComponentPath}`);
  const rawComponent = fs.readFileSync(absComponentPath, 'utf-8');
  const componentCode = summarizeComponent(rawComponent);

  let cssCode = '';
  if (cssPath && fs.existsSync(cssPath)) {
    log(`Reading CSS: ${cssPath}`);
    cssCode = truncateCss(fs.readFileSync(cssPath, 'utf-8'));
  } else {
    log('No CSS file found');
  }

  let designTokens = '';
  if (tokensPath && fs.existsSync(tokensPath)) {
    log(`Reading design tokens: ${tokensPath}`);
    const rawTokens = fs.readFileSync(tokensPath, 'utf-8');
    designTokens = summarizeTokens(rawTokens);
  } else {
    log('No design-tokens.json found');
  }

  // ── Build prompt ──
  const prompt = REFINE_PROMPT
    .replace('{COMPONENT_CODE}', componentCode)
    .replace('{CSS_CODE}', cssCode || '(none)')
    .replace('{DESIGN_TOKENS}', designTokens || '(none)');

  log(`Prompt length: ${prompt.length} chars`);

  // ── Call LLM ──
  const rawOutput = callLLM(prompt, model);
  if (!rawOutput || !rawOutput.trim()) die('LLM returned empty output');

  log(`LLM output length: ${rawOutput.length} chars`);

  // ── Parse output ──
  const refinedCode = parseLLMOutput(rawOutput);
  if (!refinedCode) die('Refined code is empty after parsing');

  // ── Save outputs ──
  fs.mkdirSync(absOutputDir, { recursive: true });

  const componentBasename = path.basename(absComponentPath);
  const outputPath = path.join(absOutputDir, componentBasename);
  const logPath = path.join(absOutputDir, componentBasename.replace('.tsx', '.refine.log'));

  fs.writeFileSync(outputPath, refinedCode, 'utf-8');
  log(`Saved: ${outputPath}`);

  // Save log (truncate prompt in log to save disk)
  const logContent = [
    `=== Refinement Log ===`,
    `Date: ${new Date().toISOString()}`,
    `Component: ${absComponentPath}`,
    `Model: ${model}`,
    `Prompt Length: ${prompt.length} chars`,
    `Output Length: ${refinedCode.length} chars`,
    ``,
    `=== Refined Code ===`,
    refinedCode,
  ].join('\n');
  fs.writeFileSync(logPath, logContent, 'utf-8');

  console.log('');
  log('Refinement complete!');
  log(`  Output: ${outputPath} (${refinedCode.length} chars)`);
}

main();
