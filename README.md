# Clone Website → Build App

> Clone any website UI into a production-ready Next.js App Router project using a **hybrid pipeline** (Deterministic CLI + AI Brain).

## Overview

This is a **single skill** with two phases that takes you from URL → working Next.js app:

**Phase 1 (CLONE)**: Extract website data — HTML, CSS, components, design tokens
**Phase 2 (BUILD APP)**: Consolidate shared components, AI refine CSS→Tailwind, generate Next.js routes

### Why Hybrid?

| Problem | Pure AI Guess | This Hybrid Pipeline |
|---------|---------------|---------------------|
| Component structure | AI guesses layout → messy code | cheerio creates exact DOM structure |
| CSS accuracy | Approximated classes | Extracted computed styles → precise Tailwind mapping |
| State/logic | Often missed or wrong | AI specializes in logic AFTER structure is locked |
| Shared components | Duplicated across pages | Consolidated Header/Footer → 1 version |
| Fidelity | "Close enough" | Pixel-precise skeleton + AI refinement = production-ready |

---

## Full Pipeline

```
URL
 │
 ╔══════════════════════════════════════════════════╗
 ║  PHASE 1: CLONE — Extract website data           ║
 ╠══════════════════════════════════════════════════╣
 ║  Step 0: CRAWL     → Discover all pages          ║
 ║  Step 1: FETCH     → HTML + CSS + styles + assets ║
 ║  Step 1b: RESOLVE  → CSS variables → actual values║
 ║  Step 2: ANNOTATE  → data-component attributes    ║
 ║  Step 3: SPLIT     → .tsx component skeletons     ║
 ║  Step 3b: CSS SPLIT→ Per-component CSS files      ║
 ╚══════════════════════════════════════════════════╝
 │
 ╔══════════════════════════════════════════════════╗
 ║  PHASE 2: BUILD APP — Create Next.js project     ║
 ╠══════════════════════════════════════════════════╣
 ║  Step A: CONSOLIDATE → Merge shared components    ║
 ║  Step B: REFINE      → AI: CSS→Tailwind + state   ║
 ║  Step C: GENERATE    → Next.js App Router routes  ║
 ║  Step D: COPY ASSETS → Screenshots + tokens       ║
 ╚══════════════════════════════════════════════════╝
 │
 └─ Step 5: VERIFY → VLM Visual QA
```

---

## Prerequisites

- **Node.js** 18+ with **Bun** runtime
- **agent-browser** — Headless browser for DOM extraction & screenshots
- **cheerio** — HTML parser (`npm install cheerio`)
- **z-ai-web-dev-sdk** — AI tools (LLM, VLM, page_reader)
- **html-to-react-components** v1.6.6 — CLI fallback

---

## Usage Guide

### Phase 1: Clone Website

```bash
# Step 0: Discover all pages
node scripts/crawl-pages.js "https://target-website.com" 1 clone-output

# Step 1: Fetch HTML + CSS + styles + screenshots
node scripts/fetch-page.js "https://target-website.com" clone-output/html-raw

# Step 1b: Resolve CSS variables
node scripts/resolve-css-vars.js \
  clone-output/html-raw/extracted.css \
  clone-output/html-raw/resolved.css \
  clone-output/html-raw/design-tokens.json

# Step 2: Annotate components
node scripts/annotate-html.js \
  clone-output/html-raw/page.html \
  clone-output/html-annotated/page.annotated.html

# Step 3a: Sanitize
node scripts/sanitize-html.js \
  clone-output/html-annotated/page.annotated.html \
  clone-output/html-annotated/page.sanitized.html

# Step 3b: Split into components
node scripts/split-components.js \
  clone-output/html-annotated/page.sanitized.html \
  clone-output/components-raw

# Step 3c: Split CSS by component
node scripts/split-css-by-component.js \
  clone-output/html-raw/extracted.css \
  clone-output/components-raw \
  clone-output/components-css

# Batch: Run Steps 1-3c for all discovered pages
node scripts/batch-pipeline.js clone-output/sitemap.json
```

### Phase 2: Build App

```bash
# Full pipeline (consolidate + refine + generate + copy)
node scripts/build-app/build-app.js clone-output app-output

# Quick (skip AI refinement — use skeletons as-is)
node scripts/build-app/build-app.js clone-output app-output --skip-refine

# Step-by-step:
node scripts/build-app/consolidate-components.js clone-output
node scripts/build-app/refine-component.js \
  clone-output/components-shared/Header.tsx \
  app-output/components/shared \
  --css clone-output/components-shared/Header.css \
  --tokens clone-output/html-raw/design-tokens.json
node scripts/build-app/generate-routes.js clone-output app-output
```

---

## Scripts Reference

### Phase 1: Clone

