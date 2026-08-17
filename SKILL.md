---
name: clone-website
description: |
  Clone any website UI into a production-ready Next.js App Router project using a hybrid pipeline.
  Full workflow: Crawl → Fetch → Resolve → Annotate → Split → Consolidate → Refine → Generate → Verify
  
  Phase 1 (CLONE): Extract HTML/CSS/components from any website
  Phase 2 (BUILD APP): Two modes —
    - Mode Faithful  : Port nguyên HTML/CSS/JS sang Next.js (pixel-perfect 1:1)
    - Mode Creative  : AI refine với ui-ux-pro-max knowledge + design tokens thật

  Use this skill whenever the user wants to clone, replicate, rebuild, reverse-engineer,
  or copy any website UI — AND convert it into a working Next.js app.
  Triggers on: "clone website", "copy this site", "rebuild this page",
  "pixel-perfect clone", "webflow to nextjs", "html to react", "sao chép giao diện",
  "clone giao diện", "tái tạo website", "build app from clone". Provide the target URL as argument.
---

# Clone Website → Build App — Full Pipeline

You are a **website cloning agent** that reverse-engineers any website's UI into a **production-ready Next.js App Router project**. The pipeline has two phases:

**Phase 1 (CLONE)**: Deterministic tools extract HTML, CSS, components from the website
**Phase 2 (BUILD APP)**: Choose 1 of 2 modes:

- **Mode Faithful** (`--mode=faithful`) — Port nguyên HTML/CSS/JS sang Next.js. DOM 1:1, download ảnh + font thật, inject CSS gốc. Pixel-perfect fidelity, nhưng code không "đẹp".
- **Mode Creative** (`--mode=creative`, default) — AI refine component skeleton sang Next.js + Tailwind v4 + shadcn/ui đẹp, dùng đúng design tokens từ Phase 1 + ui-ux-pro-max aesthetic knowledge.

## When to use which mode?

| Tình huống | Mode |
|------------|------|
| User yêu cầu "clone y bản gốc" / "pixel-perfect" / "1:1" | **Faithful** |
| Cần giữ nguyên mọi animation, Canvas, WebGL, Framer effects | **Faithful** |
| Cần giữ font thương hiệu riêng (vd newSpiritCondensed, custom woff2) | **Faithful** |
| Cần build nhanh (chạy scripts, không cần AI) | **Faithful** |
| User yêu cầu "build app" / "tái sáng tác" / "production-ready" | **Creative** |
| Cần code sạch, maintainable, dùng shadcn/Tailwind idioms | **Creative** |
| Cần customize thêm sections mới, không có trong site gốc | **Creative** |
| Accessibility quan trọng (cần fix issues của site gốc) | **Creative** |

## Why This Hybrid Approach Works

| Problem | Pure AI Guess | This Hybrid Pipeline |
|---------|---------------|---------------------|
| Component structure | AI guesses layout → messy code | `html-to-react-components` creates exact DOM structure |
| CSS accuracy | Approximated classes | Extracted computed styles → precise Tailwind mapping |
| State/logic | Often missed or wrong | AI specializes in logic AFTER structure is locked |
| Fidelity | "Close enough" | Pixel-precise skeleton + AI refinement = production-ready |

## Pipeline Overview

