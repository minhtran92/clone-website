# clone-website — Roadmap cải thiện (từ rawline.framer.website)

Tài liệu tổng kết các fix đã áp dụng khi clone `rawline.framer.website`, và quy trình
rebuild (viết lại mã sạch) sau khi clone xong.

---

## PHẦN 1: Các fix đã áp dụng cho clone-website skill

### A. Fix OOM (dồn CSS 1 cục) — Option 1: per-component plain CSS

**Vấn đề cũ**: `inject-resolved-css.js` dump toàn bộ `resolved.css` (284KB) +
`extracted.css` (284KB, duplicate) của mỗi page vào 1 cục `globals.css` → vài MB
→ Turbopack/SWC OOM, HMR treo. Đồng thời `split-css-modules.js` viết `.module.css`
(hash tên) nhưng component vẫn dùng className literal → CSS Module import vô tác dụng.

**Fix**:
1. **`split-component-css.js`** (MỚI, thay `split-css-modules.js` + `inject-resolved-css.js`):
   - Tách CSS thành per-component `.css` THUẦN (literal selectors → fidelity 1:1,
     Framer animations tìm đúng class)
   - Chỉ đẩy phần GLOBAL thật (`:root`, `@font-face`, `@keyframes`, `html/body/*`
     reset, Framer layout-hints) vào `globals.css` (nhỏ, ~50KB)
   - Class-targeted rules không match → `shared.css`
2. **`port-html-to-jsx.js`**: đổi `import styles from './X.module.css'` → `import './X.css'`
   (plain side-effect, giữ className literal)
3. **`batch-faithful.js`**: gỡ bước 6 (`inject-resolved-css.js`), trỏ bước 5 sang
   `split-component-css.js`

### B. Fix wrapper structure (LCA — mỗi top-level component trong wrapper riêng)

**Vấn đề cũ**: `generate-page.js` render tất cả top-level components (Navbar, MainContent,
Footer) vào CHUNG 1 wrapper. Nhưng cấu trúc gốc có 3 wrapper SIBLING khác nhau:

```
div.framer-fXuuj (LCA — chung tổ tiên)
  ├─ div.framer-1oxjr89-container → <nav> (Navbar)
  ├─ div.framer-o7S0T (data-framer-root) → <main> (MainContent)
  └─ div.framer-1bu7syk-container → <footer> (Footer)
```

→ Navbar/Footer mất wrapper context → vỡ layout (Footer 600px thay vì 1440px,
nav lệch 300px).

**Fix**:
- **`split-components.js`**: capture `rootWrappers` (body→LCA) + `perComponentWrappers`
  (wrapper riêng mỗi top-level comp) bằng LCA algorithm (first index where all
  ancestor paths converge)
- **`generate-page.js`**: render `rootWrappers → [perComponentWrappers → <Comp/>]`

### C. Fix sanitizer bug (strip translateX layout centering)

**Vấn đề cũ**: `sanitize-html.js` N6 regex `/transform:\s*translate[XYZ]?\s*\([^)]*\)/`
strip MỌI translate — kể cả `translateX(-50%)` (dùng cho layout centering của nav
fixed). Mất translateX → nav lệch 300px.

**Fix**: regex chỉ strip `translateY` (scroll-reveal hidden state, vertical slide),
KHÔNG strip `translateX` (layout positioning). Và chỉ strip khi `opacity:0` (hidden
state), không strip khi `opacity:1` (already visible, transform là layout-critical).
Cùng fix áp dụng cho `port-html-to-jsx.js` styleToJsx().

### D. Fix SVG sprites (icons thiếu)

**Vấn đề cũ**: Framer inject `<svg id="svg-..." viewBox="...">` sprite definitions ở
CUỐI `<body>` (không thuộc `[data-component]` nào). Component HTML tham chiếu qua
`<use href="#svg-...">`. Khi port, `split-components.js` chỉ extract components →
sprites bị bỏ sót → icons (chevron, crown, logo) không render.

**Fix**:
- **`split-components.js`**: extract tất cả `<svg id="svg-...">` → `svg-sprites.html`
- **`generate-page.js`**: inject sprites vào page qua `<svg dangerouslySetInnerHTML>`