| Script | Step | Description |
|--------|------|-------------|
| `crawl-pages.js` | 0 | Discover all internal links & classify page types |
| `fetch-page.js` | 1 | Extract full HTML + CSS + computed styles via agent-browser |
| `extract-styles.js` | 1b | Extract computed styles to design tokens |
| `extract-tokens.js` | 1b | Extract design tokens (colors, fonts, spacing) |
| `resolve-css-vars.js` | 1b | Resolve CSS `var(--token)` → actual values |
| `annotate-html.js` | 2 | Inject `data-component` attributes via cheerio |
| `sanitize-html.js` | 3 (pre) | Remove scripts/inline JS from HTML |
| `split-components.js` | 3 | Split annotated HTML into .tsx skeletons |
| `split-css-by-component.js` | 3b | Split CSS into per-component files + shared.css |
| `batch-pipeline.js` | 1-3b | Run full Phase 1 for all discovered pages |

### Phase 2: Build App

| Script | Step | Description |
|--------|------|-------------|
| `build-app/build-app.js` | All | Full Phase 2 orchestrator |
| `build-app/consolidate-components.js` | A | Merge shared components across pages |
| `build-app/refine-component.js` | B | AI refine single component (CSS→Tailwind) |
| `build-app/generate-routes.js` | C | Create Next.js App Router routes |

---

## Output Structure

### After Phase 1 (clone-output/)
```
clone-output/
├── sitemap.json                # All discovered pages
├── html-raw/                   # Raw HTML + CSS + tokens
├── html-annotated/             # Annotated HTML
├── components-raw/             # .tsx skeleton components
├── components-css/             # Per-component CSS
├── components-shared/          # Consolidated shared components (Phase 2 Step A)
├── pages/{name}/              # Per-page data (multi-page)
└── qa/                         # Reference screenshots
```

### After Phase 2 (app-output/)
```
app-output/
├── app/
│   ├── layout.tsx              # Root layout: Header + {children} + Footer
│   ├── page.tsx                # Home page
│   ├── globals.css             # Tailwind directives
│   ├── shop/[slug]/page.tsx    # Product detail (dynamic)
│   ├── categories/[slug]/page.tsx
│   ├── latest-drops/
│   │   ├── page.tsx            # Drops list
│   │   └── [slug]/page.tsx     # Drop detail (dynamic)
│   ├── wishlist/page.tsx
│   └── about/page.tsx
├── components/
│   ├── shared/                 # Header, Footer, Navbar (AI refined)
│   │   ├── Header.tsx          # 'use client', next/link, Tailwind
│   │   ├── Footer.tsx          # 'use client', useState, Tailwind
│   │   └── Navbar.tsx
│   └── pages/                  # Page-specific components
│       ├── home/               # Hero, Features, About, etc.
│       └── ...
├── public/reference/           # Original screenshots for QA
├── design-tokens.json
└── routes.json
```

---

## Component Reuse

**The key innovation**: Header and Footer appear on every page of the original site, but we only need **ONE version** of each in the Next.js app.

1. **Step A (Consolidate)** compares Header/Footer across all pages
2. Identical → one copy in `components/shared/`
3. Similar → best version chosen, differences noted
4. **layout.tsx** auto-generated: `<Header /> + {children} + <Footer />`
5. Each `page.tsx` only contains **page-specific content**

---

## Key Design Decisions

1. **Full HTML content (no truncation)** — Up to 500K chars. Truncation loses product prices and deep content.
2. **CSS per-component splitting** — Not one monolithic 284K blob, but per-component CSS for easier AI refinement.
3. **CSS variable resolution** — Framer `var(--token-xxx)` → actual RGB values.
4. **Multi-page crawling** — Discover all routes: products, categories, campaigns.
5. **Rendered DOM** — agent-browser gives DOM after JS execution (runtime styles, JS content).
6. **Shared component consolidation** — Header/Footer/Navbar from all pages → 1 shared version.
7. **AI refinement with smart truncation** — Large components summarized, design tokens compressed, shell limits avoided.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `page.html` is JSON-encoded | Ensure `fetch-page.js` uses `JSON.parse()` on agent-browser eval results |
| Missing product prices | Increase `MAX_HTML_LEN` in `split-components.js` (default: 500K) |
| CSS variables unresolved | Run `resolve-css-vars.js` with `design-tokens.json` |
| html2react crashes | Use cheerio-based `split-components.js` instead |
| LLM prompt too large | `refine-component.js` auto-truncates CSS/tokens/HTML |
| LLM output is JSON | `parseLLMOutput()` extracts content from z-ai API response |
| Duplicate routes | `generate-routes.js` deduplicates 21 pages → 7 unique routes |
| Visual QA score < 8 | Refine specific components, re-verify |

---

## License

MIT License — See [LICENSE.txt](LICENSE.txt)