```
URL
 │
 ╔════════════════════════════════════════════════════════╗
 ║  PHASE 1: CLONE — Extract website data                ║
 ╠════════════════════════════════════════════════════════╣
 ║                                                        ║
 ║  Step 0: CRAWL ──────── agent-browser ──→ Discover pages║
 ║  Step 1: FETCH ──────── agent-browser ──→ HTML+CSS+styles║
 ║    └─ Step 1b: RESOLVE ─ resolve-css-vars → Actual values║
 ║  Step 2: ANNOTATE ───── LLM+cheerio ────→ data-component ║
 ║  Step 3: SPLIT ──────── cheerio ────────→ .tsx skeletons ║
 ║    └─ Step 3b: CSS SPLIT → Per-component CSS            ║
 ║                                                        ║
 ╚════════════════════════════════════════════════════════╝
 │
 ╔════════════════════════════════════════════════════════╗
 ║  PHASE 2: BUILD APP — Create Next.js project           ║
 ╠════════════════════════════════════════════════════════╣
 ║                                                        ║
 ║  Pick a mode:                                          ║
 ║                                                        ║
 ║  ┌─ Mode Faithful (--mode=faithful) ──────────────┐    ║
 ║  │  2.1 Port HTML → JSX                            │    ║
 ║  │  2.2 Download assets (images, media)            │    ║
 ║  │  2.3 Download fonts (@font-face)                │    ║
 ║  │  2.4 Rewrite asset URLs in JSX                  │    ║
 ║  │  2.5 Inject resolved.css → globals.css          │    ║
 ║  └────────────────────────────────────────────────┘    ║
 ║                                                        ║
 ║  ┌─ Mode Creative (--mode=creative, default) ─────┐    ║
 ║  │  2.1 Build 3-layer W3C DTCG tokens.json         │    ║
 ║  │  2.2 Generate CSS + Tailwind config             │    ║
 ║  │  2.3 Map into globals.css (@theme inline)       │    ║
 ║  │  2.4 Generate MASTER.md (style/motion/density)  │    ║
 ║  │  2.5 Refine components (per refine-with-style)  │    ║
 ║  │  2.6 Validate tokens (no hardcoded hex/px)      │    ║
 ║  └────────────────────────────────────────────────┘    ║
 ║                                                        ║
 ╚════════════════════════════════════════════════════════╝
 │
 └─ Step 5: VERIFY ─────── VLM + design-audit.mjs ──→ Visual + heuristic QA
```

## Prerequisites (Already Installed)

- **html-to-react-components** v1.6.6 — CLI: `html2react`
- **cheerio** — HTML parser for Node.js annotation step
- **z-ai-web-dev-sdk** — page_reader, LLM, VLM
- **agent-browser** — Screenshot capture for QA

Verify with:
```bash
html2react --help        # CLI tool for Step 3
node -e "require('cheerio')"  # HTML parser for Step 2
```

## Working Directory Convention

When a clone job starts, create this structure under the project root:

```
clone-output/
├── sitemap.json                # Step 0 output: all discovered pages + types
├── pages/                      # Step 0 output: per-page link data
│   ├── _links.json
│   └── shop_long-sleeve-shirt-links.json
├── html-raw/                    # Step 1 output: full rendered HTML + CSS
│   ├── page.html               # Full HTML source (with <script>, <style>)
│   ├── extracted.css           # All <style> tag CSS (284K+ chars)
│   ├── resolved.css            # CSS with variables resolved to actual values
│   ├── design-tokens.json      # Computed styles: colors, fonts, spacing, shadows
│   └── meta.json               # Page metadata
├── html-annotated/              # Step 2 output: HTML with data-component attrs
│   ├── page.annotated.html
│   └── page.sanitized.html     # Cleaned HTML for splitting
├── components-raw/              # Step 3 output: skeleton .tsx (full content)
│   ├── Navbar.tsx
│   ├── Hero.tsx
│   ├── Features.tsx
│   ├── Footer.tsx
│   └── Page.tsx                # Root page importing all components
├── components-css/              # Step 3b output: CSS split per-component
│   ├── Navbar.css
│   ├── Hero.css
│   ├── shared.css              # CSS rules not matched to any component
│   └── css-map.json            # Mapping: component → CSS rules
├── components/                  # Step 4 output: refined Tailwind + Next.js components
├── qa/                          # Step 5 output: screenshots + QA report
│   ├── screenshot-original-desktop.png
│   ├── screenshot-original-mobile.png
│   └── qa-report.md
└── CLONE_META.json             # Metadata about the clone job
```

---

## Step 1: Fetch & Extract (agent-browser — primary, page_reader — fallback)

**Tool:** `agent-browser` (primary) or `z-ai page_reader` (fallback)
**Type:** Deterministic

### Why agent-browser instead of page_reader?

`page_reader` only extracts **article content** — it strips `<script>`, `<style>`, external CSS, and JS bundles. For Framer/Webflow sites, most styling lives in these stripped elements. `agent-browser` gets the **full rendered HTML source** plus all computed styles.

| What we need | page_reader | agent-browser |
|-------------|-------------|---------------|
| Full HTML source | ❌ Article only | ✅ Complete with `<script>`, `<style>` |
| Computed styles | ❌ Not available | ✅ `getComputedStyle()` on all elements |
| CSS variables | ❌ Not available | ✅ Parsed from `document.styleSheets` |
| Inline CSS text | ❌ Stripped | ✅ All `<style>` tag contents |
| External stylesheets | ❌ Stripped | ✅ URLs captured for download |
| Screenshots | ❌ Not available | ✅ Desktop + mobile |
| Images | ❌ Partial | ✅ All `<img>` + background images |

