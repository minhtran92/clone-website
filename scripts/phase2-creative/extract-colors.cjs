#!/usr/bin/env node
/**
 * extract-colors.cjs
 *
 * Extract dominant colors from an image and compare against brand palette.
 * Uses pure Node.js without external image processing dependencies.
 *
 * For full color extraction from images, integrate with ai-multimodal skill
 * or use ImageMagick via shell commands.
 *
 * Usage:
 *   node extract-colors.cjs <image-path>
 *   node extract-colors.cjs <image-path> --brand-file <path>
 *   node extract-colors.cjs --palette  # Show brand palette from guidelines
 *
 * Integration:
 *   For image color analysis, use: ai-multimodal skill or ImageMagick
 *   magick <image> -colors 10 -depth 8 -format "%c" histogram:info:
 */

const fs = require("fs");
const path = require("path");

// Default brand guidelines path
const DEFAULT_GUIDELINES_PATH = "docs/brand-guidelines.md";

/**
 * Extract hex colors from markdown/text content.
 * Supports:
 *   - #RGB (3 chars)
 *   - #RGBA (4 chars)
 *   - #RRGGBB (6 chars)
 *   - #RRGGBBAA (8 chars)
 */
function extractHexColors(text) {
  // Match 3, 4, 6, or 8 hex chars after #
  // Use longest-match-first by alternation in regex (8 before 6, 4 before 3)
  // so that #FFAA doesn't match as #FFA + leftover 'A'.
  const hexPattern = /#(?:[0-9A-Fa-f]{8}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{3})\b/g;
  return [...new Set((text.match(hexPattern) || []))];
}

/**
 * Extract ALL color values (hex + rgb/rgba + hsl/hsla) from markdown/text content.
 * Returns an array of objects: { value, format, rgb: { r, g, b, a? } }
 */
function extractAllColors(text) {
  const found = new Map();
  // Hex
  for (const hex of extractHexColors(text)) {
    const rgb = hexToRgb(hex);
    if (rgb) found.set(hex.toLowerCase(), { value: hex, format: 'hex', rgb });
  }
  // rgb() / rgba() — comma AND space-separated, with optional alpha
  const rgbRe = /rgba?\(\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*(?:[, ]\s*([\d.]+)\s*)?\)/gi;
  let m;
  while ((m = rgbRe.exec(text)) !== null) {
    const parse = (v) => {
      if (v === undefined) return undefined;
      if (v.endsWith('%')) return Math.round(parseFloat(v) / 100 * 255);
      return parseFloat(v);
    };
    const r = parse(m[1]), g = parse(m[2]), b = parse(m[3]), a = m[4] ? parseFloat(m[4]) : undefined;
    const key = `rgb(${r},${g},${b}${a !== undefined ? `,${a}` : ''})`;
    if (!found.has(key)) found.set(key, { value: m[0], format: 'rgb', rgb: { r, g, b, ...(a !== undefined ? { a } : {}) } });
  }
  // hsl() / hsla() — comma AND space-separated, with optional alpha
  const hslRe = /hsla?\(\s*([\d.]+)(?:deg)?\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%\s*(?:[, ]\s*([\d.]+)\s*)?\)/gi;
  while ((m = hslRe.exec(text)) !== null) {
    const h = parseFloat(m[1]), s = parseFloat(m[2]) / 100, l = parseFloat(m[3]) / 100, a = m[4] ? parseFloat(m[4]) : undefined;
    const rgb = hslToRgb(h, s, l);
    const key = `hsl(${h},${s * 100}%,${l * 100}%${a !== undefined ? `,${a}` : ''})`;
    if (!found.has(key)) found.set(key, { value: m[0], format: 'hsl', rgb: { ...rgb, ...(a !== undefined ? { a } : {}) } });
  }
  return [...found.values()];
}

/**
 * Convert HSL → RGB (used by extractAllColors)
 */
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

/**
 * Parse brand guidelines for color palette
 */
