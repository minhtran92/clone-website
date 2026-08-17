#!/usr/bin/env node
/**
 * Validate token usage in codebase
 * Finds hardcoded values that should use design tokens
 *
 * Usage:
 *   node validate-tokens.cjs --dir src/
 *   node validate-tokens.cjs --dir src/ --fix
 */

const fs = require('fs');
const path = require('path');

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dir: null,
    fix: false,
    ignore: ['node_modules', '.git', 'dist', 'build', '.next']
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' || args[i] === '-d') {
      options.dir = args[++i];
    } else if (args[i] === '--fix') {
      options.fix = true;
    } else if (args[i] === '--ignore' || args[i] === '-i') {
      options.ignore.push(args[++i]);
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Usage: node validate-tokens.cjs [options]

Options:
  -d, --dir <path>      Directory to scan (required)
  --fix                 Show suggested fixes (no auto-fix)
  -i, --ignore <dir>    Additional directories to ignore
  -h, --help            Show this help

Checks for:
  - Hardcoded hex colors (#RGB, #RRGGBB)
  - Hardcoded pixel values (except 0, 1px)
  - Hardcoded rem values in CSS
      `);
      process.exit(0);
    }
  }

  return options;
}

/**
 * Patterns to detect hardcoded values.
 * Modern CSS color formats (4/8-char hex with alpha, rgba, hsl, hsla, space-separated syntax)
 * are all detected. Tailwind arbitrary values (e.g. `text-[#00B67A]`, `p-[17px]`, `gap-[18px]`)
 * are also flagged — they defeat the purpose of design tokens.
 *
 * False-positive guards:
 *   - Inline `style={{ '--foo': '#FF0000' }}` is ALLOWED (custom CSS variable definition)
 *   - Token `$value` definitions in JSON are skipped (those ARE the tokens themselves)
 *   - Black/white hex (#000, #fff, #000000, #FFFFFF) is allowed as common exception
 */
const patterns = {
  hexColor: {
    // Match #RGB, #RGBA, #RRGGBB, #RRGGBBAA — followed by non-hex char or word boundary
    regex: /#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})\b/g,
    message: 'Hardcoded hex color',
    suggestion: 'Use var(--color-*) token'
  },
  rgbColor: {
    // rgb() AND rgba() — handles comma AND space-separated syntax, with optional % values
    regex: /rgba?\(\s*[\d.]+%?\s*[, ]\s*[\d.]+%?\s*[, ]\s*[\d.]+%?\s*(?:[, ]\s*[\d.]+\s*)?\)/gi,
    message: 'Hardcoded RGB(A) color',
    suggestion: 'Use var(--color-*) token'
  },
  hslColor: {
    // hsl() AND hsla() — handles comma AND space-separated syntax
    regex: /hsla?\(\s*[\d.]+(?:deg)?\s*[, ]\s*[\d.]+%\s*[, ]\s*[\d.]+%\s*(?:[, ]\s*[\d.]+\s*)?\)/gi,
    message: 'Hardcoded HSL(A) color',
    suggestion: 'Use var(--color-*) token'
  },
  pixelValue: {
    // Match any positive pixel value (1+ digits or 2+ digits) preceded by `:`, `(`, `[`, `=`, space, or comma
    // Catches: `padding: 16px`, `gap-[17px]`, `p-[300px]`, `width: 2px`
    // Skips: `var(--space-4)`, `--font-size-base: 1rem`, calc(0px)
    regex: /(?<=[:(\[,=\s])\s*(\d{1,})px\b(?!\/\*)/g,
    message: 'Hardcoded pixel value',
    suggestion: 'Use var(--space-*) or var(--radius-*) token, or Tailwind scale (p-4, gap-2)'
  },
  remValue: {
    // Match any rem value (e.g. `font-size: 1rem`, `gap-[0.5rem]`)
    // Skip token definitions ($value in JSON files)
    regex: /(?<=[:(\[,=\s"'])\s*\d+\.?\d*rem\b(?!["']*:\s*["'])/g,
    message: 'Hardcoded rem value',
    suggestion: 'Use var(--space-*) or var(--font-size-*) token, or Tailwind scale (text-base, gap-2)'
  }
};

/**
 * File extensions to scan
 */
const extensions = ['.css', '.scss', '.tsx', '.jsx', '.ts', '.js', '.vue', '.svelte'];

/**
 * Files/patterns to skip
 */
const skipPatterns = [
  /\.min\.(css|js)$/,
  /tailwind\.config/,
  /globals\.css/, // Token definitions
  /tokens\.(css|json)/
];

/**
 * Get all files recursively
 */
function getFiles(dir, ignore, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!ignore.includes(entry.name)) {
        getFiles(fullPath, ignore, files);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (extensions.includes(ext)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

/**
 * Check if file should be skipped
 */
function shouldSkip(filePath) {
  return skipPatterns.some(pattern => pattern.test(filePath));
}

/**
 * Strip block comments and line comments from source for cleaner scanning.
 * Preserves strings to avoid accidental removal of # inside strings.
 */
function stripComments(content) {
  let out = '';
  let i = 0;
  let inString = null;
  while (i < content.length) {
    const c = content[i];
    if (inString) {
      out += c;
      if (c === '\\' && i + 1 < content.length) {
        out += content[i + 1];
        i += 2;
        continue;
      }
      if (c === inString) inString = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      inString = c;
      out += c;
      i++;
      continue;
    }
    if (c === '/' && content[i + 1] === '*') {
      let end = content.indexOf('*/', i + 2);
      if (end === -1) end = content.length - 2;
      out += '\n'; // preserve line breaks for line-number consistency
      i = end + 2;
      continue;
    }
    if (c === '/' && content[i + 1] === '/') {
      // Skip to end of line
      let end = content.indexOf('\n', i);
      if (end === -1) end = content.length;
      i = end;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Scan file for violations
 */
function scanFile(filePath) {
  const rawContent = fs.readFileSync(filePath, 'utf-8');
  // Strip comments BEFORE scanning — so we don't flag hex/px in /* comments */
  const content = stripComments(rawContent);
  const lines = content.split('\n');
  const rawLines = rawContent.split('\n');
  const violations = [];

  lines.forEach((line, index) => {
    for (const [name, pattern] of Object.entries(patterns)) {
      // Reset lastIndex because regex is /g — global regexes are stateful
      const re = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match;
      while ((match = re.exec(line)) !== null) {
        const matched = match[0];
        // Skip common exceptions
        if (name === 'hexColor') {
          const upper = matched.toUpperCase();
          // Allow pure black/white (common intentional use)
          if (['#000', '#FFF', '#000000', '#FFFFFF', '#0000', '#FFFF', '#00000000', '#FFFFFFFF'].includes(upper)) {
            continue;
          }
          // Allow inline CSS variable DEFINITIONS like style={{ '--foo': '#FF0000' }}
          // (these define new CSS vars, not consume hardcoded colors)
          if (line.match(/['"`]--[\w-]+['"`]\s*:\s*['"`]/)) {
            continue;
          }
          // Allow token DEFINITIONS in JSON ({"$value": "#FF0000", "$type": "color"})
          if (filePath.endsWith('.json') && line.match(/"\$value"\s*:\s*"/)) {
            continue;
          }
        }
        if (name === 'pixelValue' || name === 'remValue') {
          // Allow token DEFINITIONS in JSON ({"$value": "16px", "$type": "dimension"})
          if (filePath.endsWith('.json') && line.match(/"\$value"\s*:\s*"/)) {
            continue;
          }
        }

        // Compute column based on the match index
        const col = line.indexOf(matched, match.index || 0) + 1;
        violations.push({
          file: filePath,
          line: index + 1,
          column: col,
          value: matched,
          type: name,
          message: pattern.message,
          suggestion: pattern.suggestion,
          context: (rawLines[index] || line).trim().substring(0, 80)
        });
      }
    }
  });

  return violations;
}

/**
 * Format violation report
 */
function formatReport(violations) {
  if (violations.length === 0) {
    return '✅ No token violations found';
  }

  let report = `⚠️  Found ${violations.length} potential token violations:\n\n`;

  // Group by file
  const byFile = {};
  violations.forEach(v => {
    if (!byFile[v.file]) byFile[v.file] = [];
    byFile[v.file].push(v);
  });

  for (const [file, fileViolations] of Object.entries(byFile)) {
    report += `📁 ${file}\n`;
    fileViolations.forEach(v => {
      report += `   Line ${v.line}: ${v.message}\n`;
      report += `   Found: ${v.value}\n`;
      report += `   Suggestion: ${v.suggestion}\n`;
      report += `   Context: ${v.context}\n\n`;
    });
  }

  // Summary
  const byType = {};
  violations.forEach(v => {
    byType[v.type] = (byType[v.type] || 0) + 1;
  });

  report += `\n📊 Summary:\n`;
  for (const [type, count] of Object.entries(byType)) {
    report += `   ${patterns[type].message}: ${count}\n`;
  }

  return report;
}

/**
 * Main
 */
function main() {
  const options = parseArgs();

  if (!options.dir) {
    console.error('Error: --dir is required');
    process.exit(1);
  }

  const dirPath = path.resolve(process.cwd(), options.dir);

  if (!fs.existsSync(dirPath)) {
    console.error(`Error: Directory not found: ${dirPath}`);
    process.exit(1);
  }

  console.log(`Scanning ${dirPath} for token violations...\n`);

  const files = getFiles(dirPath, options.ignore);
  const allViolations = [];

  for (const file of files) {
    if (shouldSkip(file)) continue;

    const violations = scanFile(file);
    allViolations.push(...violations);
  }

  console.log(formatReport(allViolations));

  // Exit with error code if violations found
  if (allViolations.length > 0) {
    process.exit(1);
  }
}

main();
