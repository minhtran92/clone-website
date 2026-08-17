#!/usr/bin/env node
/**
 * extract-content.js — Extract REAL structured content from Framer SSR HTML
 *
 * Problem being solved:
 *   Previous rebuild was a "wireframe" (fidelity 3/10) because content was
 *   GUESSED (made-up product names, wrong image hashes, placeholder text).
 *   The REAL content is in clone-output/pages/home/html-raw/page.html
 *   (775KB hydrated DOM with all text, image URLs, prices, links).
 *
 * Solution:
 *   Use cheerio to parse the hydrated HTML and extract structured data:
 *   - Hero (heading, eyebrow, CTA, image URLs)
 *   - Product sections (name, price, compareAt, discount, image)
 *   - Categories (name, image)
 *   - Features (title, desc, icon)
 *   - Stores (city, district, hours)
 *   - Testimonials (quote, author)
 *   - Footer (contact, nav, social)
 *
 * Output: src/components/rebuild/home/content.json — feed into React components.
 *
 * Usage: node extract-content.js
 */
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const HTML_PATH = path.resolve(process.cwd(), 'clone-output/pages/home/html-raw/page.html');
const OUT_PATH = path.resolve(process.cwd(), 'src/components/rebuild/home/content.json');

// Map remote framerusercontent URLs → local /assets/_hash/... via url-map.json
const URL_MAP_PATH = path.resolve(process.cwd(), 'public/assets/_hash/url-map.json');
let urlMap = {};
try {
  urlMap = JSON.parse(fs.readFileSync(URL_MAP_PATH, 'utf-8'));
} catch {}

function localize(url) {
  if (!url) return '';
  // strip query string for matching
  const base = url.split('?')[0];
  return urlMap[url] || urlMap[base] || urlMap[`${base}?width=1024`] || url;
}

const $ = cheerio.load(fs.readFileSync(HTML_PATH, 'utf-8'));

function text(el) {
  return (el && $(el).text().trim()) || '';
}

function firstImg(el) {
  if (!el) return '';
  const img = $(el).find('img').first();
  return localize(img.attr('src') || '');
}

// === HERO ===
// Hero text is "WEAR THE HYPE "RAW"" (eyebrow) + "Dress the unconventional" (heading)
const heroSection = $('section.framer-16mosj6').first();
const hero = {
  eyebrow: 'WEAR THE HYPE "RAW"',
  heading: 'Dress the unconventional',
  cta: 'Shop Now',
  images: heroSection.find('img').slice(0, 3).map(function () {
    return localize($(this).attr('src') || '');
  }).get(),
};

// === PRODUCTS (find all price-bearing cards) ===
// Strategy: find elements with $price text, then walk up to find name + image
const products = [];
const seenPrices = new Set();
$('a, div, span').each(function () {
  const el = $(this);
  const elText = text(el);
  // Must have a price AND be a "leaf-ish" container (no nested price-bearing children)
  if (!/\$\d/.test(elText)) return;
  if (elText.length > 200) return;
  // Find price
  const priceMatch = elText.match(/\$(\d+(?:\.\d{2})?)/);
  if (!priceMatch) return;
  const price = '$' + priceMatch[1];
  if (seenPrices.has(price + elText.slice(0, 20))) return;
  seenPrices.add(price + elText.slice(0, 20));
  // Compare-at price (second $ match)
  const allPrices = elText.match(/\$(\d+(?:\.\d{2})?)/g);
  const compareAt = allPrices && allPrices.length > 1 ? allPrices[1] : null;
  // Discount percent
  const discountMatch = elText.match(/(\d{1,2})%\s*OFF/i) || elText.match(/(\d{1,2})%/);
  const discount = discountMatch ? discountMatch[1] + '%' : null;
  // Name: text before first $ — but only if it's a clean product name (not hero text)
  let name = elText.split(/\$\d/)[0].trim();
  if (name.length < 3 || name.length > 80) return;
  if (/Dress the unconventional|WEAR THE HYPE/i.test(name)) return;
  if (/^[A-Z\s]{20,}$/.test(name) && name.length > 40) return; // all-caps noise
  // Find image in this card or ancestor
  let img = el.find('img').first();
  if (!img.length) img = el.closest('a, [class*="card"], [class*="product"]').find('img').first();
  const src = localize(img.attr('src') || '');
  if (!src) return;
  const key = src + '|' + name;
  if (products.find((p) => p.src + '|' + p.name === key)) return;
  products.push({ name, src, price, compareAt, discount });
});