### What to do

Run the fetch script (auto-detects agent-browser, falls back to page_reader):
```bash
node skills/clone-website/scripts/fetch-page.js "TARGET_URL" clone-output/html-raw
```

This script does:
1. Open the page in browser via `agent-browser`
2. Extract full HTML source (with `<script>`, `<style>`, all attributes)
3. Extract computed styles: colors, fonts, font sizes, spacing, border radius, shadows
4. Extract CSS variables from `document.styleSheets`
5. Extract all `<style>` tag CSS text
6. Extract all `<img>` sources + background images
7. Take desktop (1440px) + mobile (390px) screenshots
8. Save everything to `clone-output/html-raw/` and `clone-output/qa/`

### Manual alternative (if script fails):
```bash
# Open page
agent-browser open "TARGET_URL"
agent-browser wait 3000

# Get full HTML
agent-browser eval "document.documentElement.outerHTML" > clone-output/html-raw/page.html

# Get computed styles (example)
agent-browser eval "JSON.stringify([...new Set([...document.querySelectorAll('*')].slice(0,300).map(e=>{try{return getComputedStyle(e).color}catch{return''}}).filter(Boolean))])"

# Screenshot
agent-browser screenshot clone-output/qa/screenshot-original.png
```

5. Download assets (images, fonts, SVGs) to `clone-output/public/assets/`

### Success Criteria
- [ ] `page.html` exists and contains the full HTML
- [ ] Screenshot saved for QA comparison
- [ ] Design tokens (colors, fonts) extracted
- [ ] All image assets downloaded

---

## Step 2: AI Annotate (LLM + cheerio)

**Tool:** LLM (z-ai) + cheerio (Node.js parser)
**Type:** AI-assisted

### What to do

AI analyzes the HTML structure and injects `data-component="ComponentName"` attributes onto major semantic sections. This prepares the HTML for Step 3's deterministic splitting.

### 2a. Pattern Detection (cheerio — deterministic)

Use cheerio to scan for common patterns and auto-annotate:

| Pattern | data-component value |
|---------|---------------------|
| `<header>` or `[class*="nav"]` | `Navbar` |
| `[class*="hero"]` or `[class*="banner"]` | `HeroSection` |
| `[class*="feature"]` | `FeaturesGrid` |
| `[class*="service"]` | `ServicesSection` |
| `[class*="about"]` | `AboutSection` |
| `[class*="team"]` | `TeamSection` |
| `[class*="testimonial"]` or `[class*="review"]` | `Testimonials` |
| `[class*="pricing"]` | `PricingSection` |
| `[class*="cta"]` or `[class*="call"]` | `CTASection` |
| `[class*="contact"]` | `ContactSection` |
| `[class*="faq"]` | `FAQSection` |
| `[class*="stats"]` or `[class*="counter"]` | `StatsSection` |
| `[class*="blog"]` or `[class*="post"]` | `BlogSection` |
| `[class*="gallery"]` or `[class*="portfolio"]` | `Gallery` |
| `[class*="video"]` | `VideoSection` |
| `[class*="logo"]` | `Logo` |
| `<footer>` or `[class*="footer"]` | `Footer` |
| `<section[id]>` | `Section{id}` (PascalCase) |

Run the annotation script:
```bash
cd /home/z/my-project
node skills/clone-website/scripts/annotate-html.js clone-output/html-raw/page.html clone-output/html-annotated/page.annotated.html
```

### 2b. AI Review (LLM — intelligent fallback)

If cheerio detects fewer than 3 components, use LLM to analyze the structure more deeply:

```bash
z-ai chat -m glm-4-flash -p "Analyze this HTML and return a JSON array of {selector, name} pairs for major UI sections. Each section should get a data-component attribute. Return ONLY the JSON array.

HTML:
$(cat clone-output/html-raw/page.html | head -200)"
```

Apply the LLM-suggested annotations to the HTML file.

### Success Criteria
- [ ] `page.annotated.html` exists with `data-component` attributes
- [ ] At least 3 components detected (Navbar, content sections, Footer)
- [ ] Each `data-component` value is PascalCase

---

## Step 3: Split into Components (cheerio-based splitter)

**Tool:** `split-components.js` (cheerio) — falls back to `html2react` CLI for simple HTML
**Type:** Deterministic — NO AI involved

### Why cheerio instead of html2react CLI?

