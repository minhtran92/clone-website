// extract-tokens.js — Run via agent-browser eval
// Extracts all design tokens, computed styles, CSS, images from the current page
(function() {
  const allEls = document.querySelectorAll('*');
  const colors = new Set();
  const fonts = new Set();
  const bgColors = new Set();
  const fontSizes = new Set();
  const spacing = new Set();
  const borderRadius = new Set();
  const shadows = new Set();

  for (const el of Array.from(allEls).slice(0, 300)) {
    try {
      const cs = getComputedStyle(el);
      if (cs.color && cs.color !== 'rgba(0, 0, 0, 0)') colors.add(cs.color);
      if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') bgColors.add(cs.backgroundColor);
      if (cs.fontFamily) fonts.add(cs.fontFamily);
      if (cs.fontSize && cs.fontSize !== '0px') fontSizes.add(cs.fontSize);
      if (cs.padding && cs.padding !== '0px') spacing.add(cs.padding);
      if (cs.margin && cs.margin !== '0px') spacing.add(cs.margin);
      if (cs.gap && cs.gap !== 'normal' && cs.gap !== '0px') spacing.add(cs.gap);
      if (cs.borderRadius && cs.borderRadius !== '0px') borderRadius.add(cs.borderRadius);
      if (cs.boxShadow && cs.boxShadow !== 'none') shadows.add(cs.boxShadow);
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

  return JSON.stringify({
    colors: [...colors].slice(0, 50),
    bgColors: [...bgColors].slice(0, 50),
    fonts: [...fonts],
    fontSizes: [...fontSizes].sort(),
    spacing: [...spacing].slice(0, 30),
    borderRadius: [...borderRadius].slice(0, 20),
    shadows: [...shadows].slice(0, 15),
    cssVars,
    images,
    stylesheets,
    inlineStyleCount,
    bgImages,
    cssTexts,
    totalElements: allEls.length,
  });
})()