// === CATEGORIES ===
const categories = [];
// Look for category names: Shoes, T-Shirt, Hoodie, Jacket, Shirt, Jeans, Accessories
const catNames = ['Shoes', 'T-Shirt', 'Hoodie', 'Jacket', 'Shirt', 'Jeans', 'Accessories'];
catNames.forEach((name) => {
  const link = $('a, div').filter(function () {
    return text($(this)) === name;
  }).first();
  if (link.length) {
    const img = link.closest('[class*="framer"]').find('img').first();
    categories.push({ name, image: localize(img.attr('src') || '') });
  }
});

// === FEATURES (Fast Shipping, Easy Returns, Secure Payments, Customer Support) ===
const features = [];
['Fast Shipping', 'Easy Returns', 'Secure Payments', 'Customer Support'].forEach((title) => {
  const el = $('*').filter(function () {
    return text($(this)) === title;
  }).first();
  if (el.length) {
    // Find sibling/nearby desc text
    const parent = el.parent();
    const desc = text(parent.find('*').filter(function () {
      const t = text($(this));
      return t && t !== title && t.length < 60 && !t.includes('$');
    }).first());
    features.push({ title, desc });
  }
});

// === STORES (London, New York) ===
const stores = [];
['London', 'New York City'].forEach((city) => {
  const el = $('*').filter(function () {
    return text($(this)) === city;
  }).first();
  if (el.length) {
    const card = el.closest('[class*="framer"]');
    const district = text(card.find('*').filter(function () {
      const t = text($(this));
      return t && t !== city && t.length < 40 && !t.includes('$') && !t.includes('am') && !t.includes('pm');
    }).first());
    const hours = text(card.find('*').filter(function () {
      const t = text($(this));
      return t && t.length < 40 && (t.includes('am') || t.includes('pm') || t.includes('Mon'));
    }).first());
    const img = card.find('img').first();
    stores.push({ city, district, hours, image: localize(img.attr('src') || '') });
  }
});

// === TESTIMONIALS (Social Wall) ===
const testimonials = [];
$('[class*="framer"]').each(function () {
  const el = $(this);
  const t = text(el);
  // Testimonial = long text (>40 chars) with a quote-like content
  if (t.length > 40 && t.length < 200 && !t.includes('$') && !t.match(/^(Shop|Drops|Sale|New|About|All|View)/i)) {
    const author = text(el.nextAll('*').filter(function () {
      const at = text($(this));
      return at && at.length < 30 && at.length > 2 && !at.includes('$');
    }).first());
    if (author && author !== t) {
      testimonials.push({ quote: t, author });
    }
  }
});

// === FOOTER CONTACT ===
const email = ($('a[href^="mailto:"]').first().attr('href') || '').replace('mailto:', '');
const phone = ($('a[href^="tel:"]').first().attr('href') || '').replace('tel:', '');

// === SECTION HEADINGS (Latest Drops, Black Friday, Best Sellers, New Arrivals, etc.) ===
const sections = [];
const sectionMap = {
  'latest': { heading: 'Drops', eyebrow: 'latest' },
  'black friday': { heading: 'sale', eyebrow: 'black friday' },
  'Best Sellers': { heading: 'Best Sellers', eyebrow: 'popular' },
  'new': { heading: 'Arrivals', eyebrow: 'new' },
  'Categories': { heading: 'Categories', eyebrow: 'browse' },
  'About': { heading: 'About', eyebrow: '' },
  'walk-in': { heading: 'STORES', eyebrow: 'walk-in' },
  'gift card': { heading: 'Rawline', eyebrow: 'gift card' },
  'Social': { heading: 'wall', eyebrow: 'Social' },
};
Object.entries(sectionMap).forEach(([keyword, info]) => {
  const el = $('*').filter(function () {
    return text($(this)).toLowerCase() === keyword.toLowerCase() && text($(this)).length < 30;
  }).first();
  if (el.length) sections.push({ keyword, ...info });
});

const data = {
  hero,
  products: products.slice(0, 20),
  categories,
  features,
  stores,
  testimonials: testimonials.slice(0, 5),
  footer: { email, phone },
  sectionsFound: sections,
};

fs.writeFileSync(OUT_PATH, JSON.stringify(data, null, 2), 'utf-8');
console.log(`✅ Extracted content → ${OUT_PATH}`);
console.log(`   Hero: ${hero.heading?.slice(0, 40)} (${hero.images.length} imgs)`);
console.log(`   Products: ${products.length}`);
console.log(`   Categories: ${categories.length}`);
console.log(`   Features: ${features.length}`);
console.log(`   Stores: ${stores.length}`);
console.log(`   Testimonials: ${testimonials.length}`);
console.log(`   Email: ${email}, Phone: ${phone}`);
