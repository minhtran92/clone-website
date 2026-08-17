# Clone Website Skill

> Clone any website UI into a Next.js App Router project using a **hybrid pipeline** (Deterministic CLI + AI Brain).

## Overview

This skill reverse-engineers any website's UI (Webflow, Framer, Squarespace, Wix, etc.) into production-ready Next.js App Router components. It uses a **hybrid approach** where deterministic CLI tools build the structural skeleton, and AI handles the intelligent refinement.

### Why Hybrid?

| Problem | Pure AI Guess | This Hybrid Pipeline |
|---------|---------------|---------------------|
| Component structure | AI guesses layout → messy code | `cheerio` creates exact DOM structure |
| CSS accuracy | Approximated classes | Extracted computed styles → precise Tailwind mapping |
| State/logic | Often missed or wrong | AI specializes in logic AFTER structure is locked |
| Fidelity | "Close enough" | Pixel-precise skeleton + AI refinement = production-ready |

---

## Pipeline

```
URL
 │
 ├─ Step 0: CRAWL ───────── agent-browser ───→ Discover all pages (multi-page support)
 │
 ├─ Step 1: FETCH ───────── agent-browser ───→ Rendered HTML + CSS + computed styles + assets
 │  │                        (page_reader fallback)
 │  ├─ Step 1b: RESOLVE ──── resolve-css-vars ─→ CSS variables → actual values
 │
 ├─ Step 2: ANNOTATE ───── LLM + cheerio ────→ HTML with data-component="..." attributes
 │
 ├─ Step 3: SPLIT ──────── cheerio/html2react ─→ .tsx skeleton components (full content, no truncation)
 │  ├─ Step 3b: CSS SPLIT ── split-css-by-comp ─→ Per-component CSS files + shared.css
 │
 ├─ Step 4: REFINE ─────── LLM (glm-4) ──────→ Tailwind CSS + Next.js logic + state
 │
 └─ Step 5: VERIFY ─────── VLM comparison ───→ Visual QA report + fixes
```

| Step | Name | Tool | Type | Description |
|------|------|------|------|-------------|
| 0 | Crawl | agent-browser | Deterministic | Discover all internal links & page types |
| 1 | Fetch | agent-browser | Deterministic | Extract full rendered HTML, CSS, computed styles, assets |
| 1b | Resolve | resolve-css-vars.js | Deterministic | Resolve CSS `var(--token)` → actual RGB values |
| 2 | Annotate | LLM + cheerio | AI-assisted | Inject `data-component` attributes on semantic sections |
| 3 | Split | cheerio/html2react | Deterministic | Split annotated HTML into .tsx component skeletons |
| 3b | CSS Split | split-css-by-component.js | Deterministic | Map CSS rules to components, split per-component |
| 4 | Refine | LLM (glm-4) | AI Brain | Convert CSS→Tailwind, add state/logic, optimize for Next.js |
| 5 | Verify | VLM | AI Verification | Compare original vs clone screenshots, report differences |

---

## Prerequisites

- **Node.js** 18+ with **Bun** runtime
- **agent-browser** — Headless browser for DOM extraction & screenshots
- **cheerio** — HTML parser for Node.js (`npm install cheerio`)
- **z-ai-web-dev-sdk** — AI tools (page_reader, LLM, VLM)
- **html-to-react-components** v1.6.6 — CLI fallback for simple HTML

Verify installation:
```bash
agent-browser --help
node -e "require('cheerio')" && echo "cheerio OK"
```

---

## Usage Guide

### 1. Single Page Clone

Clone a single page (e.g. homepage):

```bash
# Step 1: Fetch — Extract full HTML + CSS + styles + screenshots
node scripts/fetch-page.js "https://target-website.com" clone-output/html-raw

# Step 1b: Resolve CSS variables to actual values
node scripts/resolve-css-vars.js \
  clone-output/html-raw/extracted.css \
  clone-output/html-raw/resolved.css \
  clone-output/html-raw/design-tokens.json

# Step 2: Annotate — Inject data-component attributes
node scripts/annotate-html.js \
  clone-output/html-raw/page.html \
  clone-output/html-annotated/page.annotated.html

# Step 3a: Sanitize — Remove scripts and inline JS
node scripts/sanitize-html.js \
  clone-output/html-annotated/page.annotated.html \
  clone-output/html-annotated/page.sanitized.html

# Step 3b: Split — Generate .tsx component skeletons
node scripts/split-components.js \
  clone-output/html-annotated/page.sanitized.html \
  clone-output/components-raw

# Step 3c: Split CSS by component
node scripts/split-css-by-component.js \
  clone-output/html-raw/extracted.css \
  clone-output/components-raw \
  clone-output/components-css
```

