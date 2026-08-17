# Webflow Patterns → Next.js Mapping

Tài liệu tham khảo cho các pattern Webflow phổ biến và cách chuyển đổi sang Next.js + Tailwind CSS.

## 1. Navbar / Navigation

### Webflow Pattern
```html
<div class="navbar w-nav" data-animation="default" data-collapse="medium">
  <div class="navbar-container">
    <a href="/" class="brand w-nav-brand">
      <img src="logo.svg" alt="Logo">
    </a>
    <nav class="nav-menu w-nav-menu">
      <a href="/features" class="nav-link">Features</a>
      <a href="/pricing" class="nav-link">Pricing</a>
      <a href="/about" class="nav-link">About</a>
    </nav>
    <div class="menu-button w-nav-button">
      <div class="icon w-icon-nav-menu"></div>
    </div>
  </div>
</div>
```

### Next.js Equivalent
```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Menu, X } from 'lucide-react';

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/assets/logo.svg" alt="Logo" width={120} height={32} />
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-6">
          <Link href="/features" className="text-sm font-medium hover:text-primary">Features</Link>
          <Link href="/pricing" className="text-sm font-medium hover:text-primary">Pricing</Link>
          <Link href="/about" className="text-sm font-medium hover:text-primary">About</Link>
        </nav>

        {/* Mobile Toggle */}
        <button
          className="md:hidden"
          onClick={() => setIsOpen(!isOpen)}
          aria-label="Toggle menu"
        >
          {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile Menu */}
      {isOpen && (
        <div className="md:hidden border-t bg-background p-4">
          <nav className="flex flex-col gap-3">
            <Link href="/features" className="text-sm font-medium">Features</Link>
            <Link href="/pricing" className="text-sm font-medium">Pricing</Link>
            <Link href="/about" className="text-sm font-medium">About</Link>
          </nav>
        </div>
      )}
    </header>
  );
}
```

---

## 2. Hero Section

### Webflow Pattern
```html
<div class="hero-section">
  <div class="hero-container">
    <h1 class="hero-heading">Build Better Products</h1>
    <p class="hero-subheading">The all-in-one platform for modern teams</p>
    <div class="hero-buttons">
      <a href="#cta" class="button-primary">Get Started</a>
      <a href="#demo" class="button-secondary">Watch Demo</a>
    </div>
  </div>
</div>
```

### Next.js Equivalent
```tsx
import Link from 'next/link';

export default function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-primary/5 to-background py-20 md:py-32">
      <div className="container mx-auto px-4 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
          Build Better Products
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl">
          The all-in-one platform for modern teams
        </p>
        <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Link
            href="#cta"
            className="inline-flex h-12 items-center justify-center rounded-lg bg-primary px-8 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          >
            Get Started
          </Link>
          <Link
            href="#demo"
            className="inline-flex h-12 items-center justify-center rounded-lg border px-8 text-sm font-medium shadow-sm transition-colors hover:bg-muted"
          >
            Watch Demo
          </Link>
        </div>
      </div>
    </section>
  );
}
```

---

## 3. Features Grid (Card Layout)

### Webflow Pattern
```html
<div class="features-section">
  <div class="features-grid">
    <div class="feature-card">
      <div class="feature-icon">🚀</div>
      <h3 class="feature-title">Fast</h3>
      <p class="feature-desc">Lightning fast performance</p>
    </div>
    <!-- repeat for each card -->
  </div>
</div>
```

### Next.js Equivalent
```tsx
const features = [
  { icon: '🚀', title: 'Fast', description: 'Lightning fast performance' },
  { icon: '🔒', title: 'Secure', description: 'Enterprise-grade security' },
  { icon: '📱', title: 'Responsive', description: 'Works on all devices' },
];

export default function FeaturesGrid() {
  return (
    <section className="py-16 md:py-24">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-xl border bg-card p-6 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="text-3xl">{feature.icon}</div>
              <h3 className="mt-4 text-lg font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

---

## 4. CTA Section

### Webflow Pattern
```html
<div class="cta-section">
  <h2 class="cta-heading">Ready to get started?</h2>
  <a href="/signup" class="cta-button">Sign Up Free</a>
