# Mode Faithful — Pixel-Perfect Port Guide

> "Lấy HTML + CSS + JS gốc, chuyển nguyên xi sang React/Next.js — không tái sáng tác."

## Khi nào dùng Mode Faithful

| Tình huống | Dùng |
|------------|------|
| User yêu cầu "clone y bản gốc" / "pixel-perfect" / "1:1" | ✅ Mode Faithful |
| Cần giữ nguyên mọi animation, effect, hover state | ✅ Mode Faithful |
| Trang gốc có Canvas/WebGL/Framer phức tạp | ✅ Mode Faithful (giữ script) |
| Branding yêu cầu font thương hiệu riêng (vd Durable's newSpiritCondensed) | ✅ Mode Faithful (download font thật) |
| Cần build nhanh, không cần tinh chỉnh thẩm mỹ | ✅ Mode Faithful |
| Cần code "đẹp", maintainable, dùng shadcn/Tailwind idioms | ❌ → Mode Creative |

## Mục tiêu fidelity

- **DOM 1:1**: không thêm, không bớt element, không thay đổi class, không thay đổi style
- **Assets thật**: ảnh, video, font từ CDN gốc được download về local
- **CSS thật**: `resolved.css` + `extracted.css` được inject vào globals.css, scope bằng `:where([data-page="..."])`
- **Effects giữ nguyên**: `<script>` tags, `<canvas>`, Framer Motion effects được giữ nguyên (qua `dangerouslySetInnerHTML`)

## Pipeline tổng quan

```
clone-output/pages/{page}/
  ├── html-annotated/page.sanitized.html       ← HTML gốc đã sanitize
  ├── components-raw/*.tsx                       ← Component skeletons (đã split)
  ├── html-raw/resolved.css                     ← CSS variables đã resolve thành values
  ├── html-raw/extracted.css                    ← Toàn bộ <style> từ page gốc
  └── html-raw/design-tokens.json              ← Tokens (tham khảo)
                    │
                    ▼
         ┌────────────────────────┐
         │ 1. port-html-to-jsx    │  →  src/components/pages/{page}/*.tsx
         │ 2. download-assets     │  →  public/assets/{page}/<host>/*.jpg
         │ 3. download-fonts      │  →  public/assets/fonts/{page}/*.woff2
         │ 4. rewrite-asset-urls   │  →  JSX files updated in-place
         │ 5. inject-resolved-css │  →  src/app/globals.css (with scoped block)
         └────────────────────────┘
                    │
                    ▼
         src/app/{page}/page.tsx  (wires it up)
         with <main data-page="{page}"> wrapper
```

## Quick commands

```bash
# Run all 5 steps for one page
node skills/clone-website/scripts/phase2-faithful/batch-faithful.js \
  clone-output/pages/home --src src --public public --page home

# Or run all pages
node skills/clone-website/scripts/phase2-faithful/batch-faithful.js \
  clone-output/pages --src src --public public --all
```

## Wiring it into Next.js

Sau khi batch chạy xong, tạo `src/app/{page}/page.tsx`:

```tsx
// src/app/home/page.tsx
import PageFaithful from '@/components/pages/home/PageFaithful';

export const metadata = {
  title: 'Home — Faithful Clone',
  description: 'Pixel-perfect clone of home page',
};

export default function Page() {
  return (
    <main data-page="home">
      <PageFaithful />
    </main>
  );
}
```

Lưu ý `data-page="home"` — attribute này để `:where([data-page="home"])` selector trong globals.css chỉ apply cho đúng page đó (tránh leak CSS).

## Specificity model

Mode Faithful dùng `:where([data-page="..."])` scope (0 specificity) để:
1. CSS gốc áp dụng cho đúng page (không leak sang pages khác)
2. Tailwind utilities trong JSX sẽ override CSS gốc (vì `:where()` có 0 specificity, Tailwind utilities có 1+ specificity)
3. Khi muốn CSS gốc thắng, dùng `!` modifier (Tailwind v4 syntax): `bg-white!`, `text-black!`

## Trade-offs (be honest)

| Ưu điểm | Nhược điểm |
|---------|------------|
| DOM 1:1, fidelity cao | Code không "đẹp" như mode-creative (vẫn có `dangerouslySetInnerHTML` cho script/style) |
| Assets thật, không placeholder | Cần download (network + storage) |
| Effects giữ nguyên 100% | Tailwind utilities trong source HTML có thể không match Tailwind v4 config (cần config lại) |
| Nhanh (chỉ cần chạy scripts) | Không tận dụng được shadcn/ui components (raw HTML elements) |
| CSS variables được resolve | Inline styles còn nhiều (`style="..."`) |
| Accessibility tốt nếu gốc tốt | Không cải thiện accessibility so với gốc |

## Common pitfalls

### 1. Tailwind classes không match
Page gốc dùng Tailwind v3 hoặc custom utilities. Khi port sang Next.js với Tailwind v4, một số class có thể không tồn tại.

**Fix**: 
- Add custom utilities vào `tailwind.config.ts` 
- Hoặc chuyển sang mode-creative để convert sang Tailwind v4 idioms

### 2. CSS specificity war
`resolved.css` inject có thể conflict với Tailwind utilities.

**Fix**: 
- Mặc định `:where([data-page="..."])` scope đã đảm bảo Tailwind utilities thắng
- Nếu CSS gốc thắng khi không mong muốn, dùng `!` modifier: `bg-white!`, `text-primary!`

### 3. Remote CDN assets fail to download
Một số CDN có CORS/anti-bot blocking.

**Fix**:
- Check `clone-output/pages/{page}/assets-manifest.json` → list failures
- Download thủ công các failed URLs → đặt vào `public/assets/{page}/<host>/`
- Update manifest file nếu cần

### 4. @font-face URLs relative
Phase 1 có thể không capture full URL của fonts (chỉ relative path).

**Fix**:
- Inspect `extracted.css` thủ công → tìm `@font-face { src: url(/fonts/foo.woff2) }`
- Resolve URL với origin của site gốc (vd `https://durable.com/fonts/foo.woff2`)
- Chạy `download-fonts.js` với URL đã resolve

### 5. Canvas/WebGL animations không chạy
`<canvas>` cần script chạy sau khi DOM ready.

**Fix**:
- Đảm bảo `'use client'` directive được thêm (port-html-to-jsx tự động detect)
- Script trong `dangerouslySetInnerHTML` sẽ chạy khi component mount (vì React inject script trực tiếp)
- Nếu script không chạy, thử chuyển sang `useEffect` thủ công:
  ```tsx
  useEffect(() => {
    const script = document.createElement('script');
    script.textContent = canvasAnimationCode;
    document.body.appendChild(script);
    return () => script.remove();
  }, []);
  ```

## Verification checklist

Sau khi batch chạy xong:

- [ ] `src/components/pages/{page}/PageFaithful.tsx` tồn tại và import được (no syntax errors)
- [ ] `public/assets/{page}/` có ảnh đã download (count > 0)
- [ ] `public/assets/fonts/{page}/fonts.css` tồn tại (nếu page gốc có @font-face)
- [ ] `src/app/globals.css` có block `/* === CLONE-WEBSITE MODE-FAITHFUL [{page}] START === */` đến `END`
- [ ] `src/app/{page}/page.tsx` import `PageFaithful` + có `data-page="{page}"` attribute
- [ ] Dev server chạy không lỗi
- [ ] Browser screenshot vs original screenshot: similarity ≥ 8/10

## Tooling references

- `port-html-to-jsx.js` — Convert HTML → JSX (cheerio-based, handles all edge cases)
- `download-assets.js` — Concurrent HTTP downloads (8 default), manifest output
- `download-fonts.js` — @font-face parser + woff2/woff/ttf downloader + CSS regenerator
- `rewrite-asset-urls.js` — URL rewriter (uses download-assets manifest)
- `inject-resolved-css.js` — CSS injector with `:where([data-page])` scope
- `batch-faithful.js` — Orchestrator for all 5 steps

All scripts có `--help` (or no-args) để xem usage.
