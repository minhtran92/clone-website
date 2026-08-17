#!/usr/bin/env node
/**
 * extract-appear-variants.js — Parse Framer runtime JS to extract appear-id → variant mapping
 *
 * Framer's runtime (script_main.*.mjs) defines scroll-reveal animations via
 * framer-motion variants on each [data-framer-appear-id] element. This script
 * parses the runtime and emits a JSON map: { appearId: { initial: {...}, animate: {...} } }
 * so FramerReveal.tsx can replay the exact same animations without the runtime.
 *
 * Usage: node extract-appear-variants.js <framer-runtime.mjs> <output.json>
 */
const fs = require('fs');

const code = fs.readFileSync(process.argv[2], 'utf-8');
const out = {};

// 1. Find all appear-id declarations + their initial/animate variable refs
const idRe = /"data-framer-appear-id":`([a-zA-Z0-9_-]+)`[^]*?(?:initial:([A-Za-z_$][A-Za-z0-9_$]*))[^]*?(?:animate:([A-Za-z_$][A-Za-z0-9_$]*))?/g;
let m;
const pairs = [];
while ((m = idRe.exec(code))) {
  pairs.push({ id: m[1], initialVar: m[2], animateVar: m[3] });
  idRe.lastIndex = m.index + 1; // advance to avoid infinite loop on overlapping
}

// 2. Build a table of all variable definitions: VAR={opacity:..,y:..,...}
// Match full variant objects (opacity + optional x/y/rotate/scale + optional transition)
const varRe = /([A-Za-z_$][A-Za-z0-9_$]{0,4})=\{(opacity:[^}]*(?:,[a-z]+:[^,}]+)*(?:,transition:\{[^}]*\})?(?:,y:[+-]?[0-9.]+)?(?:,x:[+-]?[0-9.]+)?)\}/g;
const varVals = {};
let v;
while ((v = varRe.exec(code))) {
  if (!varVals[v[1]]) {
    // Parse the object into a real JS object
    const body = '{' + v[2] + '}';
    try {
      // eslint-disable-next-line no-new-func
      const obj = new Function('return ' + body)();
      varVals[v[1]] = obj;
    } catch { /* skip malformed */ }
  }
}

// 3. Also extract transition objects (transition:VAR)
const trVarRe = /([A-Za-z_$][A-Za-z0-9_$]{0,4})=\{damping:([0-9]+),delay:([0-9.]+),duration:([0-9.]+),ease:\[([^\]]+)\][^}]*\}/g;
const trVals = {};
let tr;
while ((tr = trVarRe.exec(code))) {
  if (!trVals[tr[1]]) {
    trVals[tr[1]] = {
      damping: +tr[2], delay: +tr[3], duration: +tr[4],
      ease: tr[5].split(',').map(s => parseFloat(s)),
      type: 'spring',
    };
  }
}
// Tween transitions: transition:{delay:..,duration:..,ease:[..],type:`tween`}
const tweenRe = /([A-Za-z_$][A-Za-z0-9_$]{0,4})=\{delay:([0-9.]+),duration:([0-9.]+),ease:\[([^\]]+)\],type:`tween`\}/g;
while ((tr = tweenRe.exec(code))) {
  if (!trVals[tr[1]]) {
    trVals[tr[1]] = { delay: +tr[2], duration: +tr[3], ease: tr[4].split(',').map(s => parseFloat(s)), type: 'tween' };
  }
}

// 4. Resolve each appear-id → {initial, animate}
// Default animate: {opacity:1, y:0} with default transition
const DEFAULT_ANIMATE = { opacity: 1, y: 0 };
for (const p of pairs) {
  const initial = varVals[p.initialVar] || { opacity: 0.001, y: 0 };
  let animate = varVals[p.animateVar] || DEFAULT_ANIMATE;
  // Resolve nested transition variable refs
  if (animate.transition && typeof animate.transition === 'string' && trVals[animate.transition]) {
    animate = { ...animate, transition: trVals[animate.transition] };
  } else if (!animate.transition) {
    // Default tween: 0.6s easeOut
    animate = { ...animate, transition: { duration: 0.6, ease: [0.5, 0, 0.88, 0.77], type: 'tween' } };
  }
  out[p.id] = { initial, animate };
}

fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 2), 'utf-8');
console.log(`✅ Extracted ${Object.keys(out).length} appear-id variants → ${process.argv[3]}`);
for (const [id, v] of Object.entries(out)) {
  console.log(`   ${id}: initial=${JSON.stringify(v.initial).slice(0, 60)}`);
}