`html-to-react-components` uses an older babylon parser that **crashes on modern HTML** (Framer, Webflow with inline JS/CSS). Our cheerio-based splitter handles any valid HTML and produces the same structural output.

### What to do

**First**, sanitize the HTML to remove scripts and complex inline JS:
```bash
node skills/clone-website/scripts/sanitize-html.js \
  clone-output/html-annotated/page.annotated.html \
  clone-output/html-annotated/page.sanitized.html
```

**Then**, split by `data-component` attributes:
```bash
node skills/clone-website/scripts/split-components.js \
  clone-output/html-annotated/page.sanitized.html \
  clone-output/components-raw
```

**Fallback**: For simple/clean HTML, you can try the original html2react CLI:
```bash
html2react clone-output/html-annotated/page.sanitized.html \
  -o clone-output/components-raw -c stateless -e js
```

The cheerio splitter produces `.tsx` files with **DOM-accurate** React component skeletons. The structure is guaranteed correct because it's compiled from the actual HTML, not guessed by AI.

### Success Criteria
- [ ] `components-raw/` contains at least 3 `.tsx` files
- [ ] Each file has a valid React component export
- [ ] DOM structure matches the annotated HTML

---

# PHASE 2 — BUILD APP

## Choose your mode

| Mode | Flag | Fidelity | Speed | Code Quality | When |
|------|------|----------|-------|--------------|------|
| **Faithful** | `--mode=faithful` | 9-10/10 (1:1) | Fast (~30s/page) | Medium (raw HTML, dangerouslySetInnerHTML) | "clone y bản gốc" / pixel-perfect |
| **Creative** | `--mode=creative` (default) | 6-8/10 | Slow (2-5 min/component) | High (Tailwind v4, shadcn, TS) | "build app" / production-ready |

See `references/mode-faithful-guide.md` and `references/mode-creative-guide.md` for full guides.

---

## Mode Faithful — Pixel-Perfect Port

**Goal**: Port nguyên HTML/CSS/JS sang Next.js, giữ DOM 1:1.

**Scripts** (all in `skills/clone-website/scripts/phase2-faithful/`):

| Script | Bước | Mục đích |
|--------|------|---------|
| `port-html-to-jsx.js` | 2.1 | HTML → JSX (class→className, attr camelCase, SVG dashed→camelCase, boolean attrs preserved, `<script>`/`<style>` attrs kept) |
| `download-assets.js` | 2.2 | Tải ảnh/media remote về `public/assets/{page}/` (SSRF-safe, srcset parsed, --allow-private flag) |
| `download-fonts.js` | 2.3 | Parse `@font-face` từ CSS files → download woff2 only (+ fallback chain), emit `fonts-manifest.json` |
| `rewrite-asset-urls.js` | 2.4 | Replace remote URLs bằng local paths (dùng asset manifest + font manifest) |
| `inject-resolved-css.js` | 2.5 | Inject `resolved.css` + `extracted.css` vào globals.css, scope bằng `:where([data-page="..."])` (preserves @font-face/@keyframes verbatim) |
| `batch-faithful.js` | All | Orchestrator — chạy 5 bước trên (proper arg quoting, scans whole page dir for assets) |

**Quick run**:
```bash
# Single page
node skills/clone-website/scripts/phase2-faithful/batch-faithful.js \
  clone-output/pages/home --src src --public public --page home

# All pages
node skills/clone-website/scripts/phase2-faithful/batch-faithful.js \
  clone-output/pages --src src --public public --all

# For localhost / intranet clones (SSRF-safe with --allow-private)
node skills/clone-website/scripts/phase2-faithful/batch-faithful.js \
  clone-output/pages/home --src src --public public --page home --allow-private
```

**Security**: By default, `download-assets.js` and `download-fonts.js` block requests to private/loopback IPs (127.0.0.1, 10.x, 192.168.x, 169.254.169.254, etc.) to prevent SSRF. Pass `--allow-private` to override (e.g. when cloning a localhost dev server). Use `--allow-host <hostname>` to allowlist specific hostnames.

**Wiring vào Next.js**:
```tsx
// src/app/home/page.tsx
import PageFaithful from '@/components/pages/home/PageFaithful';

export default function Page() {
  return (
    <main data-page="home">
      <PageFaithful />
    </main>
  );
}
```

The `data-page="home"` attribute enables `:where([data-page="home"])` CSS scope (0 specificity, so Tailwind utilities still win when needed).

---

## Mode Creative — Refine with Style

