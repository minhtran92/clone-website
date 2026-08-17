# Mode Creative — Refine with Style Guide

> "Lấy HTML/CSS/JS gốc làm tham chiếu, dùng AI + design tokens + ui-ux-pro-max knowledge để tái sáng tác component Next.js đẹp hơn."

## Khi nào dùng Mode Creative

| Tình huống | Dùng |
|------------|------|
| User yêu cầu "build app" / "tái sáng tác" / "production-ready" | ✅ Mode Creative |
| Cần code sạch, maintainable, dùng shadcn/Tailwind idioms | ✅ Mode Creative |
| Cần tuân thủ design system của chính mình (không phải của site gốc) | ✅ Mode Creative |
| Cần customize thêm sections mới, không có trong site gốc | ✅ Mode Creative |
| Accessibility quan trọng (cần fix issues của site gốc) | ✅ Mode Creative |
| Cần "pixel-perfect" 1:1 với site gốc | ❌ → Mode Faithful |
| Cần giữ nguyên effects phức tạp (Canvas/WebGL/Framer choreography) | ❌ → Mode Faithful |

## Mục tiêu

- **Visual fidelity**: giữ bố cục, hierarchy, spacing, màu sắc xấp xỉ site gốc (≥7/10)
- **Code quality**: Tailwind v4 utilities, shadcn/ui primitives, TypeScript strict, mobile-first responsive
- **Token discipline**: dùng đúng design tokens từ Phase 1, không tự chế
- **Aesthetic polish**: motion presets, hover effects, focus rings, hover lifts — từ ui-ux-pro-max knowledge
- **Accessibility**: WCAG 2.1 AA, ARIA built-in (qua shadcn), focus-visible rings, touch targets ≥44px

## Pipeline tổng quan

```
clone-output/pages/{page}/
  ├── components-raw/{Name}.tsx              ← Component skeleton (raw HTML)
  ├── html-raw/design-tokens.json            ← Tokens (colors, fonts, spacing)
  ├── html-raw/resolved.css                  ← CSS resolved (tham khảo)
  ├── html-raw/extracted.css                 ← CSS gốc (tham khảo class thực tế)
  └── qa/screenshot-original-{desktop,mobile}.png
                    │
                    ▼
         ┌──────────────────────────────────────────┐
         │ 1. Build tokens.json (3-layer W3C DTCG)   │
         │    từ design-tokens.json                  │
         │ 2. Generate design-tokens.css + Tailwind │
         │    config via generate-tokens.cjs         │
         │ 3. Map vào globals.css @theme inline      │
         │ 4. Generate MASTER.md via search.py       │
         │    --design-system --persist              │
         │ 5. Refine từng component skeleton theo    │
         │    templates/refine-with-style.md         │
         │ 6. Run design-audit.mjs → fix findings    │
         │ 7. VLM-compare with original screenshot   │
         └──────────────────────────────────────────┘
                    │
                    ▼
         src/app/{route}/page.tsx           (Server Component)
         src/components/pages/{route}/*.tsx  (Server or Client Components)
         src/components/shared/*.tsx         (Reusable components)
         src/app/globals.css                 (with @theme inline + tokens)
```

## Quick commands

### 1. Generate MASTER.md (style + motion + density decisions)

```bash
# Run search.py with --design-system flag
python3 skills/clone-website/scripts/phase2-creative/search.py \
  "AI business builder for entrepreneurs, SaaS, marketing site" \
  --design-system \
  --persist \
  --output-dir design-system/durable \
  --variance 5 --motion 4 --density 5 \
  --stack nextjs

# Output:
# design-system/durable/MASTER.md  (global decisions)
# design-system/durable/pages/home.md  (page-specific)
```

### 2. Build tokens.json (3-layer W3C DTCG) from Phase 1 design-tokens.json

```bash
# Manual: read design-tokens.json, write tokens.json with 3-layer structure
# (or use sync-brand-to-tokens.cjs if you have brand-guidelines.md)

node skills/clone-website/scripts/phase2-creative/sync-brand-to-tokens.cjs \
  --brand-file docs/brand-guidelines.md \
  --dry-run  # preview first

# When ready:
node skills/clone-website/scripts/phase2-creative/sync-brand-to-tokens.cjs \
  --brand-file docs/brand-guidelines.md
```

### 3. Generate CSS + Tailwind config from tokens.json

```bash
# CSS variables (global + dark scope)
node skills/clone-website/scripts/phase2-creative/generate-tokens.cjs \
  --config tokens.json -o src/app/design-tokens.css

# Tailwind color config (optional, can also be inline in @theme)
node skills/clone-website/scripts/phase2-creative/generate-tokens.cjs \
  --config tokens.json -f tailwind > tailwind-colors.js
```

### 4. Update globals.css with @theme inline + :root + .dark

See `templates/refine-with-style.md` Step 2 for full template.

### 5. Refine component

