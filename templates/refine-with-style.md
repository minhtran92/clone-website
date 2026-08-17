# Refine-with-Style — Clone-website Phase 2 Mode-Creative

> **Prompt template** for AI to refactor a cloned component skeleton into a beautiful Next.js + Tailwind v4 + shadcn/ui component, using the **exact design tokens extracted from the source site** + **ui-ux-pro-max aesthetic knowledge**.

## INPUT

- **Component skeleton**: `clone-output/pages/{page}/components-raw/{Name}.tsx` (HTML+CSS đã extract từ clone Phase 1, contained trong `dangerouslySetInnerHTML`)
- **Design tokens**: `clone-output/pages/{page}/html-raw/design-tokens.json` (Phase 1 output: colors hex/oklch, font families, spacing, radius, shadows, computed styles)
- **Resolved CSS**: `clone-output/pages/{page}/html-raw/resolved.css` (CSS variables đã resolve thành values — dùng để tham khảo giá trị chính xác)
- **Extracted CSS**: `clone-output/pages/{page}/html-raw/extracted.css` (toàn bộ `<style>` từ page gốc — dùng để tham khảo class thực tế)
- **Screenshot**: `clone-output/pages/{page}/qa/screenshot-original-desktop.png` và `screenshot-original-mobile.png`
- **Master design system** (optional but recommended): `design-system/{project-slug}/MASTER.md` (đã generate bằng `search.py --design-system --persist`)

## GOAL

Refactor component skeleton thành Next.js App Router component **đẹp, production-ready**, dùng:
- **Tailwind v4 utilities** (mobile-first, semantic tokens)
- **shadcn/ui** primitives (Radix-based, ARIA built-in)
- **Exact design tokens** từ Phase 1 (không tự chế)
- **TypeScript** types đầy đủ

Mục tiêu: **giữ fidelity với screenshot gốc** (cùng text, cùng bố cục, cùng màu) NHƯNG code sạch, đẹp, maintainable hơn gốc.

## PIPELINE

### Step 1 — Load context

Đọc các file sau (đường dẫn tương đối so với project root):

| File | Mục đích |
|------|---------|
| `clone-output/pages/{page}/components-raw/{Name}.tsx` | Lấy text content verbatim (giữ nguyên copy, prices, names) |
| `clone-output/pages/{page}/html-raw/design-tokens.json` | Lấy primitive values (colors hex, font families) |
| `clone-output/pages/{page}/html-raw/resolved.css` | Lấy CSS variables đã resolve |
| `clone-output/pages/{page}/html-raw/extracted.css` | Tham khảo class thực tế gốc dùng |
| `design-system/{project-slug}/MASTER.md` (nếu có) | Style decisions: pattern, palette, typography, motion tier, density |
| `skills/clone-website/references/ui-ux-pro-max/quick-reference.md` | 10-category UX rule set |
| `skills/clone-website/references/ui-ux-pro-max/pro-rules.md` | Pre-delivery checklist |
| `skills/clone-website/references/ui-styling/shadcn-components.md` | shadcn catalog (Button, Input, Card, etc.) |
| `skills/clone-website/references/ui-styling/shadcn-theming.md` | Dark mode + CSS variables |
| `skills/clone-website/references/design-system/token-architecture.md` | 3-layer token pipeline |
| `skills/clone-website/references/design-system/tailwind-integration.md` | HSL format, @theme inline |
| `skills/clone-website/data/ui-ux-pro-max/stacks/nextjs.csv` | Next.js 16.2 conventions |
| `skills/clone-website/data/ui-ux-pro-max/stacks/shadcn.csv` | shadcn CLI v4 conventions |
| `skills/clone-website/data/ui-ux-pro-max/stacks/html-tailwind.csv` | Tailwind v4.3 conventions |

VLM-analyze screenshot để capture:
- Visual hierarchy (heading hierarchy, focal points)
- Spacing rhythm (density, whitespace)
- Color usage (primary/surface/text)
- Motion hints (animations, transitions, scroll reveals)
- Anti-patterns to avoid (overflow, cramped, low contrast)

