---
name: clone-to-app
description: |
  Convert cloned website data (from clone-website skill) into a production-ready Next.js App Router project.
  Handles: shared component consolidation, AI refinement (CSS→Tailwind), route generation, and layout setup.
  Triggers on: "build app from clone", "convert clone to app", "refine cloned components", "phát triển app từ clone",
  "tạo app từ dữ liệu clone", "refine clone".
---

# Clone-to-App — Convert Cloned Data into a Next.js App

This skill takes the output from the **clone-website** skill and produces a working Next.js App Router project with:
- **Shared components** (Header, Footer, Navbar) consolidated across all pages
- **AI-refined components** (CSS → Tailwind, React state, responsive design)
- **Next.js App Router** routes properly mapped from the original sitemap
- **Root layout** with Header + Footer wrapping all pages

## Pipeline

```
clone-output/ (from clone-website)
 │
 ├─ Step A: CONSOLIDATE ──→ Merge shared components (Header, Footer, Navbar)
 │                           Identify identical/similar/unique components
 │
 ├─ Step B: REFINE ───────→ AI refine each component
 │                           CSS → Tailwind, add React state, responsive, a11y
 │
 ├─ Step C: GENERATE ─────→ Create Next.js App Router structure
 │                           layout.tsx, page.tsx, dynamic routes
 │
 └─ Step D: COPY ASSETS ──→ Copy design tokens, reference screenshots
```

## Prerequisites

- **clone-website** skill output in `clone-output/` directory
- **z-ai-web-dev-sdk** — LLM for AI refinement (unless using `--skip-refine`)
- **Node.js** 18+ with **Bun** runtime

## Usage Guide

### Quick Start (Skip AI Refinement)

Generate the app structure with skeleton components (no AI refinement):

```bash
node skills/clone-to-app/scripts/build-app.js clone-output app-output --skip-refine
```

### Full Pipeline (With AI Refinement)

Generate the app with AI-refined components:

```bash
node skills/clone-to-app/scripts/build-app.js clone-output app-output --model glm-4-flash
```

### Step-by-Step

Run each step individually:

```bash
# Step A: Consolidate shared components
node skills/clone-to-app/scripts/consolidate-components.js clone-output

# Step B: Refine a single component (example)
node skills/clone-to-app/scripts/refine-component.js \
  clone-output/components-shared/Navbar.tsx \
  app-output/components/shared \
  --css clone-output/components-shared/Navbar.css \
  --tokens clone-output/html-raw/design-tokens.json

# Step C: Generate routes
node skills/clone-to-app/scripts/generate-routes.js clone-output app-output
```

## Scripts Reference

| Script | Step | Description |
|--------|------|-------------|
| `build-app.js` | All | Full pipeline orchestrator |
| `consolidate-components.js` | A | Merge shared components across pages |
| `refine-component.js` | B | AI refine single component (CSS→Tailwind) |
| `generate-routes.js` | C | Create Next.js App Router routes |

## Output Structure

```
app-output/
├── app/
│   ├── layout.tsx              # Root layout with Header + Footer
│   ├── page.tsx                # Home page
│   ├── globals.css             # Tailwind directives
│   ├── shop/[slug]/page.tsx    # Product detail
│   ├── categories/[slug]/page.tsx  # Category pages
│   ├── latest-drops/
│   │   ├── page.tsx            # Drops list
│   │   └── [slug]/page.tsx     # Drop detail
│   ├── wishlist/page.tsx
│   └── about/page.tsx
├── components/
│   ├── shared/                 # Consolidated shared components
│   │   ├── Header.tsx
│   │   ├── Footer.tsx
│   │   ├── Navbar.tsx
│   │   └── ...
│   └── pages/                  # Page-specific components
│       ├── home/
│       │   ├── Hero.tsx
│       │   └── Features.tsx
│       ├── shop_product/
│       └── categories_all/
├── public/
│   └── reference/              # Original screenshots for QA
├── design-tokens.json          # Design tokens from clone
├── routes.json                 # Route mapping metadata
└── build-summary.json          # Build summary
```

## Component Reuse

### How Shared Components Work

1. **Consolidation** identifies components that appear in multiple pages
2. **Identical** components (100% match) → one copy in `components/shared/`
3. **Similar** components (>80% match) → best version in `components/shared/`, differences noted
4. **Unique** components → stay in `components/pages/{page}/`
5. **layout.tsx** imports Header + Footer from `@/components/shared/`

### The layout.tsx Pattern

```tsx
import Header from '@/components/shared/Header';
import Footer from '@/components/shared/Footer';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
```

Each page.tsx only needs its page-specific content — Header and Footer are handled by the layout.

## Key Design Decisions

1. **Home page preference** — When consolidating shared components, the home page version is preferred as it's typically the most complete
2. **Graceful fallback** — If AI refinement fails, the skeleton component is copied as-is
3. **Page-specific isolation** — Components unique to a page stay in their own directory, not mixed with shared
4. **Dynamic routes** — Product pages use `[slug]` parameter pattern for Next.js dynamic routing
5. **Tailwind-first** — AI refinement converts ALL CSS to Tailwind utility classes, no inline styles

## When to Use This Skill

- After running the **clone-website** skill and having `clone-output/` data
- User wants to convert cloned data into a working Next.js app
- User wants to consolidate shared components (Header, Footer)
- User wants AI to refine components (CSS → Tailwind)
- Phrases: "build app from clone", "convert to app", "refine components", "phát triển app"