Đọc `templates/refine-with-style.md` làm prompt, feed vào AI:
- Input: `clone-output/pages/{page}/components-raw/{Name}.tsx`
- Input: `clone-output/pages/{page}/html-raw/design-tokens.json`
- Input: `clone-output/pages/{page}/qa/screenshot-original-desktop.png` (VLM)
- Input: `design-system/{slug}/MASTER.md`
- Output: `src/components/pages/{page}/{Name}.tsx` (refined Next.js component)

### 6. Run design audit

```bash
# Start dev server (port 3000)
bun run dev &

# Audit
node skills/clone-website/scripts/phase2-creative/design-audit.mjs \
  --url http://localhost:3000/{route} \
  --out audit-output/{route}

# Check report
cat audit-output/{route}/report.md
```

### 7. Validate token compliance

```bash
node skills/clone-website/scripts/phase2-creative/validate-tokens.cjs --dir src/
# Should report 0 hardcoded hex/px/rem
```

## Knowledge sources

### Master design system (MASTER.md)

Generate trước khi refine bất kỳ component nào. MASTER.md cung cấp:
- **Pattern**: landing pattern (Hero+Features+CTA, Hero+Testimonials+CTA, Video-First, etc.)
- **Style**: Minimalism, Glassmorphism, Brutalism, etc. (88 styles available)
- **Colors**: 192 product palettes (SaaS, E-commerce, Healthcare, etc.)
- **Typography**: 74 font pairings (Classic Elegant, Modern Professional, Tech Startup, etc.)
- **Motion**: 17 GSAP presets × 3 tiers (Subtle, Standard, Complex)
- **Density**: spacing scale (Spacious 24-96px → Dense 8-32px)

### References (read before refine)

| Reference | What it provides |
|-----------|------------------|
| `references/ui-ux-pro-max/quick-reference.md` | 10-category UX rule set (Accessibility CRITICAL, Touch CRITICAL, Performance HIGH, ...) |
| `references/ui-ux-pro-max/pro-rules.md` | Pre-delivery checklist (icons, touch feedback, dark contrast, safe-area) |
| `references/ui-styling/shadcn-components.md` | Full shadcn catalog (Button, Input, Card, Tabs, Accordion, NavigationMenu, Dialog, Sheet, Popover, Toast, Command, AlertDialog, Skeleton, Table, Avatar, Badge) |
| `references/ui-styling/shadcn-theming.md` | CSS variables, dark mode, HSL format, color customization |
| `references/ui-styling/shadcn-accessibility.md` | ARIA patterns, focus management, screen reader, contrast |
| `references/ui-styling/tailwind-utilities.md` | Layout, spacing, typography, colors, borders, shadows utilities |
| `references/ui-styling/tailwind-customization.md` | @theme directive, @utility, @custom-variant, @layer, @apply |
| `references/ui-styling/tailwind-responsive.md` | Mobile-first breakpoints, container queries |
| `references/design-system/token-architecture.md` | 3-layer token pipeline (primitive → semantic → component) |
| `references/design-system/primitive-tokens.md` | Color scales, 4px spacing, font sizes, radius, shadows |
| `references/design-system/semantic-tokens.md` | Background/foreground/primary/secondary/muted/accent/destructive/border/ring |
| `references/design-system/component-tokens.md` | Button/input/card/badge/alert/dialog/table tokens |
| `references/design-system/tailwind-integration.md` | HSL space-separated for opacity modifier, @layer components |
| `references/design-system/states-and-variants.md` | 6 states (default/hover/focus/active/disabled/loading) |
| `references/design-system/component-specs.md` | Button 6 variants × 4 sizes, Input states, Card variants |
| `references/brand/color-palette-management.md` | Hierarchy (1-2 primary + 2-3 secondary + 3-5 neutral + 4 semantic) |
| `references/brand/typography-specifications.md` | Type scale Major Third 1.25, line heights, letter spacing |

### Data catalogs (BM25-searchable)

| CSV | Records | Purpose |
|-----|---------|---------|
| `data/ui-ux-pro-max/styles.csv` | 88 | Design styles (Minimalism, Glassmorphism, Brutalism, ...) |
| `data/ui-ux-pro-max/motion.csv` | 17 × 3 tiers | GSAP presets (Subtle/Standard/Complex) |
| `data/ui-ux-pro-max/typography.csv` | 74 | Font pairings with mood + best-for + Google Fonts URL |
| `data/ui-ux-pro-max/colors.csv` | 192 | Product palettes (SaaS, E-commerce, Healthcare, ...) |
| `data/ui-ux-pro-max/landing.csv` | 35 | Landing patterns (Hero+Features, Comparison Table, etc.) |
| `data/ui-ux-pro-max/ux-guidelines.csv` | 119 | UX rules |
| `data/ui-ux-pro-max/products.csv` | 192 | Product types |
| `data/ui-ux-pro-max/icons.csv` | 105 | Curated icons |
| `data/ui-ux-pro-max/ui-reasoning.csv` | varies | Decision rules for design_system.py |
| `data/ui-ux-pro-max/google-fonts.csv` | 1934 | All Google Fonts |
| `data/ui-ux-pro-max/stacks/nextjs.csv` | 62 | Next.js 16.2 conventions |
| `data/ui-ux-pro-max/stacks/shadcn.csv` | 69 | shadcn CLI v4 conventions |
| `data/ui-ux-pro-max/stacks/html-tailwind.csv` | 60 | Tailwind v4.3 conventions |