### Step 2 — Map tokens (3-layer W3C DTCG)

Build/tokens.json theo 3-layer structure (primitive → semantic → component):

```json
{
  "primitive": {
    "color": {
      "brand": { "50": "#E6F7F1", "100": "#CCEEE3", "200": "#99DDC7", "300": "#66CBAB", "400": "#33BA8F", "500": "#00B67A", "600": "#009E68", "700": "#007555", "800": "#004D38", "900": "#002C20" },
      "neutral": { "50": "...", "100": "...", "200": "...", "300": "...", "400": "...", "500": "...", "600": "...", "700": "...", "800": "...", "900": "...", "950": "..." }
    },
    "spacing": { "0": "0", "1": "0.25rem", "2": "0.5rem", "3": "0.75rem", "4": "1rem", "6": "1.5rem", "8": "2rem", "12": "3rem", "16": "4rem", "20": "5rem", "24": "6rem" },
    "fontSize": { "xs": "0.75rem", "sm": "0.875rem", "base": "1rem", "lg": "1.125rem", "xl": "1.25rem", "2xl": "1.5rem", "3xl": "1.875rem", "4xl": "2.25rem", "5xl": "3rem", "6xl": "3.75rem" },
    "radius": { "sm": "0.375rem", "md": "0.5rem", "lg": "0.75rem", "xl": "1rem", "2xl": "1.5rem", "3xl": "2rem" },
    "shadow": { "sm": "...", "md": "...", "lg": "...", "xl": "..." },
    "duration": { "fast": "150ms", "normal": "200ms", "slow": "300ms", "slower": "500ms" }
  },
  "semantic": {
    "color": {
      "background": "{primitive.color.neutral.50}",
      "foreground": "{primitive.color.neutral.900}",
      "card": "{primitive.color.neutral.0}",
      "card-foreground": "{primitive.color.neutral.900}",
      "popover": "{primitive.color.neutral.0}",
      "popover-foreground": "{primitive.color.neutral.900}",
      "primary": "{primitive.color.brand.500}",
      "primary-hover": "{primitive.color.brand.600}",
      "primary-active": "{primitive.color.brand.700}",
      "primary-foreground": "{primitive.color.neutral.0}",
      "secondary": "{primitive.color.neutral.100}",
      "secondary-foreground": "{primitive.color.neutral.900}",
      "muted": "{primitive.color.neutral.100}",
      "muted-foreground": "{primitive.color.neutral.500}",
      "accent": "{primitive.color.neutral.100}",
      "accent-foreground": "{primitive.color.neutral.900}",
      "destructive": "#EF4444",
      "destructive-foreground": "{primitive.color.neutral.0}",
      "border": "{primitive.color.neutral.200}",
      "input": "{primitive.color.neutral.200}",
      "ring": "{primitive.color.brand.500}"
    }
  },
  "component": {
    "button": {
      "bg": "{semantic.color.primary}",
      "bg-hover": "{semantic.color.primary-hover}",
      "bg-active": "{semantic.color.primary-active}",
      "fg": "{semantic.color.primary-foreground}",
      "padding-x": "{primitive.spacing.4}",
      "padding-y": "{primitive.spacing.2}",
      "radius": "{primitive.radius.md}",
      "font-size": "{primitive.fontSize.base}",
      "font-weight": "500"
    }
  },
  "dark": {
    "semantic": {
      "color": {
        "background": "{primitive.color.neutral.950}",
        "foreground": "{primitive.color.neutral.50}",
        "card": "{primitive.color.neutral.900}",
        "card-foreground": "{primitive.color.neutral.50}",
        "muted": "{primitive.color.neutral.800}",
        "muted-foreground": "{primitive.color.neutral.400}",
        "border": "{primitive.color.neutral.800}",
        "input": "{primitive.color.neutral.800}"
      }
    }
  }
}
```

