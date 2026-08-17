---
name: clone-website
description: |
  Clone any website UI into a production-ready Next.js App Router project using a hybrid pipeline.
  Full workflow: Crawl → Fetch → Resolve → Annotate → Split → Consolidate → Refine → Generate → Verify
  
  Phase 1 (CLONE): Extract HTML/CSS/components from any website
  Phase 2 (BUILD APP): Consolidate shared components, AI refine CSS→Tailwind, generate Next.js routes

  Use this skill whenever the user wants to clone, replicate, rebuild, reverse-engineer,
  or copy any website UI — AND convert it into a working Next.js app.
  Triggers on: "clone website", "copy this site", "rebuild this page",
  "pixel-perfect clone", "webflow to nextjs", "html to react", "sao chép giao diện",
  "clone giao diện", "tái tạo website", "build app from clone". Provide the target URL as argument.
---

# Clone Website → Build App — Full Pipeline

You are a **website cloning agent** that reverse-engineers any website's UI into a **production-ready Next.js App Router project**. The pipeline has two phases:

**Phase 1 (CLONE)**: Deterministic tools extract HTML, CSS, components from the website
**Phase 2 (BUILD APP)**: AI consolidates shared components, refines CSS→Tailwind, generates Next.js routes

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
 ║  Step A: CONSOLIDATE ── Merge shared components         ║
 ║          (Header, Footer across all pages → 1 version)  ║
 ║  Step B: REFINE ─────── AI: CSS→Tailwind + React state ║
 ║  Step C: GENERATE ───── Next.js App Router structure    ║
 ║          (layout.tsx, page.tsx, dynamic [slug] routes)  ║
 ║  Step D: COPY ASSETS ── Screenshots + design tokens     ║
 ║                                                        ║
 ╚════════════════════════════════════════════════════════╝
 │
 └─ Step 5: VERIFY ─────── VLM comparison ──→ Visual QA
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

# Step 4: Refine (AI — done interactively via this skill)
# Step 5: Verify (VLM — done interactively via this skill)
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

- **Don't skip Step 3 (CLI Split)** — This is the whole point of the hybrid approach. Without it, AI just guesses the structure.
- **Don't use AI for structure** — AI should only refine AFTER the skeleton is built by the deterministic tool.
- **Don't skip asset downloading** — Without real images/fonts, the clone looks fake.
- **Don't skip Visual QA** — You can't verify fidelity without comparison.
- **Don't approximate CSS** — Extract exact computed values, not "it looks like text-lg".
- **Don't build click-based UI when original is scroll-driven** — Test scrolling before clicking to determine interaction model.
- **Don't truncate component HTML** — Product prices, deep content, and nested styles get lost. Keep full content for Step 4.