**Goal**: AI tái sáng tác component skeleton thành Next.js + Tailwind v4 + shadcn/ui ĐẸP, dùng đúng design tokens từ Phase 1 + ui-ux-pro-max aesthetic knowledge.

**Pipeline**:
1. **Build tokens.json** (3-layer W3C DTCG: primitive → semantic → component) từ `design-tokens.json` của Phase 1
2. **Generate CSS + Tailwind config** qua `generate-tokens.cjs`
3. **Map vào `globals.css`** với `@theme inline` + `:root` + `.dark` blocks (shadcn CLI v4 convention, HSL space-separated for opacity modifier)
4. **Generate MASTER.md** qua `python3 search.py "<brief>" --design-system --persist --output-dir design-system/<slug>` (style + motion tier + density decisions)
5. **Refine từng component** theo `templates/refine-with-style.md` prompt (đầu vào: skeleton + tokens + screenshot + MASTER.md → đầu ra: Next.js component đẹp)
6. **Validate tokens** qua `validate-tokens.cjs --dir src/` (no hardcoded hex/px/rem)
7. **Run design-audit.mjs** để check heuristic (overflow, alt, focus, contrast, tap target, viewport meta, html lang, headings) trên 6 viewports
8. **VLM-compare** với screenshot gốc → fidelity ≥7/10

**Prompt template**: `templates/refine-with-style.md` (5 steps: Load context → Map tokens → Refactor skeleton → Motion presets → Self-audit, with full anti-patterns list).

**Knowledge sources** (đã copy từ `ui-ux-pro-max-skill`):
- `references/ui-ux-pro-max/` — 10-category UX rules + pre-delivery checklist
- `references/ui-styling/` — shadcn theming + components + accessibility + Tailwind utilities/customization/responsive
- `references/design-system/` — 3-layer token architecture (primitive/semantic/component) + Tailwind integration + states-and-variants + component-specs
- `references/brand/` — color palette management + typography specifications + visual identity + consistency checklist
- `data/ui-ux-pro-max/` — 88 styles, 17 GSAP presets × 3 tiers, 74 font pairings, 192 product palettes, 35 landing patterns, 119 UX guidelines, 22 stacks (1260 rules), 1934 Google Fonts, 105 icons, 25 chart types

**Quick run**:
```bash
# Generate MASTER.md (style decisions)
python3 skills/clone-website/scripts/phase2-creative/search.py \
  "AI business builder for SaaS, marketing site" \
  --design-system \
  --persist \
  --output-dir design-system/durable \
  --variance 5 --motion 4 --density 5 \
  --stack nextjs

# Build 3-layer tokens (manual or via sync-brand-to-tokens.cjs)
node skills/clone-website/scripts/phase2-creative/sync-brand-to-tokens.cjs \
  --brand-file docs/brand-guidelines.md --dry-run

# Generate CSS variables
node skills/clone-website/scripts/phase2-creative/generate-tokens.cjs \
  --config tokens.json -o src/app/design-tokens.css

# (Refine components using templates/refine-with-style.md prompt)

# Audit
node skills/clone-website/scripts/phase2-creative/design-audit.mjs \
  --url http://localhost:3000/home --out audit-output/home

# Validate token compliance
node skills/clone-website/scripts/phase2-creative/validate-tokens.cjs --dir src/
```

---

## Step 4: AI Refine (LLM — Tailwind + Logic + Next.js)

**Tool:** LLM (z-ai)
**Type:** AI — the "brain" step

This is where AI shines. The structural skeleton from Step 3 is correct but raw — it has inline styles, no Tailwind, no state, no Next.js conventions. AI transforms each skeleton into production-ready code.

### What to do

For each component skeleton from Step 3, use LLM to refine:

```bash
z-ai chat -m glm-4-flash -p "$(cat skills/clone-website/templates/refine-prompt.txt)"
```

### Refinement Rules (give to LLM)

The LLM must apply these rules to each component:

1. **CSS → Tailwind**: Convert ALL inline styles and CSS classes to Tailwind utility classes
   - `font-size: 16px` → `text-base`
   - `padding: 24px` → `p-6`
   - `display: flex; gap: 16px` → `flex gap-4`
   - Colors → use CSS variables or Tailwind config values

2. **Next.js App Router conventions**:
   - Add `'use client'` if component has interactivity (onClick, useState, etc.)
   - Use `next/image` for `<img>` tags
   - Use `next/link` for `<a>` tags
   - Proper TypeScript interfaces for props

