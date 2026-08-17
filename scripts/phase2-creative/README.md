# Phase 2 — Mode Creative (Refine with Style)

Pipeline "AI refine" component skeleton sang Next.js đẹp theo design tokens thật + ui-ux-pro-max knowledge.

## Quy trình

1. Đọc `clone-output/pages/{page}/html-raw/design-tokens.json` (Phase 1 output)
2. Build `tokens.json` W3C DTCG 3-layer (primitive → semantic → component) — thủ công hoặc qua `sync-brand-to-tokens.cjs`
3. Run `generate-tokens.cjs --config tokens.json -o design-tokens.css` → CSS variables
4. Run `generate-tokens.cjs --config tokens.json -f tailwind > tailwind-colors.js` → Tailwind config
5. Map vào `globals.css` với `@theme inline` block (shadcn CLI v4 convention)
6. Run `python3 search.py "<product-brief>" --design-system --persist --output-dir .` → `MASTER.md` (style/motion/density decisions)
7. Refine từng component skeleton theo `templates/refine-with-style.md` prompt
8. Run `node design-audit.mjs --url http://localhost:3000/<route> --out audit-output` → fix HIGH/MEDIUM findings
9. Ship

## File được copy từ ui-ux-pro-max-skill

- `search.py`, `core.py`, `design_system.py`, `reasoning_contract.py` — Knowledge engine (BM25 + regex search, 22 stacks, design dials)
- `generate-tokens.cjs`, `validate-tokens.cjs`, `embed-tokens.cjs` — Token pipeline (JSON → CSS/Tailwind)
- `extract-colors.cjs`, `sync-brand-to-tokens.cjs`, `inject-brand-context.cjs`, `validate-asset.cjs` — Brand sync
- `tailwind_config_gen.py`, `shadcn_add.py` — Tailwind + shadcn helpers
- `design-audit.mjs` — 6-viewport Playwright QA (10 heuristic checks, exit code 2 cho CI gate)

## References (đọc trước khi refine)

- `../../references/ui-ux-pro-max/quick-reference.md` — 10-category UX rules
- `../../references/ui-ux-pro-max/pro-rules.md` — Pre-delivery checklist
- `../../references/ui-styling/*` — shadcn + Tailwind patterns
- `../../references/design-system/*` — 3-layer token architecture
- `../../references/brand/*` — Brand → tokens sync

## Data (BM25-searchable catalogs)

- `../../data/ui-ux-pro-max/styles.csv` — 88 design styles
- `../../data/ui-ux-pro-max/motion.csv` — 17 GSAP presets × 3 tiers
- `../../data/ui-ux-pro-max/typography.csv` — 74 font pairings
- `../../data/ui-ux-pro-max/colors.csv` — 192 product palettes
- `../../data/ui-ux-pro-max/landing.csv` — 35 landing patterns
- `../../data/ui-ux-pro-max/ux-guidelines.csv` — 119 UX rules
- `../../data/ui-ux-pro-max/stacks/{nextjs,shadcn,html-tailwind}.csv` — Stack conventions
