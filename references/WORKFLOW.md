# Clone Website — Workflow Documentation

## Tổng quan

Skill **clone-website** sử dụng **hybrid pipeline** (CLI Tool + AI Brain) để sao chép giao diện website sang dự án Next.js App Router.

### Tại sao Hybrid tốt hơn Pure AI?

| Vấn đề | Pure AI | Hybrid (Skill này) |
|---------|---------|---------------------|
| Cấu trúc component | AI đoán layout → code lộn xộn | `html-to-react-components` tạo DOM chính xác 100% |
| CSS accuracy | Xấp xỉ, không chính xác | Extract computed styles → map Tailwind chính xác |
| State/logic | Thường sai hoặc thiếu | AI xử lý logic SAU KHI structure đã đúng |
| Fidelity | "Tạm ổn" | Skeleton chính xác + AI refinement = production-ready |

## Pipeline 5 Bước

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLONE WEBSITE PIPELINE                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Step 1: FETCH ─────── z-ai page_reader ──→ HTML + CSS + assets    │
│    │                                                                │
│    ▼                                                                │
│  Step 2: ANNOTATE ──── LLM + cheerio ────→ data-component attrs    │
│    │                                                                │
│    ▼                                                                │
│  Step 3: SPLIT ─────── html2react CLI ────→ .tsx skeleton files    │
│    │                                           (DETERMINISTIC)     │
│    ▼                                                                │
│  Step 4: REFINE ────── LLM (glm-4) ──────→ Tailwind + Next.js     │
│    │                                           (AI BRAIN)          │
│    ▼                                                                │
│  Step 5: VERIFY ────── VLM comparison ───→ Visual QA + fixes      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Bước 1: Fetch & Extract

**Công cụ:** `agent-browser` (primary) / `z-ai page_reader` (fallback)
**Loại:** Deterministic

### Tại sao phải dùng agent-browser?

`page_reader` chỉ lấy **article content** — bỏ qua `<script>`, `<style>`, external CSS, JS bundles. Với Framer/Webflow, phần lớn styling nằm trong các element bị bỏ qua này. `agent-browser` lấy **toàn bộ rendered HTML** + computed styles + CSS variables.

| Cần gì | page_reader | agent-browser |
|--------|-------------|---------------|
| Full HTML source | ❌ Chỉ article | ✅ Đầy đủ `<script>`, `<style>` |
| Computed styles | ❌ | ✅ `getComputedStyle()` |
| CSS variables | ❌ | ✅ Từ `document.styleSheets` |
| Inline CSS text | ❌ Bị strip | ✅ Nội dung `<style>` tags |
| Screenshots | ❌ | ✅ Desktop + mobile |
| Images | ❌ Một phần | ✅ Tất cả `<img>` + bg images |

### Cách thực hiện

```bash
node skills/clone-website/scripts/fetch-page.js "https://target-website.com" clone-output/html-raw
```

Script tự động:
1. Mở page trong browser (agent-browser)
2. Extract full HTML source (có `<script>`, `<style>`, tất cả attributes)
3. Extract computed styles: colors, fonts, font sizes, spacing, border-radius, shadows
4. Extract CSS variables từ `document.styleSheets`
5. Extract tất cả `<style>` tag CSS text
6. Extract tất cả `<img>` sources
7. Chụp desktop (1440px) + mobile (390px) screenshots

### Output
- `clone-output/html-raw/page.html` — Raw HTML
- `clone-output/html-raw/meta.json` — Page metadata
- `clone-output/qa/screenshot-original.png` — Reference screenshot

---

## Bước 2: AI Annotate

**Công cụ:** LLM (z-ai) + cheerio (Node.js parser)
**Loại:** AI-assisted

### Cách thực hiện

1. Chạy script annotation (cheerio pattern detection):
```bash
node skills/clone-website/scripts/annotate-html.js \
  clone-output/html-raw/page.html \
  clone-output/html-annotated/page.annotated.html
```

Script tự động phát hiện và gán `data-component="..."` cho:
- `<header>` → `data-component="Navbar"`
- `[class*="hero"]` → `data-component="HeroSection"`
- `[class*="feature"]` → `data-component="FeaturesGrid"`
- `<footer>` → `data-component="Footer"`
- ...và nhiều pattern khác

2. Nếu phát hiện < 3 components, dùng LLM để phân tích sâu hơn:
```bash
z-ai chat -m glm-4-flash -p "Phân tích HTML này và trả về JSON array các section..."
```

3. Extract styles:
```bash
node skills/clone-website/scripts/extract-styles.js \
  clone-output/html-raw/page.html \
  clone-output/html-raw/design-tokens.json
```

### Output
- `clone-output/html-annotated/page.annotated.html` — Annotated HTML
- `clone-output/html-raw/design-tokens.json` — Design tokens

---

## Bước 3: Split Components (DETERMINISTIC)

**Công cụ:** `split-components.js` (cheerio) + `sanitize-html.js`
**Loại:** Deterministic — KHÔNG dùng AI
**Fallback:** `html2react` CLI cho HTML đơn giản

### Tại sao dùng cheerio thay vì html2react CLI?

`html-to-react-components` dùng babylon parser cũ — **crash trên HTML hiện đại** (Framer, Webflow có inline JS/CSS phức tạp). Cheerio splitter tự viết xử lý được mọi valid HTML.

### Cách thực hiện