After Step 3, you'll have:
- `clone-output/components-raw/` — .tsx component skeletons (Navbar.tsx, Hero.tsx, Footer.tsx, etc.)
- `clone-output/components-css/` — Per-component CSS files + shared.css
- `clone-output/html-raw/design-tokens.json` — Design tokens (colors, fonts, spacing)

### 2. Multi-Page Clone

Clone all pages of a website:

```bash
# Step 0: Crawl — Discover all internal links
node scripts/crawl-pages.js "https://target-website.com" 1 clone-output

# Step 1-3b: Batch process all discovered pages
node scripts/batch-pipeline.js clone-output/sitemap.json
```

This will:
1. Discover all internal pages and classify them (product, category, blog, etc.)
2. Run Steps 1→3b for each page
3. Save output to per-page directories: `clone-output/pages/{page-name}/`

### 3. AI Refinement (Step 4) & Visual QA (Step 5)

Steps 4 and 5 are interactive AI steps that should be run with the assistance of an AI agent:

```bash
# Step 4: Use LLM to refine each component skeleton
# Send each .tsx skeleton + its CSS + design tokens to the LLM
# The LLM converts CSS→Tailwind, adds React state, responsive design, accessibility

# Step 5: Compare original vs clone screenshots using VLM
# agent-browser screenshot of localhost:3000
# z-ai vision to compare screenshots and report differences
```

---

## Output Directory Structure

### Single Page
```
clone-output/
├── html-raw/                    # Step 1 output
│   ├── page.html               # Full rendered HTML (with <script>, <style>)
│   ├── extracted.css           # All <style> tag CSS
│   ├── resolved.css            # CSS with variables resolved
│   ├── design-tokens.json      # Computed styles: colors, fonts, spacing
│   └── meta.json               # Page metadata
├── html-annotated/              # Step 2 output
│   ├── page.annotated.html     # HTML with data-component attributes
│   └── page.sanitized.html     # Cleaned HTML for splitting
├── components-raw/              # Step 3 output: skeleton .tsx
│   ├── Navbar.tsx
│   ├── Hero.tsx
│   ├── Features.tsx
│   ├── Footer.tsx
│   └── Page.tsx                # Root page importing all components
├── components-css/              # Step 3b output: per-component CSS
│   ├── Navbar.css
│   ├── Hero.css
│   ├── shared.css              # Unmatched CSS rules
│   └── css-map.json            # Component → CSS rules mapping
├── qa/                          # Screenshots
│   ├── screenshot-original-desktop.png
│   └── screenshot-original-mobile.png
└── CLONE_META.json
```

### Multi-Page
```
clone-output/
├── sitemap.json                # All discovered pages + types
├── pages/
│   ├── home/                   # Home page (same structure as single page)
│   │   ├── html-raw/
│   │   ├── html-annotated/
│   │   ├── components-raw/
│   │   ├── components-css/
│   │   └── qa/
│   ├── shop_product-name/      # Product page
│   ├── categories_all/         # Category page
│   └── ...                     # Other pages
└── batch-report.json           # Summary of batch processing
```

---

## Scripts Reference

| Script | Pipeline Step | Description |
|--------|---------------|-------------|
| `fetch-page.js` | Step 1 | Extract full HTML + CSS + computed styles via agent-browser |
| `extract-styles.js` | Step 1b | Extract computed styles to design tokens |
| `extract-tokens.js` | Step 1b | Extract design tokens (colors, fonts, spacing) |
| `resolve-css-vars.js` | Step 1b | Resolve CSS `var(--token)` → actual values |
| `annotate-html.js` | Step 2 | Inject `data-component` attributes via cheerio |
| `sanitize-html.js` | Step 3 (pre) | Remove scripts/inline JS from HTML |
| `split-components.js` | Step 3 | Split annotated HTML into .tsx skeletons |
| `split-css-by-component.js` | Step 3b | Split CSS into per-component files + shared.css |
| `crawl-pages.js` | Step 0 | Discover all internal links & classify page types |
| `batch-pipeline.js` | Steps 1-3b | Run full pipeline for all discovered pages |
| `run-html2react.sh` | Step 3 (fallback) | Wrapper for html2react CLI |