Generate CSS + Tailwind config:
```bash
# Output CSS variables (global + dark scope)
node skills/clone-website/scripts/phase2-creative/generate-tokens.cjs \
  --config tokens.json -o src/app/design-tokens.css

# Output Tailwind color config
node skills/clone-website/scripts/phase2-creative/generate-tokens.cjs \
  --config tokens.json -f tailwind > tailwind-colors.js
```

Map vào `src/app/globals.css` (shadcn CLI v4 convention):
```css
@import "tailwindcss";

@theme inline {
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --radius-lg: var(--radius);
  --radius-md: calc(var(--radius) - 2px);
  --radius-sm: calc(var(--radius) - 4px);
  --font-sans: var(--font-geist-sans);
  --font-serif: var(--font-fraunces);
}

:root {
  /* HSL space-separated (cho opacity modifier bg-primary/50) */
  --background: 0 0% 100%;
  --foreground: 222 47% 11%;
  --primary: 162 100% 35%;  /* #00B67A → HSL */
  --primary-foreground: 0 0% 100%;
  --secondary: 210 40% 96%;
  --secondary-foreground: 222 47% 11%;
  --muted: 210 40% 96%;
  --muted-foreground: 215 16% 47%;
  --accent: 210 40% 96%;
  --accent-foreground: 222 47% 11%;
  --destructive: 0 84% 60%;
  --destructive-foreground: 0 0% 100%;
  --border: 214 32% 91%;
  --input: 214 32% 91%;
  --ring: 162 100% 35%;
  --radius: 0.75rem;
}

.dark {
  --background: 222 47% 4%;
  --foreground: 210 40% 98%;
  --primary: 162 100% 35%;
  --primary-foreground: 0 0% 100%;
  --secondary: 217 33% 17%;
  --secondary-foreground: 210 40% 98%;
  --muted: 217 33% 17%;
  --muted-foreground: 215 20% 65%;
  --accent: 217 33% 17%;
  --accent-foreground: 210 40% 98%;
  --destructive: 0 62% 30%;
  --destructive-foreground: 0 0% 100%;
  --border: 217 33% 17%;
  --input: 217 33% 17%;
  --ring: 162 100% 35%;
}
```

**Validate** không có hardcoded values:
```bash
node skills/clone-website/scripts/phase2-creative/validate-tokens.cjs --dir src/
```

### Step 3 — Refactor component skeleton

#### Rules (MUST follow)

**Server Component by default**:
- Không thêm `'use client'` trừ khi component có `useState`/`useEffect`/`onClick`/event handlers.
- Push client logic xuống leaf components (wrap interactive parts, không mark cả page).
- Page = Server Component. Section = Server Component. Interactive widget (form, modal, tabs) = Client Component.

**Replace raw HTML elements → shadcn primitives**:

| Raw HTML | Replace with |
|----------|--------------|
| `<button>` | `<Button variant="default">` (default/secondary/destructive/outline/ghost/link + size sm/default/lg/icon) |
| `<input type="text">` | `<Input />` |
| `<input type="email">` | `<Input type="email" />` |
| `<input type="checkbox">` | `<Checkbox />` (with `<Label htmlFor>`) |
| `<input type="radio">` | `<RadioGroup><RadioGroupItem value="..." /></RadioGroup>` |
| `<input type="password">` | `<Input type="password" />` |
| `<textarea>` | `<Textarea />` |
| `<select>` | `<Select><SelectTrigger><SelectValue /><SelectContent><SelectItem value="...">...</SelectItem></SelectContent></Select>` |
| `<form>` | `<Form>` (RHF + Zod) or plain `<form>` with `onSubmit` |
| `<label>` | `<Label htmlFor="..." />` |
| `<dialog>` / modal | `<Dialog>` (modal), `<Sheet side="...">` (side panels), `<AlertDialog>` (destructive confirm), `<Drawer>` (mobile) |
| Custom accordion | `<Accordion type="single" collapsible><AccordionItem><AccordionTrigger /><AccordionContent /></AccordionItem></Accordion>` |
| Custom tabs | `<Tabs defaultValue="..."><TabsList><TabsTrigger value="...">...</TabsTrigger></TabsList><TabsContent value="...">...</TabsContent></Tabs>` |
| Toast notifications | `sonner` (`toast.success(...)`, `toast.error(...)`, `<Toaster />` in layout) |
| Custom dropdown | `<DropdownMenu><DropdownMenuTrigger /><DropdownMenuContent><DropdownMenuItem>...</DropdownMenuItem></DropdownMenuContent></DropdownMenu>` |
| Custom tooltip | `<TooltipProvider><Tooltip><TooltipTrigger /><TooltipContent /></Tooltip></TooltipProvider>` (provider at app level) |
| Custom popover | `<Popover><PopoverTrigger /><PopoverContent align="..." side="...">...</PopoverContent></Popover>` |
| Command palette | `<Command><CommandInput /><CommandList><CommandGroup>...</CommandGroup></CommandList></Command>` |
| Custom menu (Radix NavigationMenu) | `<NavigationMenu><NavigationMenuList><NavigationMenuItem><NavigationMenuTrigger /><NavigationMenuContent /></NavigationMenuItem></NavigationMenuList></NavigationMenu>` |
| Data tables | TanStack Table + shadcn `<Table>` wrappers |
| Loading skeleton | `<Skeleton className="h-4 w-[200px]" />` |
| Progress bar | `<Progress value={60} />` |
| Avatar | `<Avatar><AvatarImage src="..." /><AvatarFallback>JD</AvatarFallback></Avatar>` |
| Badge / pill | `<Badge variant="default">New</Badge>` (default/secondary/destructive/outline) |
| Alert | `<Alert variant="default">` (default/destructive) |

**Semantic HTML**:
- `<section aria-label="...">` cho mỗi section
- `<article>` cho card/post/story
- `<h1>` → `<h2>` → `<h3>` sequential (không skip levels)
- `<nav aria-label="Main">` cho primary nav
- `<main id="main-content">` cho main content
- `<footer>` cho footer
- `<header>` cho header
- `<form>` với `<fieldset>` + `<legend>` cho grouped fields

