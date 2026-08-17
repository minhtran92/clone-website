# Phase 2 — Mode Faithful (Pixel-Perfect Port)

Pipeline "port nguyên HTML/CSS/JS" sang Next.js. Mục tiêu là **reproduce 1:1** giao diện gốc — không "tái sáng tác".

## Pipeline (7 bước — cải tiến v2)

```
clone-output/pages/{page}/
  ├── html-annotated/page.sanitized.html  ← input (N1: hydrated DOM)
  ├── components-raw/*.tsx                ← input (per-component skeletons)
  ├── html-raw/resolved.css               ← input (F2: var() preserved)
  ├── html-raw/extracted.css              ← input
  └── html-raw/design-tokens.json         ← input (F2: cssVars for :root block)
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. port-html-to-jsx.js   (N5: per-component, N6: strip       │
│    opacity:0/transform:translateY, N8: detect                │
│    data-framer-appear-id)                                    │
│    Output: src/components/pages/{page}/{Header,Hero,...}.tsx │
├─────────────────────────────────────────────────────────────┤
│ 2. download-assets.js   (N4: global hash-based dedup)       │
│    Output: public/assets/_hash/{ab}/{hash}.jpg               │
│    + public/assets/_hash/url-map.json                        │
│    + public/assets/{page}-assets-manifest.json                │
├─────────────────────────────────────────────────────────────┤
│ 3. download-fonts.js   (N4: global hash-based dedup)        │
│    Output: public/assets/fonts/_hash/{ab}/{hash}.woff2        │
│    + public/assets/fonts/_font-url-map.json                  │
│    + public/assets/fonts/{page}/fonts.css                     │
├─────────────────────────────────────────────────────────────┤
│ 4. rewrite-asset-urls.js                                     │
│    Replace remote URLs → /assets/_hash/... in JSX             │
├─────────────────────────────────────────────────────────────┤
│ 5. split-css-modules.js   (F3+N7: per-component .module.css) │
│    Output: src/components/pages/{page}/*.module.css           │
│    + src/components/pages/{page}/shared.module.css            │
├─────────────────────────────────────────────────────────────┤
│ 6. inject-resolved-css.js   (F1: no scoping, F2: vars)      │
│    Inject resolved.css + extracted.css into globals.css       │
│    + :root { --token: value } block from tokens.json         │
│    + @font-face rules stripped (handled by fonts.css)         │
├─────────────────────────────────────────────────────────────┤
│ 7. generate-page.js   (F4+N9: real React tree in page.tsx)  │
│    Output: src/app/{route}/page.tsx                          │
│    Imports: Header, HeroSection, MainContent, Footer, etc.   │
└─────────────────────────────────────────────────────────────┘
                  │
                  ▼
src/
├── app/globals.css                          ← CSS injected (no scoping)
├── app/{route}/page.tsx                     ← real React component tree
└── components/pages/{page}/
    ├── Header.tsx                           ← ported per-component
    ├── Header.module.css                    ← per-component CSS
    ├── HeroSection.tsx
    ├── HeroSection.module.css
    ├── MainContent.tsx
    ├── MainContent.module.css
    ├── Footer.tsx
    ├── Footer.module.css
    └── shared.module.css                    ← unmatched rules

public/assets/
├── _hash/                                   ← global dedup storage
│   ├── ab/{hash}.jpg                        ← image (hash-based)
│   ├── cd/{hash}.woff2                      ← font (hash-based)
│   └── url-map.json                         ← URL → local path map
└── fonts/{page}/fonts.css                   ← @font-face declarations
```

## Quick start

```bash
# Single page (vd: home)
node skills/clone-website/scripts/phase2-faithful/batch-faithful.js \
  clone-output/pages/home --src src --public public --page home

# All pages
node skills/clone-website/scripts/phase2-faithful/batch-faithful.js \
  clone-output/pages --src src --public public --all
```

## Manual step-by-step