---

## Key Design Decisions

1. **Full HTML content (no truncation)** — Component skeletons keep ALL HTML content (up to 500K chars). Truncation loses product prices, deep content, and nested styles.

2. **CSS per-component splitting** — Instead of one monolithic CSS blob, rules are mapped to components by class-name matching. This makes AI refinement easier.

3. **CSS variable resolution** — Framer uses `var(--token-xxx, fallback)` extensively. The resolve script resolves these to actual RGB values, making CSS self-contained for Tailwind conversion.

4. **Multi-page crawling** — Framer/Webflow sites have multiple routes (product pages, categories, etc.). Step 0 discovers all internal links and classifies them by type.

5. **Rendered DOM, not static HTML** — Using agent-browser gives us the DOM AFTER JavaScript execution, including runtime-applied styles and JS-rendered content.

---

## Component Reuse Strategy

When cloning multi-page sites, shared components like **Header** and **Footer** appear on every page. Here's how to handle them:

### Detection
After running the batch pipeline, compare component skeletons across pages:
```bash
# Header appears in every page's components-raw/
diff clone-output/pages/home/components-raw/Header.tsx \
     clone-output/pages/shop_product/components-raw/Header.tsx
```

### Consolidation
1. **Identical components** — If Header/Footer are identical across pages, keep ONE copy in `components/shared/`
2. **Variants** — If they differ slightly (e.g. active nav item), extract the variant part as a prop
3. **Page-specific components** — Keep unique content components in their page directories

### Recommended Structure
```
src/
├── components/
│   ├── shared/           # Reused across ALL pages
│   │   ├── Header.tsx    # Navigation
│   │   ├── Footer.tsx    # Footer
│   │   └── Layout.tsx    # Root layout wrapper
│   ├── home/             # Home page specific
│   │   ├── Hero.tsx
│   │   └── Features.tsx
│   ├── product/          # Product page specific
│   │   ├── ProductDetail.tsx
│   │   └── CTASection.tsx
│   └── category/         # Category page specific
│       └── ProductGrid.tsx
├── app/
│   ├── layout.tsx        # Uses <Header /> and <Footer />
│   ├── page.tsx          # Home page
│   ├── shop/[slug]/
│   │   └── page.tsx      # Product page
│   └── categories/[slug]/
│       └── page.tsx      # Category page
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `page.html` is JSON-encoded | Ensure `fetch-page.js` uses `JSON.parse()` on agent-browser eval results |
| Missing product prices | Increase `MAX_HTML_LEN` in `split-components.js` (default: 500K) |
| CSS variables unresolved | Run `resolve-css-vars.js` with `design-tokens.json` for computed values |
| html2react crashes on Framer HTML | Use cheerio-based `split-components.js` instead (handles modern HTML) |
| Visual QA score < 8/10 | Check QA report, refine specific components in Step 4 |
| Duplicate `className` in JSX | Fixed in `split-components.js` — uses spread conditional |
| Batch pipeline timeout | Process pages individually or increase timeout |

---

## Next Steps After Cloning

The clone pipeline produces **skeleton components** (Steps 1-3b). To build a real app:

1. **Step 4 (AI Refine)** — Convert CSS → Tailwind, add React state, responsive design
2. **Step 5 (Visual QA)** — Compare original vs clone, fix differences
3. **Component Consolidation** — Merge shared components (Header, Footer, Layout)
4. **Route Mapping** — Map cloned pages to Next.js App Router routes
5. **Data Layer** — Replace hardcoded content with CMS/API data
6. **Interactivity** — Add cart, auth, search, forms
7. **Performance** — Optimize images, lazy loading, code splitting

---

## License

MIT License — See [LICENSE.txt](LICENSE.txt)