**Layout conventions**:
- Container: `mx-auto max-w-7xl px-4 sm:px-6 lg:px-8` (marketing), `max-w-5xl` (article), `max-w-3xl` (long-form), `max-w-2xl` (form)
- Section padding: `py-20 md:py-28` (marketing), `py-8 md:py-12` (app/dashboard)
- Grid: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6` (mobile-first)
- Stack: `flex flex-col gap-6` or `space-y-6`
- Aspect ratio: `aspect-video`, `aspect-square` (no layout shift)

**Typography**:
- `font-serif` cho h1/h2 (hero headlines, section titles)
- `font-sans` cho body, buttons, labels
- Type scale: `text-4xl md:text-5xl lg:text-6xl font-bold` h1, `text-2xl md:text-3xl font-semibold` h2, `text-lg md:text-xl` h3, `text-base` body (16px min), `text-sm` secondary, `text-xs` caption
- Line height: `leading-tight` (1.25) headings, `leading-relaxed` (1.625) body, `leading-normal` (1.5) default
- Letter spacing: `tracking-tight` headings, default body
- `text-balance` cho short headings
- `max-w-prose` (65ch) cho long-form body

**Colors** (must use tokens, no hardcoded hex):
- `bg-background text-foreground` (page bg/fg)
- `bg-card text-card-foreground border border-border` (cards)
- `bg-muted text-muted-foreground` (muted sections)
- `bg-primary text-primary-foreground` (CTAs)
- `bg-secondary text-secondary-foreground` (secondary buttons)
- `bg-destructive text-destructive-foreground` (destructive actions)
- `text-accent-foreground bg-accent` (hover states)
- `border-border` (borders, dividers)
- `ring-ring` (focus rings)
- ❌ KHÔNG `text-[#00B67A]`, `text-gray-900`, `bg-blue-500` trực tiếp
- ✅ Color scales only via tokens: `text-primary`, `bg-primary/50` (opacity modifier), `bg-muted/50`

**Spacing scale** (Tailwind defaults + 4px base):
- `gap-2`/`gap-3` (8/12px), `gap-4` (16px), `gap-6` (24px), `gap-8` (32px), `gap-12` (48px), `gap-16` (64px)
- ❌ KHÔNG `gap-[17px]` — dùng Tailwind scale

**Responsive** (mobile-first):
- `text-base md:text-lg lg:text-xl` (không `text-xl max-md:text-base` desktop-first)
- `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` (không `grid-cols-3 max-md:grid-cols-1`)
- Test at breakpoint boundaries: 640/768/1024/1280/1536px

**Interactive states**:
- Hover (cards): `hover:-translate-y-0.5 hover:shadow-md transition-all duration-200`
- Hover (buttons): `hover:bg-primary/90 transition-colors`
- Focus: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background` (không `focus:ring-2`)
- Active: `active:scale-95`
- Disabled: `disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none`
- Loading: `<Skeleton className="h-4 w-[200px]" />` (không spinner cho content), `aria-busy="true"` cho buttons
- Reduced motion: `motion-reduce:transition-none motion-reduce:hover:translate-y-0`

**Icon-only buttons**:
```tsx
<Button variant="ghost" size="icon" aria-label="Close menu">
  <X className="size-4" />
</Button>
```

**Images**:
- `<Image src={...} alt="..." width={...} height={...} priority={isLCP} />` từ `next/image`
- `fill` cho responsive (with relative parent + `className="object-cover"`)
- `placeholder="blur"` cho hero images
- Configure `remotePatterns` trong `next.config.ts` cho external domains
- ❌ KHÔNG `<img>` (CLS risk + no auto-optimization)
- ✅ Decorative: `alt=""`

**Links**:
- Internal: `<Link href="/about">About</Link>` từ `next/link` (client-side nav + prefetch)
- External: `<a href="https://external.com" target="_blank" rel="noopener noreferrer">External</a>`

**Animations** (define keyframes trong `globals.css` hoặc `tailwind.config.ts`):
- Marquee: `keyframes marquee { from: { transform: translateX(0) } to: { transform: translateX(-50%) } }` → `animate-marquee` (use `linear infinite`)
- Fade-in-up: `keyframes fade-in-up { from: { opacity: 0; transform: translateY(20px) } to: { opacity: 1; transform: translateY(0) } }` → `animate-fade-in-up`
- Float: `0%, 100%: translateY(0); 50%: translateY(-10px)` → `animate-float`
- Stagger reveal via inline `style={{ animationDelay: `${index * 80}ms` }}` (allowed as dynamic)
- **Motion tier** from MASTER.md (1-3 Subtle, 4-7 Standard, 8-10 Complex):
  - Subtle: `transition-colors duration-200`, `hover:scale-105 transition-transform`
  - Standard: `IntersectionObserver` scroll reveal, `style={{ animationDelay }}`, GSAP optional
  - Complex: GSAP `useGSAP` + ScrollTrigger (pin/scrub), SplitText cho hero only (<8 words)

**Accessibility checklist** (from `references/ui-ux-pro-max/pro-rules.md`):
- ✅ All `<img>` có `alt` (decorative → `alt=""`)
- ✅ All icon-only buttons có `aria-label`
- ✅ All interactive elements focusable + visible focus ring (`focus-visible:ring-2`)
- ✅ Touch targets ≥ 44×44px on mobile (`min-h-11 min-w-11`)
- ✅ Color contrast ≥ 4.5:1 (text), ≥ 3:1 (large/UI)
- ✅ Don't rely solely on color for meaning (add icon/text)
- ✅ Heading hierarchy sequential (h1→h2→h3, no skip)
- ✅ One `<h1>` per page
- ✅ `<html lang="en">` set in layout
- ✅ `<meta name="viewport">` set in layout
- ✅ `prefers-reduced-motion: reduce` → render final state immediately
- ✅ Form: `<FieldLabel htmlFor>` (không placeholder-as-label)
- ✅ Form errors: `aria-invalid="true"` + `aria-describedby` link to error message
- ✅ Live regions: `aria-live="polite"` for toasts, `aria-live="assertive"` for errors

### Step 4 — Motion presets (optional, dựa trên MASTER.md motion tier)

**Subtle tier (1-3)**:
```tsx
// Hover lift
<Card className="hover:-translate-y-0.5 hover:shadow-md transition-all duration-200">

// Scroll reveal (CSS only)
<div className="animate-fade-in-up" style={{ animationDelay: '200ms' }}>

// Button press
<Button className="active:scale-95 transition-transform">
```

**Standard tier (4-7)**:
```tsx
'use client';
import { useEffect, useRef, useState } from 'react';

// Scroll-triggered reveal via IntersectionObserver
function useInView<T extends HTMLElement>(threshold = 0.1) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setInView(true);
        obs.unobserve(el);
      }
    }, { threshold });
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, inView };
}