1. **Sanitize** HTML (remove scripts, inline JS, complex attributes):
```bash
node skills/clone-website/scripts/sanitize-html.js \
  clone-output/html-annotated/page.annotated.html \
  clone-output/html-annotated/page.sanitized.html
```

2. **Split** theo `data-component` attributes:
```bash
node skills/clone-website/scripts/split-components.js \
  clone-output/html-annotated/page.sanitized.html \
  clone-output/components-raw
```

**Đây là bước quan trọng nhất** — cấu trúc DOM được tạo chính xác 100% từ HTML gốc, không có AI đoán.

### Output
- `clone-output/components-raw/Navbar.tsx`
- `clone-output/components-raw/HeroSection.tsx`
- `clone-output/components-raw/FeaturesGrid.tsx`
- `clone-output/components-raw/Footer.tsx`
- `clone-output/components-raw/Page.tsx`
- ...etc

---

## Bước 4: AI Refine (AI BRAIN)

**Công cụ:** LLM (z-ai, glm-4-flash)
**Loại:** AI — bước "thông minh"

### Cách thực hiện

Cho mỗi component skeleton từ Bước 3, dùng LLM để refine:

1. Đọc template prompt:
```bash
cat skills/clone-website/templates/refine-prompt.txt
```

2. Gửi skeleton + prompt cho LLM:
```bash
z-ai chat -m glm-4-flash -p "$(cat skills/clone-website/templates/refine-prompt.txt)

Component skeleton:
$(cat clone-output/components-raw/HeroSection.tsx)

Design tokens:
$(cat clone-output/html-raw/design-tokens.json)"
```

3. LLM sẽ:
   - Convert CSS → Tailwind utility classes
   - Add `'use client'` nếu cần
   - Add React state (useState) cho interactive elements
   - Add responsive classes (sm:, md:, lg:)
   - Remove `dangerouslySetInnerHTML`
   - Add TypeScript types

4. Lưu refined code → `clone-output/components/HeroSection.tsx`

5. Tạo `layout.tsx` và `page.tsx` cho Next.js App Router

### Output
- `clone-output/components/*.tsx` — Refined components
- `clone-output/src/app/layout.tsx` — Root layout
- `clone-output/src/app/page.tsx` — Main page
- `clone-output/src/app/globals.css` — Global CSS

---

## Bước 5: Visual QA

**Công cụ:** VLM (z-ai) + agent-browser
**Loại:** AI verification

### Cách thực hiện

1. Deploy clone locally và chụp screenshot:
```bash
agent-browser navigate --url "http://localhost:3000"
agent-browser screenshot --full-page --output clone-output/qa/screenshot-clone.png
```

2. So sánh bằng VLM:
```bash
z-ai vision -p "So sánh 2 screenshots. FIRST = gốc, SECOND = clone. Liệt kê TẤT Cả khác biệt. Đánh giá fidelity 1-10." \
  -i clone-output/qa/screenshot-original.png \
  -i clone-output/qa/screenshot-clone.png
```

3. Fix discrepancies → quay lại Bước 4 cho affected components

### Output
- `clone-output/qa/screenshot-clone.png`
- `clone-output/qa/qa-report.md`
- Fidelity score ≥ 8/10

---

## Cấu trúc Output

```
clone-output/
├── html-raw/                    # Bước 1: Raw HTML
│   ├── page.html
│   ├── page-data.json
│   ├── meta.json
│   └── design-tokens.json
├── html-annotated/              # Bước 2: Annotated HTML
│   └── page.annotated.html
├── components-raw/              # Bước 3: Skeleton components (CLI output)
│   ├── Navbar.tsx
│   ├── HeroSection.tsx
│   ├── FeaturesGrid.tsx
│   └── Footer.tsx
├── components/                  # Bước 4: Refined components (AI output)
│   ├── Navbar.tsx
│   ├── HeroSection.tsx
│   ├── FeaturesGrid.tsx
│   └── Footer.tsx
├── src/                         # Final Next.js structure
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── globals.css
│   └── components/              # Copy từ components/
├── public/
│   └── assets/                  # Downloaded images, fonts, SVGs
├── qa/                          # Bước 5: QA output
│   ├── screenshot-original.png
│   ├── screenshot-clone.png
│   └── qa-report.md
└── CLONE_META.json             # Clone job metadata
```

---

## Troubleshooting

| Vấn đề | Giải pháp |
|---------|-----------|
| page_reader trả về empty HTML | URL có thể cần JS rendering — dùng agent-browser thay thế |
| html2react không tạo components | HTML thiếu data-component attrs — chạy lại Bước 2 |
| LLM refine trả về code lỗi | Giảm component complexity, split thành nhỏ hơn |
| Visual QA score < 8 | Check QA report, fix specific components ở Bước 4 |
| Thiếu assets/images | Download thủ công bằng agent-browser + curl |

---

## Quick Start

```bash
# 1. Fetch (agent-browser = full HTML + CSS + styles)
node skills/clone-website/scripts/fetch-page.js "https://target.com" clone-output/html-raw

# 2. Annotate
node skills/clone-website/scripts/annotate-html.js clone-output/html-raw/page.html clone-output/html-annotated/page.annotated.html

# 3a. Sanitize
node skills/clone-website/scripts/sanitize-html.js clone-output/html-annotated/page.annotated.html clone-output/html-annotated/page.sanitized.html

# 3b. Split
node skills/clone-website/scripts/split-components.js clone-output/html-annotated/page.sanitized.html clone-output/components-raw

# 4. Refine (AI — interactive)
# 5. Verify (VLM — interactive)
```