3. **Add React state/logic**:
   - Mobile menu: `useState` for open/close + toggle handler
   - Scroll effects: `useEffect` + scroll listener
   - Tab switching: `useState` for active tab
   - Accordion: `useState` for open items
   - Form inputs: controlled components with `useState`

4. **Responsive design**:
   - Mobile-first: write base styles for mobile
   - Use `sm:`, `md:`, `lg:` prefixes for breakpoints
   - Hamburger menu for mobile nav
   - Stack columns on mobile, side-by-side on desktop

5. **Accessibility**:
   - ARIA labels on interactive elements
   - Keyboard navigation support
   - Alt text on images
   - Semantic HTML elements

6. **Remove `dangerouslySetInnerHTML`**: Convert to proper JSX

### Generate layout.tsx and page.tsx

After refining all section components, generate:

**layout.tsx**: Root layout with fonts, metadata, globals.css import
**page.tsx**: Main page that imports and assembles all section components

### Success Criteria
- [ ] All components use Tailwind CSS (no inline styles)
- [ ] Interactive elements have proper state handlers
- [ ] `'use client'` on components with interactivity
- [ ] Responsive classes present (sm:, md:, lg:)
- [ ] No `dangerouslySetInnerHTML` remaining
- [ ] layout.tsx and page.tsx generated

---

## Step 5: Visual QA (VLM)

**Tool:** VLM (z-ai) + agent-browser
**Type:** AI verification

### What to do

1. Take screenshot of the cloned site:
```bash
agent-browser navigate --url "http://localhost:3000"
agent-browser screenshot --full-page --output clone-output/qa/screenshot-clone.png
```

2. Use VLM to compare:
```bash
z-ai vision -p "Compare these two screenshots. The FIRST is the original website, the SECOND is the clone. List ALL visual differences: colors, spacing, fonts, layout, missing elements. Rate overall fidelity 1-10." \
  -i clone-output/qa/screenshot-original.png \
  -i clone-output/qa/screenshot-clone.png
```

3. Fix any discrepancies found by going back to Step 4 for affected components

### Success Criteria
- [ ] Visual fidelity score ≥ 8/10
- [ ] All major sections present and correctly styled
- [ ] Responsive behavior matches original
- [ ] Interactive elements work correctly

---

## Quick Reference Commands

### Phase 1 (CLONE) — dùng chung cho cả 2 mode

```bash
# Step 0: Crawl (discover all pages)
node skills/clone-website/scripts/crawl-pages.js "TARGET_URL" 1 clone-output

# Step 1: Fetch (agent-browser primary, page_reader fallback)
node skills/clone-website/scripts/fetch-page.js "TARGET_URL" clone-output/html-raw

# Step 1b: Resolve CSS variables to actual values
node skills/clone-website/scripts/resolve-css-vars.js clone-output/html-raw/extracted.css clone-output/html-raw/resolved.css clone-output/html-raw/design-tokens.json

# Step 2: Annotate
node skills/clone-website/scripts/annotate-html.js clone-output/html-raw/page.html clone-output/html-annotated/page.annotated.html

# Step 3: Sanitize + Split
node skills/clone-website/scripts/sanitize-html.js clone-output/html-annotated/page.annotated.html clone-output/html-annotated/page.sanitized.html
node skills/clone-website/scripts/split-components.js clone-output/html-annotated/page.sanitized.html clone-output/components-raw

# Step 3b: Split CSS by component
node skills/clone-website/scripts/split-css-by-component.js clone-output/html-raw/extracted.css clone-output/components-raw clone-output/components-css

# Batch all steps for multiple pages:
node skills/clone-website/scripts/batch-pipeline.js "TARGET_URL" clone-output
```

### Phase 2 — Mode Faithful (pixel-perfect 1:1 port)