</div>
```

### Next.js Equivalent
```tsx
import Link from 'next/link';

export default function CTASection() {
  return (
    <section className="bg-primary py-16 md:py-24">
      <div className="container mx-auto px-4 text-center">
        <h2 className="text-3xl font-bold text-primary-foreground md:text-4xl">
          Ready to get started?
        </h2>
        <Link
          href="/signup"
          className="mt-8 inline-flex h-12 items-center justify-center rounded-lg bg-primary-foreground px-8 text-sm font-medium text-primary shadow transition-colors hover:bg-primary-foreground/90"
        >
          Sign Up Free
        </Link>
      </div>
    </section>
  );
}
```

---

## 5. Footer

### Webflow Pattern
```html
<footer class="footer-section">
  <div class="footer-grid">
    <div class="footer-brand">
      <img src="logo.svg" alt="Logo">
      <p>© 2024 Company. All rights reserved.</p>
    </div>
    <div class="footer-links">
      <h4>Product</h4>
      <a href="/features">Features</a>
      <a href="/pricing">Pricing</a>
    </div>
    <div class="footer-links">
      <h4>Company</h4>
      <a href="/about">About</a>
      <a href="/contact">Contact</a>
    </div>
  </div>
</footer>
```

### Next.js Equivalent
```tsx
import Link from 'next/link';
import Image from 'next/image';

const footerLinks = {
  product: [
    { label: 'Features', href: '/features' },
    { label: 'Pricing', href: '/pricing' },
  ],
  company: [
    { label: 'About', href: '/about' },
    { label: 'Contact', href: '/contact' },
  ],
};

export default function Footer() {
  return (
    <footer className="border-t bg-muted/50 py-12">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <Image src="/assets/logo.svg" alt="Logo" width={120} height={32} />
            <p className="mt-4 text-sm text-muted-foreground">
              © {new Date().getFullYear()} Company. All rights reserved.
            </p>
          </div>
          <div>
            <h4 className="text-sm font-semibold">Product</h4>
            <ul className="mt-4 space-y-2">
              {footerLinks.product.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-muted-foreground hover:text-foreground">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold">Company</h4>
            <ul className="mt-4 space-y-2">
              {footerLinks.company.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-muted-foreground hover:text-foreground">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}
```

---

## Webflow CSS Class Conventions

Webflow uses specific class naming patterns that map to common UI concepts:

| Webflow Class Pattern | UI Concept | Tailwind Mapping |
|----------------------|------------|-----------------|
| `w-*` | Width | `w-*` |
| `h-*` | Height | `h-*` |
| `padding-*` | Padding | `p-*` |
| `margin-*` | Margin | `m-*` |
| `flex-*` | Flex | `flex *` |
| `grid-*` | Grid | `grid *` |
| `background-*` | Background | `bg-*` |
| `color-*` | Text color | `text-*` |
| `font-*` | Font | `font-*` |
| `text-*` | Text size/align | `text-*` |
| `border-*` | Border | `border-*` |
| `rounded-*` | Border radius | `rounded-*` |
| `shadow-*` | Box shadow | `shadow-*` |
| `opacity-*` | Opacity | `opacity-*` |
| `z-*` | Z-index | `z-*` |
| `sticky` / `fixed` | Position | `sticky` / `fixed` |
| `overflow-*` | Overflow | `overflow-*` |

## Webflow Interaction → React State

| Webflow Interaction | React Implementation |
|--------------------|---------------------|
| Show/hide on click | `useState<boolean>` toggle |
| Tabs / pill switch | `useState<string>` active tab |
| Accordion open/close | `useState<Set<number>>` open items |
| Dropdown | `useState<boolean>` + outside click handler |
| Slider / carousel | `useState<number>` current index |
| Scroll animation | `useEffect` + `IntersectionObserver` |
| Navbar scroll effect | `useEffect` + scroll event listener |
| Modal / lightbox | `useState<boolean>` + portal |
| Form validation | `react-hook-form` + `zod` |
