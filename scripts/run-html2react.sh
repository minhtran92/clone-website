#!/usr/bin/env bash
# run-html2react.sh — Step 3 of the clone-website pipeline
#
# Runs html-to-react-components CLI on annotated HTML
# to produce .tsx skeleton components.
#
# Usage:
#   bash run-html2react.sh <input.html> <output-dir>
#   bash run-html2react.sh clone-output/html-annotated/page.annotated.html clone-output/components-raw

set -e

INPUT="${1:?Usage: run-html2react.sh <input.html> <output-dir>}"
OUTPUT_DIR="${2:?Output directory required}"

# Ensure output directory exists
mkdir -p "$OUTPUT_DIR"

echo ""
echo "✂️  Running html-to-react-components CLI..."
echo "   Input:  $INPUT"
echo "   Output: $OUTPUT_DIR"
echo ""

# IMPORTANT: html2react uses glob which resolves paths relative to CWD.
# Must run from the project root and use relative paths.
cd /home/z/my-project

# Run html2react (paths must be relative to CWD)
html2react "$INPUT" -o "$OUTPUT_DIR" -c stateless -m es6 -e js

echo ""

# Convert .js → .tsx
JS_COUNT=0
for f in "$OUTPUT_DIR"/*.js; do
  if [ -f "$f" ]; then
    TSX_FILE="${f%.js}.tsx"
    mv "$f" "$TSX_FILE"
    JS_COUNT=$((JS_COUNT + 1))
    echo "   📄 $(basename "$TSX_FILE")"
  fi
done

echo ""
echo "✅ Split complete! Generated $JS_COUNT component files in $OUTPUT_DIR"