```bash
# Run all 5 steps for one page
node skills/clone-website/scripts/phase2-faithful/batch-faithful.js \
  clone-output/pages/home --src src --public public --page home

# Or all pages
node skills/clone-website/scripts/phase2-faithful/batch-faithful.js \
  clone-output/pages --src src --public public --all

# Individual steps:
node skills/clone-website/scripts/phase2-faithful/port-html-to-jsx.js \
  clone-output/pages/home/html-annotated/page.sanitized.html \
  src/components/pages/home/PageFaithful.tsx --name PageFaithful --page home

node skills/clone-website/scripts/phase2-faithful/download-assets.js \
  clone-output/pages/home/html-annotated/page.sanitized.html \
  --out public/assets/home --page home

node skills/clone-website/scripts/phase2-faithful/download-fonts.js \
  clone-output/pages/home/html-raw/extracted.css \
  --out public/assets/fonts --page home

node skills/clone-website/scripts/phase2-faithful/rewrite-asset-urls.js \
  src/components/pages/home \
  --manifest public/assets/home/home-assets-manifest.json

node skills/clone-website/scripts/phase2-faithful/inject-resolved-css.js \
  clone-output/pages/home/html-raw/resolved.css \
  --extracted clone-output/pages/home/html-raw/extracted.css \
  --globals src/app/globals.css \
  --page home
```

### Phase 2 — Mode Creative (AI refine with ui-ux-pro-max knowledge)

```bash
# Generate MASTER.md (style/motion/density decisions)
python3 skills/clone-website/scripts/phase2-creative/search.py \
  "AI business builder for SaaS, marketing site" \
  --design-system \
  --persist \
  --output-dir design-system/durable \
  --variance 5 --motion 4 --density 5 \
  --stack nextjs

# Build 3-layer tokens from brand-guidelines.md
node skills/clone-website/scripts/phase2-creative/sync-brand-to-tokens.cjs \
  --brand-file docs/brand-guidelines.md --dry-run  # preview

# Generate CSS variables + Tailwind config
node skills/clone-website/scripts/phase2-creative/generate-tokens.cjs \
  --config tokens.json -o src/app/design-tokens.css

node skills/clone-website/scripts/phase2-creative/generate-tokens.cjs \
  --config tokens.json -f tailwind > tailwind-colors.js

# (Refine components using templates/refine-with-style.md prompt with AI)

# Validate token compliance (no hardcoded hex/px/rem)
node skills/clone-website/scripts/phase2-creative/validate-tokens.cjs --dir src/

# Audit on 6 viewports (mobile-360, mobile-390, tablet-768, laptop-1024, desktop-1440, wide-1920)
node skills/clone-website/scripts/phase2-creative/design-audit.mjs \
  --url http://localhost:3000/home --out audit-output/home

# Search the ui-ux-pro-max knowledge base
python3 skills/clone-website/scripts/phase2-creative/search.py "SaaS landing hero" --domain landing
python3 skills/clone-website/scripts/phase2-creative/search.py "modern startup font pairing" --domain typography
python3 skills/clone-website/scripts/phase2-creative/search.py "error summary validation" --domain ux
```

### Step 5: Verify (both modes)

```bash
# Visual fidelity check (VLM)
z-ai vision -p "Compare these two screenshots. List ALL visual differences. Rate overall fidelity 1-10." \
  -i clone-output/pages/home/qa/screenshot-original-desktop.png \
  -i audit-output/home/screenshots/desktop-1440.png

# Or use design-audit.mjs (mode-creative only, gives heuristic report)
node skills/clone-website/scripts/phase2-creative/design-audit.mjs \
  --url http://localhost:3000/home --out audit-output/home
```

## When to Use This Skill

- User wants to clone a website from Webflow, Squarespace, Wix, or any site
- User has a website design and wants it in Next.js code
- User needs to replicate a landing page, portfolio, or marketing site
- User wants to convert HTML/CSS to React/Next.js components
- Phrases: "clone website", "copy this site", "rebuild this page", "pixel-perfect clone", "webflow to nextjs", "clone giao diện", "sao chép website"

## Key Design Decisions

1. **Full HTML content (no truncation)**: Component skeletons keep ALL HTML content (up to 500K chars). Previous 5K-char truncation lost product prices, deep content, and CSS. Step 4 (AI) needs complete data to generate correct Tailwind.

2. **CSS per-component splitting**: Instead of one 284K CSS blob, rules are mapped to components by class-name matching. This makes Step 4 easier — each component gets only its relevant CSS.

3. **CSS variable resolution**: Framer uses `var(--token-xxx, fallback)` extensively. The `resolve-css-vars.js` script resolves these to actual RGB values, making CSS self-contained for Tailwind conversion.

4. **Multi-page crawling**: Framer/Webflow sites have multiple routes (product pages, categories, etc.). Step 0 discovers all internal links and classifies them by type (product, category, info, etc.).

5. **Rendered DOM, not static HTML**: Using agent-browser gives us the DOM AFTER JavaScript execution, including runtime-applied styles and JS-rendered content (prices, cart counts, etc.).