Search bằng `search.py`:
```bash
python3 scripts/phase2-creative/search.py "SaaS landing hero" --domain landing
python3 scripts/phase2-creative/search.py "modern startup font pairing" --domain typography
python3 scripts/phase2-creative/search.py "error summary validation" --domain ux
```

## Trade-offs (be honest)

| Ưu điểm | Nhược điểm |
|---------|------------|
| Code đẹp, idiomatic, maintainable | Mất thời gian refine từng component (AI prompt cost) |
| Dùng shadcn/ui + Tailwind v4 best practices | Fidelity < mode-faithful (AI có thể "tái sáng tác" sai ý) |
| Accessibility built-in | Một số effects phức tạp (Canvas/WebGL) khó tái tạo |
| Dùng được cho nhiều projects (reusable components) | Cần generate MASTER.md trước (python script) |
| Dễ customize thêm sections mới | Token mapping có thể không hoàn hảo (cần manual tune) |
| Performance tốt (Tree-shake, Server Components) | Có thể mất tính "đặc trưng" của brand (font custom, animation riêng) |

## Common pitfalls

### 1. AI "tự chế" tokens
AI đôi khi tự chế tokens (`--brand-blue`, `--accent-color`) thay vì dùng tokens từ Phase 1.

**Fix**:
- Đưa `design-tokens.json` vào context bắt buộc
- Dùng `validate-tokens.cjs` để tìm hardcoded values
- Prompt template `refine-with-style.md` đã có rule "must use tokens, no hardcoded hex"

### 2. AI skip accessibility
AI hay quên `aria-label`, `alt`, `focus-visible`.

**Fix**:
- `design-audit.mjs` sẽ catch các issues này
- Re-run audit cho đến khi 0 HIGH/MEDIUM findings

### 3. AI dùng Tailwind v3 syntax
`bg-gradient-to-r`, `flex-shrink-0`, `h-4 w-4` (thay vì `size-4`).

**Fix**:
- Reference `data/ui-ux-pro-max/stacks/html-tailwind.csv` (60 rules v4)
- Add anti-patterns vào prompt

### 4. Fidelity thấp
AI "tái sáng tác" quá xa so với screenshot gốc.

**Fix**:
- VLM-analyze screenshot kỹ hơn (capture spacing, hierarchy, color usage)
- Add "BEFORE/AFTER" example vào prompt để AI hiểu reference
- Re-run với prompt nói rõ "preserve visual hierarchy"

### 5. Animation không chạy
AI thêm CSS animation nhưng thiếu keyframes trong `tailwind.config.ts`.

**Fix**:
- Define keyframes trong `globals.css` hoặc `tailwind.config.ts`
- Sử dụng motion presets từ `motion.csv` (đã có GSAP code ready)

## Verification checklist

Sau khi refine xong:

- [ ] `src/app/{route}/page.tsx` tồn tại, là Server Component (no `'use client'` ở top)
- [ ] `src/components/pages/{route}/` có ít nhất 1 section component
- [ ] `src/app/globals.css` có `@theme inline` block + `:root` + `.dark` blocks
- [ ] `tokens.json` tồn tại ở project root (3-layer W3C DTCG)
- [ ] `MASTER.md` tồn tại trong `design-system/{slug}/`
- [ ] `validate-tokens.cjs --dir src/` reports 0 hardcoded hex/px/rem
- [ ] `design-audit.mjs` reports 0 HIGH findings, ≤2 MEDIUM findings
- [ ] VLM-compare screenshot gốc vs clone: fidelity ≥7/10
- [ ] `bun run lint` passes
- [ ] Dev server runs without errors
- [ ] All pages mobile-responsive (test at 360/390/768/1024/1440/1920px)
- [ ] All interactive elements have `aria-label` (if icon-only) + visible focus ring
- [ ] Touch targets ≥44×44px on mobile

## Comparison: Mode Faithful vs Mode Creative

| Aspect | Mode Faithful | Mode Creative |
|--------|---------------|---------------|
| **Fidelity** | 9-10/10 (1:1 port) | 6-8/10 (AI refined) |
| **Speed** | Fast (5 scripts, ~30s/page) | Slow (AI refine, 2-5 min/component) |
| **Code quality** | Medium (dangerouslySetInnerHTML, inline styles) | High (Tailwind v4, shadcn, TypeScript) |
| **Maintainability** | Low (raw HTML) | High (idiomatic React) |
| **Bundle size** | Large (full CSS injected) | Small (tree-shaken utilities) |
| **Accessibility** | Same as origin | Better (Radix ARIA built-in) |
| **Customization** | Hard (modify raw HTML) | Easy (component-based) |
| **Effects** | 100% preserved (Canvas/Framer kept) | Recreated (may differ) |
| **Assets** | Real (downloaded) | Optional (can use placeholders) |
| **When to use** | "Clone y bản gốc" | "Build app production-ready" |