### E. Fix asset path doubling

**Vấn đề cũ**: `download-assets.js` `hashToPath()` trả về `assets/_hash/...` (relative
to public/, URL `/assets/_hash/...`) nhưng outDir đã là `public/assets` → physical
path double thành `public/assets/assets/_hash/...` (browser request `/assets/_hash/...`
→ 404).

**Fix**: strip tiền tố `assets/` khi join outDir.

### F. Fix component duplication (top-level vs nested)

**Vấn đề cũ**: `MainContent` (`<main>`) bao bọc Hero/About/Features... → render tất
cả 16 components = duplicate nội dung.

**Fix**: `split-components.js` ghi `component-order.json` (top-level vs nested, detect
bằng `[data-component]` ancestor). `generate-page.js` render chỉ top-level + import
CSS của nested (vì HTML của chúng nằm trong parent's dangerouslySetInnerHTML).

---

## PHẦN 2: Quy trình inject Framer runtime GỐC (animation thật)

**Vấn đề**: Framer runtime JS (413KB + 21+ chunks = 2.8MB) cần để chạy animation
gốc (scroll parallax, scale, translateY, variants). Không chạy runtime = không có
animation (FramerReveal tự chế là SAI — trang gốc không có fade-in).

**Cách lấy runtime gốc**:
1. Mở trang gốc bằng `agent-browser`, tìm `<script src="...script_main.*.mjs">`:
   ```
   https://framerusercontent.com/sites/{SITE_ID}/script_main.{HASH}.mjs
   ```
2. Download `script_main.mjs` + tất cả chunks (parse static imports `from"./X.mjs"`
   + dynamic imports `import("./X.mjs")`)
3. **QUAN TRỌNG**: download với cache-buster `?v=timestamp` + `Referer` header
   để tránh S3 cache cũ (Access Denied):
   ```bash
   curl -sL -H "Referer: https://rawline.framer.website/" \
     "https://framerusercontent.com/sites/{ID}/{chunk}.mjs?v=$(date +%s)" \
     -o "public/framer-runtime/{chunk}.mjs"
   ```
4. Verify mỗi file là JS hợp lệ (không phải XML Access Denied):
   ```bash
   head -c 5 file.mjs | grep -q '<?xml' && echo "BAD" || echo "OK"
   ```
5. Inject vào Next.js layout qua `<Script type="module">`:
   ```tsx
   <Script src="/framer-runtime/script_main.mjs" type="module"
           strategy="afterInteractive" />
   ```
6. Runtime tìm `document.getElementById('main')` (div có `data-framer-hydrate-v2`)
   → hydrate → chạy animation thật.

**Lưu ý quan trọng**:
- `div#main` phải có `data-framer-hydrate-v2` attribute (Framer runtime detect
  hydrate mode)
- DOM trong `div#main` phải gần giống gốc (để hydrate match) — clone mode-faithful
  đã đảm bảo điều này
- Runtime là React app riêng (import react riêng) → chạy độc lập trong div#main,
  KHÔNG conflict với Next.js React (scope khác)

---

## PHẦN 3: CÂU HỎI — Có thể rebuild (viết lại mã sạch) từ clone không?

**CÂU TRẢ LỜI: CÓ**, và đây chính là mục đích của **Phase 2 Mode Creative**
(có sẵn trong clone-website skill nhưng chưa dùng).

### Hai chế độ của clone-website

| | Mode Faithful (đã dùng) | Mode Creative (rebuild sạch) |
|---|---|---|
| Mục tiêu | Pixel-perfect 1:1 | Mã sạch, maintainable, Tailwind |
| DOM | Giữ nguyên 1:1 (dangerouslySetInnerHTML) | Refactor thành React components thật |
| CSS | Per-component plain .css (literal selectors) | Tailwind v4 + shadcn/ui |
| Animation | Inject runtime gốc (2.8MB) | Framer Motion code sạch (useScroll/useTransform) |
| Fidelity | 100% (vì là DOM gốc) | ~90-95% (AI refine) |
| Maintainable | Thấp (code minified, không customize) | Cao (code sạch, dễ edit) |

### Quy trình rebuild (Mode Creative)

clone-website skill đã có sẵn pipeline Mode Creative (`scripts/phase2-creative/`):

1. **Phase 1 (CLONE)** — đã làm xong: crawl + fetch + resolve + annotate + split
   → `clone-output/` (HTML, CSS, design tokens, components-raw)

2. **Phase 2 Mode Creative** — dùng `clone-output/` làm INPUT:
   - `generate-tokens.cjs`: extract design tokens (colors, fonts, spacing) →
     `design-tokens.json` (đã có từ Phase 1)
   - `extract-colors.cjs`: parse CSS → color palette
   - `tailwind_config_gen.py`: sinh `tailwind.config.ts` từ tokens
   - `shadcn_add.py`: add shadcn/ui components cần thiết
   - `consolidate-components.js`: gộp Header/Footer chung các page
   - `refine-component.js`: **AI refine** — chuyển component skeleton (HTML blob)
     sang Tailwind + React sạch, dùng design tokens + ui-ux-pro-max knowledge
   - `generate-routes.js`: tạo Next.js App Router routes

3. **Kết quả rebuild**:
   ```
   app-output/
   ├── app/
   │   ├── layout.tsx          ← sạch, Tailwind
   │   ├── page.tsx            ← React tree thật (không dangerouslySetInnerHTML)
   │   └── globals.css         ← Tailwind directives + tokens
   ├── components/
   │   ├── shared/             ← Header, Footer, Navbar (AI refined, Tailwind)
   │   └── pages/home/         ← Hero, Features, etc. (Tailwind + shadcn/ui)
   ├── design-tokens.json
   └── tailwind.config.ts
   ```

### Trade-off khi rebuild

**Ưu điểm**:
- Mã sạch, dễ maintain và customize
- Bundle nhỏ hơn (không cần 2.8MB runtime)
- Dùng được Tailwind v4 + shadcn/ui
- Animation thành Framer Motion code sạch (useScroll/useTransform) thay vì runtime
  minified
- Có thể edit từng component dễ dàng

**Nhược điểm**:
- Fidelity giảm ~5-10% (AI refine không hoàn hảo 100%)
- Cần AI (LLM) để refine từng component — tốn thời gian + token
- Animation phức tạp (parallax đa lớp) khó tái tạo chính xác 100%
- Cần verify lại bằng VLM sau rebuild

### Khuyến nghị quy trình

1. **Bước 1 — Clone (Mode Faithful)**: đã xong. DOM 1:1, animation gốc chạy,
   fidelity 9-10/10. **Dùng làm baseline/QA reference.**

2. **Bước 2 — Rebuild (Mode Creative)**: chạy pipeline Phase 2 Creative trên
   `clone-output/`. AI refine từng component sang Tailwind sạch.

3. **Bước 3 — Verify**: VLM compare rebuild vs Mode Faithful clone (chứa gốc).
   Target fidelity rebuild ≥ 8/10. Nếu thấp, refine lại component cụ thể.

4. **Bước 4 — Enhance**: thêm logic riêng (e-commerce, auth, API) vào mã sạch.

### Khi nào dùng cái nào?

| Tình huống | Dùng |
|------------|------|
| Cần pixel-perfect 1:1, không customize | Mode Faithful (đã xong) |
| Cần mã sạch để develop tiếp, customize, add features | Rebuild Mode Creative |
| Cần nhanh, demo, prototype | Mode Faithful |
| Production app dài hạn | Rebuild Mode Creative |

---

## TÓM TẮT

**Clone thật sự (Mode Faithful)** đã hoạt động sau 6 fix:
1. OOM → per-component plain CSS
2. Wrapper structure → LCA + perComponentWrappers
3. Sanitizer bug → chỉ strip translateY
4. SVG sprites → extract + inject
5. Asset path doubling → strip prefix
6. Component duplication → top-level vs nested

**Animation gốc**: inject Framer runtime thật (2.8MB, 45 chunks) — cache-buster
+ Referer để tránh S3 Access Denied.

**Rebuild mã sạch**: DÙNG Mode Creative (đã có sẵn trong skill). Input = clone-output
(đã có). AI refine → Tailwind + shadcn/ui + Framer Motion code sạch. Fidelity ~90-95%.
Trade-off: mất 1:1 nhưng được mã maintainable.
