# Phase 2 — Mode Faithful (Pixel-Perfect Port)

Pipeline "port nguyên HTML/CSS/JS" sang Next.js. Mục tiêu là **reproduce 1:1** giao diện gốc — không "tái sáng tác".

## Pipeline (5 bước)

```
clone-output/pages/{page}/
  ├── html-annotated/page.sanitized.html  ← input
  ├── components-raw/*.tsx                ← input (alternative)
  ├── html-raw/resolved.css               ← input
  └── html-raw/extracted.css              ← input
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│ 1. port-html-to-jsx.js                              │
│    HTML → JSX (class→className, attr camelCase)     │
│    Output: src/components/pages/{page}/*.tsx        │
├─────────────────────────────────────────────────────┤
│ 2. download-assets.js                               │
│    Scan HTML/CSS → find remote URLs → download      │
│    Output: public/assets/{page}/<host>/<file>       │
│    Manifest: public/assets/{page}/{page}-assets-...  │
├─────────────────────────────────────────────────────┤
│ 3. download-fonts.js                                │
│    Parse @font-face → download woff2/woff/ttf       │
│    Output: public/assets/fonts/{page}/*.woff2       │
│    + fonts.css với @font-face declarations mới       │
├─────────────────────────────────────────────────────┤
│ 4. rewrite-asset-urls.js                             │
│    Đọc manifest → thay remote URL bằng local path   │
│    In-place update các file .tsx và .css             │
├─────────────────────────────────────────────────────┤
│ 5. inject-resolved-css.js                            │
│    Inject resolved.css + extracted.css vào globals  │
│    Wrap rules trong :where([data-page="..."]) scope │
└─────────────────────────────────────────────────────┘
                  │
                  ▼
src/
├── app/globals.css                          ← có injected CSS
├── app/{page}/page.tsx                      ← import + render PageFaithful
└── components/pages/{page}/PageFaithful.tsx ← ported component
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
# 1. Port HTML → JSX
node scripts/phase2-faithful/port-html-to-jsx.js \
  clone-output/pages/home/html-annotated/page.sanitized.html \
  src/components/pages/home/PageFaithful.tsx --name PageFaithful --page home

# 2. Download assets (images, media)
node scripts/phase2-faithful/download-assets.js \
  clone-output/pages/home/html-annotated/page.sanitized.html \
  --out public/assets/home --page home

# 3. Download fonts
node scripts/phase2-faithful/download-fonts.js \
  clone-output/pages/home/html-raw/extracted.css \
  --out public/assets/fonts --page home

# 4. Rewrite URLs in JSX (use manifest from step 2)
node scripts/phase2-faithful/rewrite-asset-urls.js \
  src/components/pages/home \
  --manifest public/assets/home/home-assets-manifest.json

# 5. Inject resolved CSS into globals.css
node scripts/phase2-faithful/inject-resolved-css.js \
  clone-output/pages/home/html-raw/resolved.css \
  --extracted clone-output/pages/home/html-raw/extracted.css \
  --globals src/app/globals.css \
  --page home
```

## Wiring into the Next.js app

Sau khi chạy batch, thêm vào `src/app/{page}/page.tsx`:

```tsx
import PageFaithful from '@/components/pages/{page}/PageFaithful';

export default function Page() {
  return (
    <main data-page="{page}">
      <PageFaithful />
    </main>
  );
}
```

Lưu ý `data-page="{page}"` — attribute này để `:where([data-page="home"])` selector trong globals.css chỉ apply cho đúng page đó (tránh leak CSS giữa các pages).

## Scripts reference

| Script | Mục đích | Input | Output |
|--------|---------|-------|--------|
| `port-html-to-jsx.js` | Convert HTML/JSX skeleton → valid JSX | `page.sanitized.html` hoặc `*.tsx` skeleton | `PageFaithful.tsx` (hoặc component riêng) |
| `download-assets.js` | Tải ảnh/media remote về local | `page.sanitized.html` hoặc thư mục | `public/assets/{page}/<host>/<file>` + `{page}-assets-manifest.json` |
| `download-fonts.js` | Tải @font-face files | `extracted.css` | `public/assets/fonts/{page}/*.woff2` + `fonts.css` |
| `rewrite-asset-urls.js` | Replace remote URLs → local paths | Thư mục `.tsx`/`.css` + manifest | Files đã rewrite (in-place) |
| `inject-resolved-css.js` | Inject CSS gốc vào globals.css | `resolved.css` (optional: `extracted.css`) | `src/app/globals.css` (updated) |
| `batch-faithful.js` | Orchestrator — chạy 5 bước trên | `clone-output/pages/{page}` | Tất cả outputs ở trên |

## Caveats

1. **DOM fidelity**: 100% giữ nguyên DOM gốc, không thay đổi class, không thay đổi style. Chỉ convert syntax HTML → JSX.
2. **Tailwind**: Class Tailwind trong HTML gốc vẫn hoạt động nếu Next.js project dùng cùng Tailwind version. Custom utilities cần được port thủ công sang `tailwind.config.ts`.
3. **CSS variables**: `resolved.css` đã có variables resolve thành values, không cần `var(--foo)`. Nếu page gốc dùng CSS variables mới (vd `--color-primary`), chúng sẽ được inject nguyên văn.
4. **Specificity**: Vì CSS được scope bằng `:where()` (0 specificity), Tailwind utilities trong JSX sẽ override. Nếu muốn CSS gốc thắng, dùng `!` modifier (vd `bg-white!`) hoặc bỏ `:where()` wrap.
5. **Scripts/Animations**: `<script>` và `<style>` tags được giữ nguyên nội dung (qua `dangerouslySetInnerHTML`). Canvas/Framer animations cần `'use client'` directive (đã được port-html-to-jsx tự động thêm khi phát hiện `<canvas>`, `<script>`, hoặc dangerouslySetInnerHTML).
6. **External CDN assets**: URL ảnh, video, font từ CDN của site gốc (vd `rjdavx8ozyznxeyh.public.blob.vercel-storage.com`) sẽ được download về local. URL từ các domain khác (vd `unpkg.com`, `cdn.tailwindcss.com`) cũng sẽ được download — kiểm tra manifest để biết.
7. **Hot reload**: Khi sửa JSX sau khi đã rewrite URLs, chạy lại `rewrite-asset-urls.js` nếu URL mới xuất hiện.