```bash
# 1. Port HTML → JSX (per-component if components-raw/ exists)
node scripts/phase2-faithful/port-html-to-jsx.js \
  clone-output/pages/home/components-raw \
  src/components/pages/home --page home --css-modules

# 2. Download assets (global hash-based dedup)
node scripts/phase2-faithful/download-assets.js \
  clone-output/pages/home \
  --out public/assets --page home

# 3. Download fonts (global hash-based dedup)
node scripts/phase2-faithful/download-fonts.js \
  clone-output/pages/home/html-raw \
  --out public/assets/fonts --page home

# 4. Rewrite URLs in JSX (use manifest from step 2)
node scripts/phase2-faithful/rewrite-asset-urls.js \
  src/components/pages/home \
  --manifest public/assets/home-assets-manifest.json

# 5. Split CSS into per-component .module.css (F3+N7)
node scripts/phase2-faithful/split-css-modules.js \
  clone-output/pages/home/html-raw/extracted.css \
  clone-output/pages/home/components-raw \
  src/components/pages/home

# 6. Inject resolved CSS into globals.css (F1+F2)
node scripts/phase2-faithful/inject-resolved-css.js \
  clone-output/pages/home/html-raw/resolved.css \
  --extracted clone-output/pages/home/html-raw/extracted.css \
  --globals src/app/globals.css \
  --page home \
  --tokens clone-output/pages/home/html-raw/design-tokens.json

# 7. Generate page.tsx with real React component tree (F4+N9)
node scripts/phase2-faithful/generate-page.js \
  src/components/pages/home \
  src/app/page.tsx --page home --route /
```

## Wiring into the Next.js app

`generate-page.js` tự động tạo `src/app/{route}/page.tsx`:

```tsx
// Auto-generated by clone-website/scripts/phase2-faithful/generate-page.js
import Header from '../components/pages/home/Header';
import HeroSection from '../components/pages/home/HeroSection';
import MainContent from '../components/pages/home/MainContent';
import Footer from '../components/pages/home/Footer';

export const metadata = { title: 'home', description: '...' };

export default function Page() {
  return (
    <main data-page="home">
      <Header />
      <HeroSection />
      <MainContent />
      <Footer />
    </main>
  );
}
```

## What's NEW in v2 (N1-N9, F1-F4)

### Phase 1 improvements (clone-website/scripts/):

| Code | What | Why |
|------|------|-----|
| **N1** | Hydrated DOM capture (networkidle + scroll-trigger) | Framer runtime JS reveals elements via IntersectionObserver. Without scrolling through the page during fetch, SSR HTML has opacity:0 everywhere. Now fetch-page.js scrolls through the page to trigger all reveal animations BEFORE capturing HTML. |
| **N2** | Strip inline `<style data-framer-font-css>` blocks | Saved ~200KB/page of duplicate @font-face declarations. Fonts handled by `fonts.css` (single source of truth). |
| **N3** | Strip Framer runtime `<script>` tags | Framer runtime is 1MB+ and references external CDN URLs that won't work in the cloned app. Since we already captured HYDRATED DOM (N1), we don't need the runtime. |
| **N4** | Global asset + font dedup (hash-based) | Multiple pages referencing same URL → 1 file on disk. Storage savings ~60% (1737 → ~650 unique files for 9-page clone). |
| **N6-preflight** | Strip opacity:0, transform:translateY(*) in sanitize | Without Framer runtime, these would hide content forever. Stripped at sanitize time so HTML passed to port-html-to-jsx is clean. |

### Phase 2 improvements (phase2-faithful/):

| Code | What | Why |
|------|------|-----|
| **N5** | port-html-to-jsx runs PER-COMPONENT | Avoids Turbopack OOM on large pages. Each component stays small (5-50KB). |
| **N6** | Strip opacity:0, transform:translateY(*) in JSX style conversion | Defense-in-depth (in addition to N6-preflight). Ensures hidden elements become visible. |
| **N7** | CSS Modules per-component (.module.css) | Class names scoped automatically (hashed) → no leak between pages. Next.js native support. |
| **N8** | Detect data-framer-appear-id → preserve for Framer Motion | Elements with `data-framer-appear-id` are tracked. Component file gets `import { motion } from 'framer-motion'` + `appearVariants` object for optional manual enhancement. |
| **F1** | No `:where([data-page="..."])` scoping | Original site doesn't scope its CSS — neither do we. Cascade order preserved exactly. |
| **F2** | Keep `var(--token)` references + define `:root` from tokens.json | Dynamic theming (dark mode) preserved. CSS variables work exactly like in source site. |
| **F3** | Per-component .module.css + shared.module.css | Instead of one giant CSS blob, each component has its own CSS module. Smaller files, faster HMR. |
| **F4** | Real React component tree (no dangerouslySetInnerHTML) | page.tsx imports real React components and composes them. Hot-reload faster, customizable per-component. |
| **N9** | Real React component tree | Each component is a real React component (not HTML blob). Can be enhanced, tested, customized individually. |