function parseBrandColors(guidelinesPath) {
  const resolvedPath = path.isAbsolute(guidelinesPath)
    ? guidelinesPath
    : path.join(process.cwd(), guidelinesPath);

  if (!fs.existsSync(resolvedPath)) {
    return null;
  }

  const content = fs.readFileSync(resolvedPath, "utf-8");

  const palette = {
    primary: [],
    secondary: [],
    neutral: [],
    semantic: [],
    all: [],
  };

  // Extract colors from different sections
  const sections = [
    { name: "primary", regex: /### Primary[\s\S]*?(?=###|##|$)/i },
    { name: "secondary", regex: /### Secondary[\s\S]*?(?=###|##|$)/i },
    { name: "neutral", regex: /### Neutral[\s\S]*?(?=###|##|$)/i },
    { name: "semantic", regex: /### Semantic[\s\S]*?(?=###|##|$)/i },
  ];

  sections.forEach(({ name, regex }) => {
    const match = content.match(regex);
    if (match) {
      const colors = extractHexColors(match[0]);
      palette[name] = colors;
      palette.all.push(...colors);
    }
  });

  // Dedupe all
  palette.all = [...new Set(palette.all)];

  return palette;
}

/**
 * Convert hex to RGB. Supports:
 *   - #RGB (3 chars, expanded to #RRGGBB)
 *   - #RGBA (4 chars, expanded to #RRGGBBAA)
 *   - #RRGGBB (6 chars)
 *   - #RRGGBBAA (8 chars, with alpha)
 */
function hexToRgb(hex) {
  if (typeof hex !== 'string') return null;
  let h = hex.replace('#', '');
  // Expand shorthand
  if (h.length === 3) {
    h = h.split('').map(c => c + c).join('');
  } else if (h.length === 4) {
    h = h.split('').map(c => c + c).join('');
  }
  // Now h is 6 or 8 chars
  const result = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})?$/i.exec(h);
  if (!result) return null;
  const rgb = {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
  if (result[4]) {
    rgb.a = Math.round(parseInt(result[4], 16) / 255 * 100) / 100;
  }
  return rgb;
}

/**
 * Convert RGB to hex
 */
function rgbToHex(r, g, b) {
  return (
    "#" +
    [r, g, b]
      .map((x) => {
        const hex = Math.round(x).toString(16);
        return hex.length === 1 ? "0" + hex : hex;
      })
      .join("")
      .toUpperCase()
  );
}

/**
 * Calculate color distance (Euclidean in RGB space)
 */
function colorDistance(color1, color2) {
  const rgb1 = typeof color1 === "string" ? hexToRgb(color1) : color1;
  const rgb2 = typeof color2 === "string" ? hexToRgb(color2) : color2;

  if (!rgb1 || !rgb2) return Infinity;

  return Math.sqrt(
    Math.pow(rgb1.r - rgb2.r, 2) +
      Math.pow(rgb1.g - rgb2.g, 2) +
      Math.pow(rgb1.b - rgb2.b, 2)
  );
}

/**
 * Find nearest brand color
 */
function findNearestBrandColor(color, brandColors) {
  let nearest = null;
  let minDistance = Infinity;

  brandColors.forEach((brandColor) => {
    const distance = colorDistance(color, brandColor);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = brandColor;
    }
  });

  return { color: nearest, distance: minDistance };
}

/**
 * Calculate brand compliance percentage
 * Distance threshold: 50 (out of max ~441 for RGB)
 */
function calculateCompliance(extractedColors, brandColors, threshold = 50) {
  if (!extractedColors || extractedColors.length === 0) return 100;
  if (!brandColors || brandColors.length === 0) return 0;

  let matchCount = 0;

  extractedColors.forEach((color) => {
    const nearest = findNearestBrandColor(color, brandColors);
    if (nearest.distance <= threshold) {
      matchCount++;
    }
  });

  return Math.round((matchCount / extractedColors.length) * 100);
}

/**
 * Generate ImageMagick command for color extraction
 */
function generateImageMagickCommand(imagePath, numColors = 10) {
  return `magick "${imagePath}" -colors ${numColors} -depth 8 -format "%c" histogram:info:`;
}

/**
 * Parse ImageMagick histogram output to extract colors
 */
function parseImageMagickOutput(output) {
  const colors = [];
  const lines = output.trim().split("\n");

  lines.forEach((line) => {
    // Match pattern like: 12345: (255,128,64) #FF8040 srgb(255,128,64)
    const hexMatch = line.match(/#([0-9A-Fa-f]{6})/);
    const countMatch = line.match(/^\s*(\d+):/);

    if (hexMatch) {
      colors.push({
        hex: "#" + hexMatch[1].toUpperCase(),
        count: countMatch ? parseInt(countMatch[1]) : 0,
      });
    }
  });

  // Sort by count (most common first)
  colors.sort((a, b) => b.count - a.count);

  return colors;
}

/**
 * Display brand palette
 */
function displayPalette(palette) {
  console.log("\n" + "=".repeat(50));
  console.log("BRAND COLOR PALETTE");
  console.log("=".repeat(50));

  if (palette.primary.length > 0) {
    console.log("\nPrimary Colors:");
    palette.primary.forEach((c) => console.log(`  ${c}`));
  }

  if (palette.secondary.length > 0) {
    console.log("\nSecondary Colors:");
    palette.secondary.forEach((c) => console.log(`  ${c}`));
  }

  if (palette.neutral.length > 0) {
    console.log("\nNeutral Colors:");
    palette.neutral.forEach((c) => console.log(`  ${c}`));
  }

  if (palette.semantic.length > 0) {
    console.log("\nSemantic Colors:");
    palette.semantic.forEach((c) => console.log(`  ${c}`));
  }

  console.log("\n" + "=".repeat(50));
  console.log(`Total: ${palette.all.length} colors in brand palette`);
  console.log("=".repeat(50) + "\n");
}

/**
 * Main function
 */
function main() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes("--json");
  const showPalette = args.includes("--palette");
  const brandFileIdx = args.indexOf("--brand-file");
  const brandFile =
    brandFileIdx !== -1 ? args[brandFileIdx + 1] : DEFAULT_GUIDELINES_PATH;
  const brandFileValue = brandFileIdx !== -1 ? args[brandFileIdx + 1] : null;
  const imagePath = args.find(
    (a) => !a.startsWith("--") && a !== brandFileValue
  );

  // Load brand palette
  const brandPalette = parseBrandColors(brandFile);

  if (!brandPalette) {
    console.error(`Brand guidelines not found at: ${brandFile}`);
    console.error(`Create brand guidelines or specify path with --brand-file`);
    process.exit(1);
  }

  // Show palette mode
  if (showPalette || !imagePath) {
    if (jsonOutput) {
      console.log(JSON.stringify(brandPalette, null, 2));
    } else {
      displayPalette(brandPalette);

      if (!imagePath) {
        console.log("To extract colors from an image:");
        console.log("  node extract-colors.cjs <image-path>");
        console.log("\nOr use ImageMagick directly:");
        console.log('  magick image.png -colors 10 -depth 8 -format "%c" histogram:info:');
      }
    }
    return;
  }

  // Resolve image path
  const resolvedPath = path.isAbsolute(imagePath)
    ? imagePath
    : path.join(process.cwd(), imagePath);

  if (!fs.existsSync(resolvedPath)) {
    console.error(`Image not found: ${resolvedPath}`);
    process.exit(1);
  }

  // Generate extraction instructions
  const result = {
    image: resolvedPath,
    brandPalette: brandPalette,
    extractionCommand: generateImageMagickCommand(resolvedPath),
    instructions: [
      "1. Run the ImageMagick command to extract colors:",
      `   ${generateImageMagickCommand(resolvedPath)}`,
      "",
      "2. Or use the ai-multimodal skill:",
      `   python .claude/skills/ai-multimodal/scripts/gemini_batch_process.py \\`,
      `     --files "${resolvedPath}" \\`,
      `     --task analyze \\`,
      `     --prompt "Extract the 10 most dominant colors as hex values"`,
      "",
      "3. Then compare extracted colors against brand palette",
    ],
    complianceCheck: {
      threshold: 50,
      description:
        "Colors within distance 50 (RGB space) are considered brand-compliant",
      brandColors: brandPalette.all,
    },
  };

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("\n" + "=".repeat(60));
    console.log("COLOR EXTRACTION HELPER");
    console.log("=".repeat(60));
    console.log(`\nImage: ${result.image}`);
    console.log(`\nBrand Colors: ${brandPalette.all.length} colors loaded`);
    console.log("\nTo extract colors from this image:\n");
    result.instructions.forEach((line) => console.log(line));
    console.log("\n" + "=".repeat(60));

    // Show brand palette for reference
    console.log("\nBrand Palette Reference:");
    console.log(`  Primary: ${brandPalette.primary.join(", ") || "none"}`);
    console.log(`  Secondary: ${brandPalette.secondary.join(", ") || "none"}`);
    console.log(`  Neutral: ${brandPalette.neutral.join(", ") || "none"}`);
    console.log("=".repeat(60) + "\n");
  }
}

// Export functions for use as module
module.exports = {
  parseBrandColors,
  hexToRgb,
  rgbToHex,
  colorDistance,
  findNearestBrandColor,
  calculateCompliance,
  parseImageMagickOutput,
};

// Run if called directly
if (require.main === module) {
  main();
}