// Usage
const { ref, inView } = useInView<HTMLDivElement>();
<div ref={ref} className={inView ? 'animate-fade-in-up' : 'opacity-0'}>...</div>
```

**Complex tier (8-10)** — reserve cho hero only:
```tsx
'use client';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
gsap.registerPlugin(ScrollTrigger, useGSAP);

function HeroAnimation() {
  const container = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    gsap.from('.hero-headline', {
      opacity: 0, y: 40, duration: 0.8, ease: 'power3.out',
    });
    gsap.to('.hero-image', {
      yPercent: -20, ease: 'none',
      scrollTrigger: { trigger: container.current, start: 'top top', end: '+=100%', scrub: 1 },
    });
  }, { scope: container });
  return <div ref={container}>...</div>;
}
```

### Step 5 — Self-audit before deliver

```bash
# Start dev server (or use existing one)
# Then run audit
node skills/clone-website/scripts/phase2-creative/design-audit.mjs \
  --url http://localhost:3000/{route} --out audit-output/{route}

# Check token compliance
node skills/clone-website/scripts/phase2-creative/validate-tokens.cjs --dir src/
```

**Fix all HIGH findings**:
- horizontal-overflow (page scrollX > viewport)
- img-alt missing
- focus-visible missing on interactive elements
- accessible-name missing on buttons/links
- viewport-meta missing
- Multiple `<h1>` on page

**Fix all MEDIUM findings**:
- tap-target < 44px on mobile
- contrast < 4.5:1 (approximate, verify manually)
- unsized-media (`<Image width height>` missing)
- html-lang missing
- Headings hierarchy skip

**Re-screenshot, VLM-compare với screenshot gốc** → fidelity score (target ≥7/10):
- Compare side-by-side via `z-ai vision --image1 <original> --image2 <clone> --prompt "Rate fidelity 1-10, list differences"`

## OUTPUT

Tạo/sửa các file:

| File | Loại | Mục đích |
|------|------|---------|
| `src/app/{route}/page.tsx` | Server Component (default) | Composes sections, exports metadata |
| `src/components/pages/{route}/{route}-sections.tsx` | Server Component (hoặc Client Component if needed) | Sections composition |
| `src/components/pages/{route}/{section-name}.tsx` | Server or Client Component | Từng section riêng (Hero, Faq, etc.) |
| `src/components/shared/{Component}.tsx` | Reusable shared | Components dùng chung nhiều pages (Header, Footer, BusinessPrompt, etc.) |
| `src/app/globals.css` | Updated | Add @theme inline + :root + .dark + custom keyframes (if new tokens/animations) |
| `tokens.json` (at project root) | Token definitions | W3C DTCG 3-layer JSON |
| `src/app/design-tokens.css` (optional) | Generated tokens | CSS variables from generate-tokens.cjs |
| `audit-output/{route}/report.md` | QA report | Proof of audit pass |

## ANTI-PATTERNS (DON'T)

### Tokens & Colors
- ❌ Hardcode hex colors (`text-[#00B67A]`) — use `text-primary` or `bg-primary`
- ❌ Mix hex + token (`bg-white text-primary`) — use `bg-background text-foreground` + `text-primary` for accent
- ❌ Use `bg-blue-500` (default palette) when brand has its own palette — use `bg-primary`
- ❌ Use raw `gray-900`, `slate-800` etc. — use `text-foreground`, `bg-card`, `bg-muted`

### Layout & Spacing
- ❌ Hardcode spacing (`p-[17px]`, `gap-[18px]`) — use Tailwind scale
- ❌ Desktop-first responsive (`text-xl max-md:text-base`)
- ❌ `flex-shrink-0` (deprecated) — use `shrink-0`
- ❌ `h-6 w-6` for square — use `size-6`
- ❌ Dynamic class names (`` `bg-${color}-500` ``) — Tailwind v4 can't static-detect → use `colorMap[color]` pattern with complete tokens
- ❌ Fixed pixel widths (`w-[300px]`) — use `w-full max-w-md` or `w-72`

### Components & Interactivity
- ❌ `'use client'` on entire page — push to leaf components
- ❌ `<img>` instead of `<Image>` — CLS risk
- ❌ `<a href="/internal">` — use `<Link>` for client-side nav + prefetch
- ❌ Placeholder as label — use `<FieldLabel htmlFor="...">`
- ❌ Inline styles (except dynamic `animationDelay` per-item, custom CSS variables via `style={{ '--foo': 'bar' }}`)

### Styling Consistency
- ❌ Mixing flat & skeuomorphic styles randomly — pick 1 style từ MASTER.md
- ❌ Emoji as icons — use Lucide (`import { X } from "lucide-react"`)
- ❌ `bg-gradient-to-r` (Tailwind v3 syntax) — use `bg-linear-to-r` (v4)

### Animations
- ❌ Animate `width/height/top/left` — use `transform/opacity` only
- ❌ One duration for every transition — use semantic durations (fast 150ms, normal 200ms, slow 300ms)
- ❌ No `prefers-reduced-motion` fallback — `motion-reduce:transition-none`
- ❌ `focus:ring-2` (shows on click) — use `focus-visible:ring-2`
- ❌ Multiple unbounded `animate-bounce` — add `motion-reduce:animate-none`

### Accessibility
- ❌ Touch targets < 44×44px on mobile — `min-h-11 min-w-11`
- ❌ Missing `aria-label` on icon-only buttons
- ❌ Missing `alt` on `<Image>` (use `alt=""` for decorative)
- ❌ Skipping heading levels (h1 → h3) — sequential h1→h2→h3
- ❌ More than 1 `<h1>` per page
- ❌ Missing `<meta name="viewport">` — mobile rendering breaks
- ❌ Missing `lang` attribute on `<html>`
- ❌ Color-only meaning (red = error) — add icon + text

## EXAMPLE — Before/After

### Before (skeleton, từ Phase 1)

```tsx
// Auto-generated skeleton by clone-website skill
import React from 'react';

interface HeroSectionProps {
  className?: string;
}

export default function HeroSection({ className }: HeroSectionProps) {
  return (
    <section className={className}>
      <div dangerouslySetInnerHTML={{ __html: `<div class="bg-white px-4 sm:px-6 lg:px-14"><div class="mx-auto max-w-[1200px] flex flex-col items-center"><h1 class="text-[56px] leading-[60px] md:text-8xl md:leading-[100px] font-heading text-black/80">The complete AI<br>business builder</h1><p class="text-base md:text-lg max-w-[486px] text-black/80">Launch a website, get customers, and grow your business faster with AI. Get online in 30 seconds.</p></div></div>` }} />
    </section>
  );
}
```

### After (mode-creative, refined with style)

```tsx
// src/components/pages/home/hero-section.tsx
import { Badge } from '@/components/ui/badge';
import { Sparkles } from 'lucide-react';

export default function HeroSection() {
  return (
    <section
      aria-label="Hero"
      className="relative overflow-hidden bg-background py-20 md:py-28"
    >
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(60%_60%_at_50%_0%,hsl(var(--primary)/0.15),transparent_70%)]"
      />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center gap-6 text-center">
          <Badge variant="secondary" className="rounded-full px-4 py-1.5 text-sm">
            <Sparkles className="size-3.5 mr-1.5" aria-hidden />
            Powered by AI
          </Badge>
          <h1 className="max-w-4xl font-serif text-5xl leading-tight tracking-tight text-foreground md:text-7xl lg:text-8xl">
            The complete AI
            <br />
            business builder
          </h1>
          <p className="max-w-lg text-base text-muted-foreground md:text-lg">
            Launch a website, get customers, and grow your business faster with AI. Get online in 30 seconds.
          </p>
        </div>
      </div>
    </section>
  );
}
```

### Differences (faithful vs creative):

| Aspect | Skeleton (Phase 1) | Mode-Creative (Refined) |
|--------|-------------------|-------------------------|
| `class` attribute | Raw `class="..."` | `className="..."` (JSX) |
| `text-black/80` | Literal class | `text-foreground` (token) |
| `bg-white` | Literal class | `bg-background` (token) |
| `font-heading` | Custom font family | `font-serif` (mapped to Fraunces via @theme) |
| Inline `<br>` | Direct from HTML | Same (acceptable) |
| Hardcoded font-size `text-[56px]` | Arbitrary value | `text-5xl md:text-7xl lg:text-8xl` (Tailwind scale) |
| Hardcoded `max-w-[1200px]` | Arbitrary value | `max-w-7xl` (Tailwind scale) |
| Inline `px-14` | Raw from HTML | `lg:px-8` (Tailwind scale, mobile-first) |
| Decorative radial bg | Missing | Added `bg-[radial-gradient(...)]` (visual polish) |
| Badge "Powered by AI" | Missing | Added for visual hierarchy (matches original screenshot) |
| `aria-label="Hero"` | Missing | Added for screen readers |
| `aria-hidden` on decorative | Missing | Added |
| `<section>` semantic | Already (skeleton) | Kept |

→ Kết quả: component đẹp hơn, dùng tokens, accessible, mobile-first, nhưng vẫn giữ **cùng text content + cùng visual hierarchy** với gốc.

---

## Quick recipe — Refine checklist

Khi refine một component, check từng item:

- [ ] Read `design-tokens.json` from Phase 1 → extract colors + fonts
- [ ] Read `MASTER.md` (if exists) → style + motion tier + density decisions
- [ ] Read `extracted.css` to know what classes origin used (so we can match visual)
- [ ] VLM-analyze screenshot (desktop + mobile) → capture visual hierarchy, spacing, color usage
- [ ] Read component skeleton → extract text content verbatim (preserve copy fidelity)
- [ ] Build `tokens.json` W3C DTCG (3-layer) from extracted colors + fonts
- [ ] Generate `design-tokens.css` via `generate-tokens.cjs`
- [ ] Map tokens into `globals.css` `@theme inline` + `:root` + `.dark` blocks (HSL space-separated)
- [ ] Replace raw HTML elements → shadcn primitives
- [ ] Apply semantic HTML structure (section/article/h1/h2/nav/main/footer)
- [ ] Apply Tailwind utilities (mobile-first responsive, scale-based spacing)
- [ ] Apply motion preset (subtle/standard/complex based on MASTER.md tier)
- [ ] Apply accessibility checklist (alt, aria-label, focus-visible, touch target, contrast)
- [ ] Validate no hardcoded hex/px (run `validate-tokens.cjs`)
- [ ] Run `design-audit.mjs` → fix all HIGH + MEDIUM findings
- [ ] VLM-compare with original screenshot → fidelity ≥7/10
- [ ] Done. Commit.