## Scripts reference

| Script | Mục đích | Input | Output |
|--------|---------|-------|--------|
| `port-html-to-jsx.js` | Convert HTML/JSX skeleton → valid JSX (N5: per-component, N6: strip opacity:0, N8: detect framer-appear-id) | `page.sanitized.html` hoặc directory of `.tsx` skeletons | `src/components/pages/{page}/*.tsx` |
| `download-assets.js` | Tải ảnh/media remote (N4: global hash dedup) | `clone-output/pages/{page}` dir | `public/assets/_hash/{ab}/{hash}.jpg` + `url-map.json` + `{page}-assets-manifest.json` |
| `download-fonts.js` | Tải @font-face files (N4: global hash dedup) | `html-raw/extracted.css` or dir | `public/assets/fonts/_hash/{ab}/{hash}.woff2` + `_font-url-map.json` + `fonts.css` |
| `rewrite-asset-urls.js` | Replace remote URLs → local paths | Thư mục `.tsx`/`.css` + manifest | Files đã rewrite (in-place) |
| `split-css-modules.js` | F3+N7: Split CSS into per-component `.module.css` | `extracted.css` + `components-raw/` | `src/components/pages/{page}/*.module.css` + `shared.module.css` |
| `inject-resolved-css.js` | F1+F2: Inject CSS vào globals (no scoping, vars preserved) | `resolved.css` (optional: `extracted.css`, `design-tokens.json`) | `src/app/globals.css` (updated) |
| `generate-page.js` | F4+N9: Generate real React component tree in page.tsx | `src/components/pages/{page}` dir | `src/app/{route}/page.tsx` |
| `batch-faithful.js` | Orchestrator — chạy 7 bước trên | `clone-output/pages/{page}` | Tất cả outputs ở trên |

## Caveats

1. **DOM fidelity**: 100% giữ nguyên DOM gốc (post-hydration), không thay đổi class, không thay đổi style (trừ opacity:0/transform:translateY để tránh hidden elements).
2. **Tailwind**: Class Tailwind trong HTML gốc vẫn hoạt động nếu Next.js project dùng cùng Tailwind version. Custom utilities cần được port thủ công sang `tailwind.config.ts`.
3. **CSS variables (F2)**: `resolved.css` giữ nguyên `var(--token)` references. Tokens được define trong `:root` block đầu globals.css (từ `design-tokens.json`).
4. **Specificity (F1)**: CSS không scope bằng `:where()` — selectors giữ nguyên như gốc. Nếu muốn scope theo page, dùng CSS Modules (N7).
5. **Scripts/Animations**: `<script>` và `<style>` tags được giữ nguyên nội dung (qua `dangerouslySetInnerHTML`). Framer runtime đã bị strip (N3). Để tái tạo scroll-reveal animations, dùng `data-framer-appear-id` attributes (N8 preserved) + Framer Motion.
6. **External CDN assets**: URL ảnh, video, font từ CDN của site gốc sẽ được download về local `public/assets/_hash/` (N4). URL từ các domain khác cũng sẽ được download — kiểm tra manifest để biết.
7. **Asset dedup (N4)**: Multiple pages reference chung 1 remote URL → 1 file local. Hash-based filename đảm bảo không trùng lặp.
8. **Per-component CSS (N7)**: Mỗi component có `.module.css` riêng (Next.js CSS Modules). Class names được scoped tự động.
9. **Real React tree (F4+N9)**: `page.tsx` imports real React components, không dùng `dangerouslySetInnerHTML`. Mỗi component có thể customize riêng.
10. **Hot reload**: Vì mỗi component là file nhỏ (5-50KB), Turbopack hot-reload rất nhanh (100-700ms).