## What NOT to Do

### Common (both modes)

- **Don't skip Step 3 (CLI Split)** — This is the whole point of the hybrid approach. Without it, AI just guesses the structure.
- **Don't use AI for structure** — AI should only refine AFTER the skeleton is built by the deterministic tool.
- **Don't skip asset downloading** — Without real images/fonts, the clone looks fake.
- **Don't skip Visual QA** — You can't verify fidelity without comparison.
- **Don't approximate CSS** — Extract exact computed values, not "it looks like text-lg".
- **Don't build click-based UI when original is scroll-driven** — Test scrolling before clicking to determine interaction model.
- **Don't truncate component HTML** — Product prices, deep content, and nested styles get lost. Keep full content for Step 4.

### Mode Faithful specific

- **Don't convert class names** — Keep `bg-black/3`, `text-black/80`, `rounded-3xl`, `has-[:focus]` etc. as-is. Only convert syntax HTML → JSX (`class` → `className`, `for` → `htmlFor`, etc.).
- **Don't remove `<script>` or `<style>` tags** — Preserve them via `dangerouslySetInnerHTML` (port-html-to-jsx does this automatically).
- **Don't replace raw `<button>`, `<input>`, `<dialog>` with shadcn primitives** — Mode Faithful keeps the original DOM. Use shadcn only in Mode Creative.
- **Don't skip the `data-page` attribute** — Without it, the `:where([data-page="..."])` CSS scope won't apply, and styles will leak between pages.
- **Don't use `!important`** — Use Tailwind v4 `!` modifier (`bg-white!`) instead, which is more idiomatic.

### Mode Creative specific

- **Don't hardcode hex colors** (`text-[#00B67A]`) — Use `text-primary` or `bg-primary` semantic tokens.
- **Don't mix hex + token** (`bg-white text-primary`) — Use `bg-background text-foreground` + `text-primary` for accent.
- **Don't use `bg-blue-500`** (default Tailwind palette) when brand has its own palette — Use `bg-primary` (mapped via `@theme inline`).
- **Don't hardcode spacing** (`p-[17px]`, `gap-[18px]`) — Use Tailwind scale (`p-4`, `gap-4`).
- **Don't use desktop-first responsive** (`text-xl max-md:text-base`) — Use mobile-first (`text-base md:text-xl`).
- **Don't use `flex-shrink-0`** (deprecated) — Use `shrink-0`.
- **Don't use `h-6 w-6`** for square — Use `size-6`.
- **Don't use dynamic class names** (`` `bg-${color}-500` ``) — Tailwind v4 can't static-detect → use `colorMap[color]` pattern with complete tokens.
- **Don't use `'use client'` on entire page** — Push to leaf components. Server Component is default.
- **Don't use `<img>`** instead of `<Image>` — CLS risk + no auto-optimization.
- **Don't use `<a href="/internal">`** — Use `<Link>` for client-side nav + prefetch.
- **Don't use placeholder as label** — Use `<FieldLabel htmlFor="...">`.
- **Don't use inline styles** (except dynamic `animationDelay` per-item, custom CSS variables via `style={{ '--foo': 'bar' }}`).
- **Don't mix flat & skeuomorphic styles randomly** — Pick 1 style from MASTER.md.
- **Don't use emoji as icons** — Use Lucide (`import { X } from "lucide-react"`).
- **Don't use `bg-gradient-to-r`** (Tailwind v3 syntax) — Use `bg-linear-to-r` (v4).
- **Don't animate width/height/top/left** — Use transform/opacity only.
- **Don't use one duration for every transition** — Use semantic durations (fast 150ms, normal 200ms, slow 300ms).
- **Don't skip `prefers-reduced-motion` fallback** — `motion-reduce:transition-none`.
- **Don't use `focus:ring-2`** (shows on click) — Use `focus-visible:ring-2`.
- **Don't use touch targets < 44×44px** on mobile — `min-h-11 min-w-11`.
- **Don't skip `aria-label`** on icon-only buttons.
- **Don't skip `alt`** on `<Image>` (use `alt=""` for decorative).
- **Don't skip heading levels** (h1 → h3) — Sequential h1→h2→h3.
- **Don't have more than 1 `<h1>`** per page.
- **Don't skip `<meta name="viewport">`** — Mobile rendering breaks.
- **Don't skip `lang` attribute** on `<html>`.
- **Don't rely on color alone for meaning** — Add icon + text.
