#!/usr/bin/env node
/**
 * Generate CSS variables from design tokens JSON
 *
 * Usage:
 *   node generate-tokens.cjs --config tokens.json -o tokens.css
 *   node generate-tokens.cjs --config tokens.json --format tailwind
 */

const fs = require('fs');
const path = require('path');

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    config: null,
    output: null,
    format: 'css' // css | tailwind
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' || args[i] === '-c') {
      options.config = args[++i];
    } else if (args[i] === '--output' || args[i] === '-o') {
      options.output = args[++i];
    } else if (args[i] === '--format' || args[i] === '-f') {
      options.format = args[++i];
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Usage: node generate-tokens.cjs [options]

Options:
  -c, --config <file>   Input JSON token file (required)
  -o, --output <file>   Output file (default: stdout)
  -f, --format <type>   Output format: css | tailwind (default: css)
  -h, --help            Show this help
      `);
      process.exit(0);
    }
  }

  return options;
}

/**
 * Resolve token references like {primitive.color.blue.600}
 */
function resolveReference(value, tokens) {
  if (typeof value !== 'string' || !value.startsWith('{')) {
    return value;
  }

  const path = value.slice(1, -1).split('.');
  let result = tokens;

  for (const key of path) {
    result = result?.[key];
  }

  if (result?.$value) {
    return resolveReference(result.$value, tokens);
  }

  return result || value;
}

/**
 * Convert token name to CSS variable name
 */
function toCssVarName(path) {
  return '--' + path.join('-').replace(/\./g, '-');
}

/**
 * Flatten tokens into CSS variables
 */
function flattenTokens(obj, tokens, prefix = [], result = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = [...prefix, key];

    if (value && typeof value === 'object') {
      if (value.$value !== undefined) {
        // This is a token
        const cssVar = toCssVarName(currentPath);
        const resolvedValue = resolveReference(value.$value, tokens);
        result[cssVar] = resolvedValue;
      } else {
        // Recurse into nested object
        flattenTokens(value, tokens, currentPath, result);
      }
    }
  }

  return result;
}

/**
 * Generate CSS output
 */
function generateCSS(tokens) {
  const primitive = flattenTokens(tokens.primitive || {}, tokens, ['primitive']);
  const semantic = flattenTokens(tokens.semantic || {}, tokens, []);
  const component = flattenTokens(tokens.component || {}, tokens, []);
  const darkSemantic = flattenTokens(tokens.dark?.semantic || {}, tokens, []);

  let css = `/* Design Tokens - Auto-generated */
/* Do not edit directly - modify tokens.json instead */

/* === PRIMITIVES === */
:root {
${Object.entries(primitive).map(([k, v]) => `  ${k}: ${v};`).join('\n')}
}

/* === SEMANTIC === */
:root {
${Object.entries(semantic).map(([k, v]) => `  ${k}: ${v};`).join('\n')}
}

/* === COMPONENTS === */
:root {
${Object.entries(component).map(([k, v]) => `  ${k}: ${v};`).join('\n')}
}
`;

  if (Object.keys(darkSemantic).length > 0) {
    css += `
/* === DARK MODE === */
.dark {
${Object.entries(darkSemantic).map(([k, v]) => `  ${k}: ${v};`).join('\n')}
}
`;
  }

  return css;
}

/**
 * Generate Tailwind config output.
 * Outputs a NESTED object so that 'primary.hover' becomes `primary: { hover: '...' }`.
 *
 * Conflict resolution: if a token is BOTH a leaf (e.g. `--color-primary`) AND a parent
 * (e.g. `--color-primary-hover`), the leaf gets renamed to `DEFAULT` — this is the
 * Tailwind convention that allows `bg-primary` (uses DEFAULT) AND `bg-primary-hover`.
 *
 *   bg-primary       → var(--color-primary)        [via .DEFAULT]
 *   bg-primary-hover → var(--color-primary-hover)
 */
function generateTailwind(tokens) {
  const semantic = flattenTokens(tokens.semantic || {}, tokens, []);

  // Extract colors for Tailwind, building a NESTED object structure.
  // Dotted keys like 'primary.hover' become nested: { primary: { hover: 'var(...)' } }
  const colors = {};

  // First pass: register all multi-segment paths (parents).
  // Second pass: register single-segment leaves, promoting to .DEFAULT if a parent already exists.
  const entries = [];
  for (const [key, value] of Object.entries(semantic)) {
    if (key.includes('color')) {
      const namePath = key.replace('--color-', '').split('-').filter(Boolean);
      entries.push({ key, namePath });
    }
  }
  // Sort: longer paths first (parents before leaves), so single-segment leaves
  // can detect existing parent and rename to DEFAULT.
  entries.sort((a, b) => b.namePath.length - a.namePath.length);

  for (const { key, namePath } of entries) {
    let target = colors;
    for (let i = 0; i < namePath.length; i++) {
      const part = namePath[i];
      if (i === namePath.length - 1) {
        // Leaf
        if (typeof target[part] === 'object' && target[part] !== null) {
          // Parent already exists at this name — use Tailwind DEFAULT convention
          target[part]['DEFAULT'] = `var(${key})`;
        } else {
          target[part] = `var(${key})`;
        }
      } else {
        // Intermediate — ensure it's an object
        if (typeof target[part] !== 'object' || target[part] === null) {
          if (target[part] !== undefined) {
            // Existing leaf — convert to object with DEFAULT
            const existingLeaf = target[part];
            target[part] = { 'DEFAULT': existingLeaf };
          } else {
            target[part] = {};
          }
        }
        target = target[part];
      }
    }
  }

  return `// Tailwind color config - Auto-generated by generate-tokens.cjs
// Add to tailwind.config.ts theme.extend.colors (or import directly)
//
// Note: Where a token has both a base value and named variants (e.g. primary + primary-hover),
// the base is exposed as 'DEFAULT' so 'bg-primary' works AND 'bg-primary-hover' also works.
//
// Example:
//   import tailwindColors from './tailwind-colors.cjs';
//   export default { theme: { extend: { colors: tailwindColors.colors } } }

module.exports = {
  colors: ${JSON.stringify(colors, null, 2).replace(/"/g, "'")}
};
`;
}

/**
 * Main
 */
function main() {
  const options = parseArgs();

  if (!options.config) {
    console.error('Error: --config is required');
    process.exit(1);
  }

  // Resolve config path
  const configPath = path.resolve(process.cwd(), options.config);

  if (!fs.existsSync(configPath)) {
    console.error(`Error: Config file not found: ${configPath}`);
    process.exit(1);
  }

  // Read and parse tokens (with helpful error message on JSON parse failure)
  let tokens;
  try {
    tokens = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (e) {
    console.error(`✖ Invalid JSON in ${configPath}:`);
    console.error(`  ${e.message}`);
    console.error(`\n  Common causes:`);
    console.error(`   - Trailing comma (, before } or ])`);
    console.error(`   - Single quotes instead of double quotes`);
    console.error(`   - Unclosed string or bracket`);
    console.error(`   - Comment (JSON doesn't support // or /* */ — remove them)`);
    process.exit(1);
  }

  // Generate output
  let output;
  try {
    if (options.format === 'tailwind') {
      output = generateTailwind(tokens);
    } else {
      output = generateCSS(tokens);
    }
  } catch (e) {
    console.error(`✖ Failed to generate output: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
  }

  // Write output
  if (options.output) {
    const outputPath = path.resolve(process.cwd(), options.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, output);
    console.log(`✅ Generated: ${outputPath}`);
  } else {
    console.log(output);
  }
}

main();
