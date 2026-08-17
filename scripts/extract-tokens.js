// extract-tokens.js — Run via agent-browser eval
// Extracts ALL design tokens, per-element computed styles, CSS, images, animations from the current page
(function() {
  const allEls = document.querySelectorAll('*');
  const colors = new Set();
  const fonts = new Set();
  const bgColors = new Set();
  const fontSizes = new Set();
  const spacing = new Set();
  const borderRadius = new Set();
  const shadows = new Set();
  const fontWeights = new Set();
  const letterSpacings = new Set();
  const lineHeights = new Set();

  // NEW: Per-element computed styles for key elements
  const elementStyles = [];
  const MAX_ELEMENTS = 500;
  const elSlice = Array.from(allEls).slice(0, MAX_ELEMENTS);

  for (const el of elSlice) {
    try {
      const cs = getComputedStyle(el);
      if (cs.color && cs.color !== 'rgba(0, 0, 0, 0)') colors.add(cs.color);
      if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') bgColors.add(cs.backgroundColor);
      if (cs.fontFamily) fonts.add(cs.fontFamily);
      if (cs.fontSize && cs.fontSize !== '0px') fontSizes.add(cs.fontSize);
      if (cs.fontWeight) fontWeights.add(cs.fontWeight);
      if (cs.letterSpacing) letterSpacings.add(cs.letterSpacing);
      if (cs.lineHeight) lineHeights.add(cs.lineHeight);
      if (cs.padding && cs.padding !== '0px') spacing.add(cs.padding);
      if (cs.margin && cs.margin !== '0px') spacing.add(cs.margin);
      if (cs.gap && cs.gap !== 'normal' && cs.gap !== '0px') spacing.add(cs.gap);
      if (cs.borderRadius && cs.borderRadius !== '0px') borderRadius.add(cs.borderRadius);
      if (cs.boxShadow && cs.boxShadow !== 'none') shadows.add(cs.boxShadow);

      // NEW: Extract per-element styles for important elements
      const tag = el.tagName.toLowerCase();
      const cls = (el.className || '').toString();
      const isImportant = 
        tag.match(/^(h[1-6]|p|a|button|nav|header|footer|section|img)$/i) ||
        cls.match(/hero|title|heading|cta|btn|card|nav|logo|section|feature|price|testimonial|accordion|workflow|step|badge/i) ||
        el.id;
      
      if (isImportant) {
        const text = (el.textContent || '').trim().slice(0, 200);
        elementStyles.push({
          tag,
          id: el.id || undefined,
          cls: cls.slice(0, 120) || undefined,
          text: text || undefined,
          style: {
            color: cs.color,
            backgroundColor: cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent' ? cs.backgroundColor : undefined,
            fontFamily: cs.fontFamily,
            fontSize: cs.fontSize,
            fontWeight: cs.fontWeight,
            fontStyle: cs.fontStyle,
            letterSpacing: cs.letterSpacing,
            lineHeight: cs.lineHeight,
            textAlign: cs.textAlign,
            textTransform: cs.textTransform,
            padding: cs.padding !== '0px' ? cs.padding : undefined,
            paddingTop: cs.paddingTop,
            paddingRight: cs.paddingRight,
            paddingBottom: cs.paddingBottom,
            paddingLeft: cs.paddingLeft,
            margin: cs.margin !== '0px' ? cs.margin : undefined,
            marginTop: cs.marginTop,
            marginBottom: cs.marginBottom,
            borderRadius: cs.borderRadius !== '0px' ? cs.borderRadius : undefined,
            boxShadow: cs.boxShadow !== 'none' ? cs.boxShadow : undefined,
            display: cs.display,
            position: cs.position !== 'static' ? cs.position : undefined,
            width: cs.width,
            height: cs.height,
            maxWidth: cs.maxWidth !== 'none' ? cs.maxWidth : undefined,
            gap: cs.gap !== 'normal' && cs.gap !== '0px' ? cs.gap : undefined,
            backgroundImage: cs.backgroundImage !== 'none' ? cs.backgroundImage.slice(0, 200) : undefined,
            opacity: cs.opacity !== '1' ? cs.opacity : undefined,
            transform: cs.transform !== 'none' ? cs.transform : undefined,
            transition: cs.transition !== 'all 0s ease 0s' ? cs.transition.slice(0, 200) : undefined,
            overflow: cs.overflow !== 'visible' ? cs.overflow : undefined,
          }
        });
      }
    } catch(e) {}
  }

  // CSS variables
  const cssVars = {};
  try {
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule && rule.style) {
            for (const prop of rule.style) {
              if (prop.startsWith('--')) {
                cssVars[prop] = rule.style.getPropertyValue(prop).trim();
              }
            }
          }
        }
      } catch(e) {} // CORS
    }
  } catch(e) {}

  // Images
  const images = [...document.querySelectorAll('img')].map(img => ({
    src: img.src || img.currentSrc,
    alt: img.alt || '',
    w: img.naturalWidth,
    h: img.naturalHeight,
  })).filter(i => i.src).slice(0, 100);

  // Stylesheets
  const stylesheets = [...document.querySelectorAll('link[rel="stylesheet"]')].map(l => l.href);
  const inlineStyleCount = document.querySelectorAll('style').length;

  // Background images
  const bgImages = [...document.querySelectorAll('*')].filter(el => {
    try { return getComputedStyle(el).backgroundImage !== 'none'; } catch { return false; }
  }).slice(0, 30).map(el => ({
    tag: el.tagName,
    cls: (el.className || '').toString().slice(0, 60),
  }));

  // CSS text from <style> tags
  const cssTexts = [...document.querySelectorAll('style')].map(s => s.textContent).filter(t => t && t.length < 200000);

  // NEW: Animation/Interaction data
  const animations = [];
  try {
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          // Extract @keyframes
          if (rule.type === 7 || rule.cssRules) { // CSSKeyframesRule
            if (rule.name && rule.cssText) {
              animations.push({
                type: 'keyframes',
                name: rule.name,
                css: rule.cssText.slice(0, 2000),
              });
            }
          }
          // Extract transition properties
          if (rule.style && rule.style.transition && rule.style.transition !== 'all 0s ease 0s') {
            const sel = rule.selectorText || '';
            if (sel && !sel.match(/^framer/)) {
              animations.push({
                type: 'transition',
                selector: sel.slice(0, 100),
                value: rule.style.transition.slice(0, 200),
              });
            }
          }
          // Extract animation properties
          if (rule.style && rule.style.animation && rule.style.animation !== 'none 0s ease 0s normal none running none') {
            const sel = rule.selectorText || '';
            animations.push({
              type: 'animation-prop',
              selector: sel.slice(0, 100),
              value: rule.style.animation.slice(0, 200),
            });
          }
        }
      } catch(e) {} // CORS
    }
  } catch(e) {}

  // NEW: Framer-specific data attributes
  const framerData = [];
  for (const el of elSlice) {
    const attrs = el.attributes;
    if (!attrs) continue;
    for (const attr of attrs) {
      if (attr.name.startsWith('data-framer') || attr.name.startsWith('framer')) {
        framerData.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || '').toString().slice(0, 60),
          attr: attr.name,
          value: attr.value.slice(0, 200),
        });
      }
    }
  }

  return JSON.stringify({
    colors: [...colors].slice(0, 50),
    bgColors: [...bgColors].slice(0, 50),
    fonts: [...fonts],
    fontSizes: [...fontSizes].sort(),
    fontWeights: [...fontWeights].sort(),
    letterSpacings: [...letterSpacings].sort(),
    lineHeights: [...lineHeights].sort(),
    spacing: [...spacing].slice(0, 30),
    borderRadius: [...borderRadius].slice(0, 20),
    shadows: [...shadows].slice(0, 15),
    elementStyles, // NEW: per-element computed styles
    animations, // NEW: animation data
    framerData: framerData.slice(0, 100), // NEW: Framer-specific attrs
    cssVars,
    images,
    stylesheets,
    inlineStyleCount,
    bgImages,
    cssTexts,
    totalElements: allEls.length,
  });
})()
