/**
 * SVG Palette Pal
 * Zero-dependency browser utility for deterministic SVG color analysis,
 * single-axis HSL shifts, color merging, and interactive CIELAB brand quantization.
 */
(() => {
  'use strict';

  // ============================================================================
  // 1. COLOR PARSING, CONVERSION & PERCEPTUAL DISTANCE ENGINE
  // ============================================================================

  // Standard CSS named colors lookup (subset + complete W3C 148 colors via canvas fallback)
  const NAMED_COLORS_CACHE = new Map();
  const parserCanvas = document.createElement('canvas');
  parserCanvas.width = 1;
  parserCanvas.height = 1;
  const parserCtx = parserCanvas.getContext('2d');

  const IGNORED_KEYWORDS = new Set([
    'none', 'transparent', 'currentcolor', 'inherit', 'initial', 'unset', 'context-fill', 'context-stroke'
  ]);

  /**
   * Parses any valid CSS color string (#RGB, #RRGGBB, #RRGGBBAA, rgb(), rgba(), hsl(), hsla(), named)
   * into normalized { r, g, b, a, hex, hexAlpha } or returns null if non-color / url().
   */
  function parseColor(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const str = raw.trim();
    if (!str) return null;
    const lower = str.toLowerCase();
    if (IGNORED_KEYWORDS.has(lower) || lower.startsWith('url(') || lower.startsWith('var(')) {
      return null;
    }

    // Fast path: Hex (#RGB, #RGBA, #RRGGBB, #RRGGBBAA)
    if (lower.startsWith('#')) {
      const hexBody = lower.slice(1);
      if (/^[0-9a-f]{3}$/.test(hexBody)) {
        const r = parseInt(hexBody[0] + hexBody[0], 16);
        const g = parseInt(hexBody[1] + hexBody[1], 16);
        const b = parseInt(hexBody[2] + hexBody[2], 16);
        return buildColorObj(r, g, b, 1);
      }
      if (/^[0-9a-f]{4}$/.test(hexBody)) {
        const r = parseInt(hexBody[0] + hexBody[0], 16);
        const g = parseInt(hexBody[1] + hexBody[1], 16);
        const b = parseInt(hexBody[2] + hexBody[2], 16);
        const a = parseInt(hexBody[3] + hexBody[3], 16) / 255;
        return buildColorObj(r, g, b, a);
      }
      if (/^[0-9a-f]{6}$/.test(hexBody)) {
        const r = parseInt(hexBody.slice(0, 2), 16);
        const g = parseInt(hexBody.slice(2, 4), 16);
        const b = parseInt(hexBody.slice(4, 6), 16);
        return buildColorObj(r, g, b, 1);
      }
      if (/^[0-9a-f]{8}$/.test(hexBody)) {
        const r = parseInt(hexBody.slice(0, 2), 16);
        const g = parseInt(hexBody.slice(2, 4), 16);
        const b = parseInt(hexBody.slice(4, 6), 16);
        const a = parseInt(hexBody.slice(6, 8), 16) / 255;
        return buildColorObj(r, g, b, a);
      }
      return null;
    }

    // Fast path: rgb() / rgba()
    const rgbMatch = lower.match(/^rgba?\(\s*([0-9.]+%?)\s*[, ]\s*([0-9.]+%?)\s*[, ]\s*([0-9.]+%?)(?:\s*[,/]\s*([0-9.]+%?))?\s*\)$/);
    if (rgbMatch) {
      const parseChannel = (val) => val.endsWith('%')
        ? Math.round(clamp(parseFloat(val), 0, 100) * 2.55)
        : Math.round(clamp(parseFloat(val), 0, 255));
      const r = parseChannel(rgbMatch[1]);
      const g = parseChannel(rgbMatch[2]);
      const b = parseChannel(rgbMatch[3]);
      let a = 1;
      if (rgbMatch[4] !== undefined) {
        a = rgbMatch[4].endsWith('%')
          ? clamp(parseFloat(rgbMatch[4]) / 100, 0, 1)
          : clamp(parseFloat(rgbMatch[4]), 0, 1);
      }
      return buildColorObj(r, g, b, a);
    }

    // Fast path: hsl() / hsla()
    const hslMatch = lower.match(/^hsla?\(\s*([+-]?[0-9.]+)(deg|rad|turn)?\s*[, ]\s*([0-9.]+)%\s*[, ]\s*([0-9.]+)%(?:\s*[,/]\s*([0-9.]+%?))?\s*\)$/);
    if (hslMatch) {
      let h = parseFloat(hslMatch[1]);
      const unit = hslMatch[2] || 'deg';
      if (unit === 'rad') h = h * (180 / Math.PI);
      if (unit === 'turn') h = h * 360;
      const s = clamp(parseFloat(hslMatch[3]), 0, 100);
      const l = clamp(parseFloat(hslMatch[4]), 0, 100);
      let a = 1;
      if (hslMatch[5] !== undefined) {
        a = hslMatch[5].endsWith('%')
          ? clamp(parseFloat(hslMatch[5]) / 100, 0, 1)
          : clamp(parseFloat(hslMatch[5]), 0, 1);
      }
      const { r, g, b } = hslToRgb(h, s, l);
      return buildColorObj(r, g, b, a);
    }

    // Named CSS colors via deterministic canvas context normalization
    if (/^[a-z]+$/.test(lower)) {
      if (NAMED_COLORS_CACHE.has(lower)) {
        return NAMED_COLORS_CACHE.get(lower);
      }
      parserCtx.fillStyle = '#010203';
      parserCtx.fillStyle = lower;
      const normalized = parserCtx.fillStyle;
      if (normalized === '#010203' && lower !== 'black') {
        NAMED_COLORS_CACHE.set(lower, null);
        return null;
      }
      const parsed = parseColor(normalized);
      NAMED_COLORS_CACHE.set(lower, parsed);
      return parsed;
    }

    return null;
  }

  function buildColorObj(r, g, b, a = 1) {
    r = Math.round(clamp(r, 0, 255));
    g = Math.round(clamp(g, 0, 255));
    b = Math.round(clamp(b, 0, 255));
    a = Math.round(clamp(a, 0, 1) * 1000) / 1000;
    const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    const hsl = rgbToHsl(r, g, b);
    return { r, g, b, a, hex, hsl };
  }

  function formatColorOutput(colorObj) {
    if (colorObj.a >= 0.999) return colorObj.hex;
    return `rgba(${colorObj.r}, ${colorObj.g}, ${colorObj.b}, ${colorObj.a})`;
  }

  function clamp(val, min, max) {
    return Math.min(max, Math.max(min, val));
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h *= 60;
    }
    return {
      h: Math.round(h * 10) / 10,
      s: Math.round(s * 1000) / 10,
      l: Math.round(l * 1000) / 10
    };
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = clamp(s, 0, 100) / 100;
    l = clamp(l, 0, 100) / 100;

    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r1 = 0, g1 = 0, b1 = 0;

    if (h < 60) { r1 = c; g1 = x; b1 = 0; }
    else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
    else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
    else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
    else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
    else { r1 = c; g1 = 0; b1 = x; }

    return {
      r: Math.round((r1 + m) * 255),
      g: Math.round((g1 + m) * 255),
      b: Math.round((b1 + m) * 255)
    };
  }

  // Convert sRGB to CIELAB (D65) for perceptually accurate brand color nearest-neighbor matching
  function rgbToLab(r, g, b) {
    let sr = r / 255, sg = g / 255, sb = b / 255;
    sr = sr > 0.04045 ? Math.pow((sr + 0.055) / 1.055, 2.4) : sr / 12.92;
    sg = sg > 0.04045 ? Math.pow((sg + 0.055) / 1.055, 2.4) : sg / 12.92;
    sb = sb > 0.04045 ? Math.pow((sb + 0.055) / 1.055, 2.4) : sb / 12.92;

    let x = (sr * 0.4124564 + sg * 0.3575761 + sb * 0.1804375) / 0.95047;
    let y = (sr * 0.2126729 + sg * 0.7151522 + sb * 0.0721750) / 1.00000;
    let z = (sr * 0.0193339 + sg * 0.1191920 + sb * 0.9503041) / 1.08883;

    const f = (t) => t > 0.008856 ? Math.cbrt(t) : (7.787 * t) + (16 / 116);
    x = f(x); y = f(y); z = f(z);

    return {
      L: (116 * y) - 16,
      a: 500 * (x - y),
      b: 200 * (y - z)
    };
  }

  function deltaE76(c1, c2) {
    const lab1 = rgbToLab(c1.r, c1.g, c1.b);
    const lab2 = rgbToLab(c2.r, c2.g, c2.b);
    const dL = lab1.L - lab2.L;
    const da = lab1.a - lab2.a;
    const db = lab1.b - lab2.b;
    return Math.sqrt(dL * dL + da * da + db * db);
  }

  // ============================================================================
  // 2. APPLICATION STATE & PIPELINE ARCHITECTURE
  // ============================================================================

  const COLOR_ATTRS = ['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color'];
  const SHAPE_TAGS = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'text']);

  const state = {
    fileName: 'demo-illustration.svg',
    originalSvgText: '',
    history: [],        // Array of { svgText: string, label: string }
    historyIndex: -1,
    viewMode: 'after',  // 'after' | 'before' | 'split'
    holdingOriginal: false,
    zoom: 1,
    lightBackdrop: false,
    activeTab: 'hsl',   // 'hsl' | 'palette' | 'brand'
    hslAxis: 'h',       // 'h' | 's' | 'l'
    hslDelta: 0,
    selectedHexes: new Set(),
    brandPalette: [],   // Array of parsed ColorObj
    brandAssignments: new Map(), // sourceHex -> targetBrandHex
    telemetry: {
      colors: new Map(), // hex -> { colorObj, count }
      shapes: [],        // Array of { tag, id, colors: string[] }
      totalRefs: 0
    }
  };

  // ============================================================================
  // 3. SVG PARSING, TRAVERSAL & MUTATION ENGINE
  // ============================================================================

  function parseSvgDocument(svgText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
      throw new Error('Invalid SVG XML structure.');
    }
    return doc;
  }

  function serializeSvgDocument(doc) {
    const serializer = new XMLSerializer();
    return serializer.serializeToString(doc.documentElement);
  }

  /**
   * Walks every element and `<style>` block in an SVG document.
   * If `transformFn(colorObj)` is provided, mutates matching color values in place.
   * Always returns rich telemetry (unique colors, usage counts, shapes & colors per shape).
   */
  function processSvg(svgText, transformFn = null) {
    const doc = parseSvgDocument(svgText);
    const root = doc.documentElement;

    const colorMap = new Map();
    const shapes = [];
    let totalRefs = 0;

    function recordColor(colorObj, shapeColorSet) {
      totalRefs++;
      if (shapeColorSet) shapeColorSet.add(colorObj.hex);
      if (!colorMap.has(colorObj.hex)) {
        colorMap.set(colorObj.hex, { colorObj, count: 1 });
      } else {
        colorMap.get(colorObj.hex).count++;
      }
    }

    // 1. Inspect / Transform <style> blocks
    const styleEls = root.querySelectorAll('style');
    styleEls.forEach(styleEl => {
      const css = styleEl.textContent || '';
      const updatedCss = css.replace(
        /(fill|stroke|stop-color|flood-color|lighting-color|color)\s*:\s*([^;}{]+)/gi,
        (match, prop, val) => {
          const parsed = parseColor(val);
          if (!parsed) return match;
          const finalColor = transformFn ? transformFn(parsed) : parsed;
          recordColor(finalColor, null);
          return `${prop}: ${formatColorOutput(finalColor)}`;
        }
      );
      if (transformFn) {
        styleEl.textContent = updatedCss;
      }
    });

    // 2. Traverse all DOM elements
    const allElements = [root, ...root.querySelectorAll('*')];
    allElements.forEach((el, idx) => {
      const tag = el.tagName.toLowerCase();
      const isShape = SHAPE_TAGS.has(tag);
      const shapeColorSet = isShape ? new Set() : null;

      // Check direct presentation attributes
      COLOR_ATTRS.forEach(attr => {
        if (el.hasAttribute(attr)) {
          const rawVal = el.getAttribute(attr);
          const parsed = parseColor(rawVal);
          if (parsed) {
            const finalColor = transformFn ? transformFn(parsed) : parsed;
            recordColor(finalColor, shapeColorSet);
            if (transformFn) {
              el.setAttribute(attr, formatColorOutput(finalColor));
            }
          }
        }
      });

      // Check inline style="..." declarations
      if (el.hasAttribute('style')) {
        const styleStr = el.getAttribute('style');
        const declarations = styleStr.split(';');
        let styleChanged = false;

        const newDeclarations = declarations.map(decl => {
          const colonIdx = decl.indexOf(':');
          if (colonIdx === -1) return decl;
          const prop = decl.slice(0, colonIdx).trim();
          const val = decl.slice(colonIdx + 1).trim();
          if (COLOR_ATTRS.includes(prop.toLowerCase())) {
            const parsed = parseColor(val);
            if (parsed) {
              const finalColor = transformFn ? transformFn(parsed) : parsed;
              recordColor(finalColor, shapeColorSet);
              if (transformFn) {
                styleChanged = true;
                return `${prop}: ${formatColorOutput(finalColor)}`;
              }
            }
          }
          return decl;
        });

        if (transformFn && styleChanged) {
          el.setAttribute('style', newDeclarations.join('; '));
        }
      }

      if (isShape) {
        shapes.push({
          tag,
          id: el.getAttribute('id') || `#${idx + 1}`,
          colors: Array.from(shapeColorSet)
        });
      }
    });

    return {
      svgText: transformFn ? serializeSvgDocument(doc) : svgText,
      telemetry: {
        colors: colorMap,
        shapes,
        totalRefs
      }
    };
  }

  // ============================================================================
  // 4. HISTORY & STATE MANAGEMENT
  // ============================================================================

  function loadNewSvg(svgText, fileName = 'vector.svg') {
    try {
      const analysis = processSvg(svgText, null);
      state.fileName = fileName;
      state.originalSvgText = analysis.svgText;
      state.history = [{ svgText: analysis.svgText, label: 'Original SVG' }];
      state.historyIndex = 0;
      state.hslDelta = 0;
      state.selectedHexes.clear();
      state.brandAssignments.clear();
      document.getElementById('hslSlider').value = 0;
      updateHslLabels();

      recomputeBrandRecommendations();
      syncAllUI();
      showToast(`Loaded "${fileName}" (${analysis.telemetry.colors.size} unique colors)`);
    } catch (err) {
      showToast(`Error: ${err.message}`);
    }
  }

  function commitPipelineStep(newSvgText, label) {
    // Truncate any redo steps ahead of current index
    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push({ svgText: newSvgText, label });
    state.historyIndex = state.history.length - 1;
    state.hslDelta = 0;
    document.getElementById('hslSlider').value = 0;
    updateHslLabels();
    state.selectedHexes.clear();

    recomputeBrandRecommendations();
    syncAllUI();
    showToast(`Applied: ${label}`);
  }

  function getCurrentCommittedSvg() {
    if (state.historyIndex < 0) return '';
    return state.history[state.historyIndex].svgText;
  }

  /**
   * Computes live preview SVG (including unapplied HSL slider preview if active).
   */
  function getLivePreviewSvg() {
    const baseSvg = getCurrentCommittedSvg();
    if (!baseSvg) return '';

    if (state.activeTab === 'hsl' && state.hslDelta !== 0) {
      return processSvg(baseSvg, (c) => applySingleAxisHsl(c, state.hslAxis, state.hslDelta)).svgText;
    }
    return baseSvg;
  }

  function applySingleAxisHsl(colorObj, axis, delta) {
    let { h, s, l } = colorObj.hsl;
    if (axis === 'h') {
      h = (h + delta + 360) % 360;
    } else if (axis === 's') {
      s = clamp(s + delta, 0, 100);
    } else if (axis === 'l') {
      l = clamp(l + delta, 0, 100);
    }
    const { r, g, b } = hslToRgb(h, s, l);
    return buildColorObj(r, g, b, colorObj.a);
  }

  // ============================================================================
  // 5. UI RENDERING & SYNCHRONIZATION
  // ============================================================================

  function syncAllUI() {
    const hasSvg = state.historyIndex >= 0;
    const liveSvg = getLivePreviewSvg();

    // Update Header Buttons
    document.getElementById('btnUndo').disabled = state.historyIndex <= 0;
    document.getElementById('btnRedo').disabled = state.historyIndex >= state.history.length - 1;
    document.getElementById('btnReset').disabled = state.historyIndex <= 0;
    document.getElementById('btnDownload').disabled = !hasSvg;
    document.getElementById('btnApplyHsl').disabled = !hasSvg || state.hslDelta === 0;
    document.getElementById('btnApplyBrand').disabled = !hasSvg || state.brandPalette.length === 0;

    if (!hasSvg) return;

    // Analyze live SVG for telemetry & lists
    const { telemetry } = processSvg(liveSvg, null);
    state.telemetry = telemetry;

    // 1. Update KPI Telemetry
    document.getElementById('statUniqueColors').textContent = telemetry.colors.size;
    document.getElementById('statTotalPaths').textContent = telemetry.shapes.length;
    document.getElementById('statColorRefs').textContent = telemetry.totalRefs;

    // 2. Render Colors per Path list
    renderPathBreakdown(telemetry.shapes);

    // 3. Render Viewport Preview
    renderViewport(state.originalSvgText, liveSvg);

    // 4. Render Palette Inspector (Mode B)
    renderPaletteList(telemetry.colors);

    // 5. Render Brand Mapping Table (Mode C)
    renderBrandMappingList(telemetry.colors);

    // 6. Render History Stack
    renderHistoryList();

    // Status bar
    document.getElementById('fileInfoLabel').textContent =
      `${state.fileName} • ${telemetry.colors.size} colors across ${telemetry.shapes.length} shapes`;
    document.getElementById('pipelineStepLabel').textContent =
      `Step ${state.historyIndex} of ${state.history.length - 1}`;
  }

  function renderViewport(originalSvg, modifiedSvg) {
    const singleEl = document.getElementById('singlePreview');
    const splitEl = document.getElementById('splitPreview');

    const effectiveMode = state.holdingOriginal ? 'before' : state.viewMode;

    if (effectiveMode === 'split') {
      singleEl.style.display = 'none';
      splitEl.style.display = 'grid';
      document.getElementById('splitBeforeSlot').innerHTML = originalSvg;
      document.getElementById('splitAfterSlot').innerHTML = modifiedSvg;
      applyZoomTransform();
    } else {
      splitEl.style.display = 'none';
      singleEl.style.display = 'flex';
      singleEl.innerHTML = effectiveMode === 'before' ? originalSvg : modifiedSvg;
      applyZoomTransform();
    }
  }

  function applyZoomTransform() {
    const targets = document.querySelectorAll('.svg-wrapper');
    targets.forEach(el => {
      el.style.transform = `scale(${state.zoom})`;
    });
    document.getElementById('zoomLabel').textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function renderPathBreakdown(shapes) {
    const listEl = document.getElementById('pathList');
    if (shapes.length === 0) {
      listEl.innerHTML = `<div style="font-size:0.78rem; color:var(--text-muted); text-align:center; padding:1rem;">No vector shape elements detected.</div>`;
      return;
    }

    const fragment = document.createDocumentFragment();
    shapes.forEach((shape) => {
      const row = document.createElement('div');
      row.className = 'path-item';

      const meta = document.createElement('div');
      meta.className = 'path-meta';
      meta.innerHTML = `
        <span class="path-tag">&lt;${shape.tag}&gt; <span style="color:var(--text-secondary); font-weight:400;">${escapeHtml(shape.id)}</span></span>
        <span class="path-sub">${shape.colors.length} distinct color${shape.colors.length === 1 ? '' : 's'}</span>
      `;

      const swatches = document.createElement('div');
      swatches.className = 'mini-swatches';
      shape.colors.slice(0, 6).forEach(hex => {
        const dot = document.createElement('span');
        dot.className = 'mini-dot';
        dot.style.background = hex;
        dot.title = hex;
        swatches.appendChild(dot);
      });
      if (shape.colors.length > 6) {
        const more = document.createElement('span');
        more.style.fontSize = '0.68rem';
        more.style.color = 'var(--text-muted)';
        more.textContent = `+${shape.colors.length - 6}`;
        swatches.appendChild(more);
      }

      row.appendChild(meta);
      row.appendChild(swatches);
      fragment.appendChild(row);
    });

    listEl.innerHTML = '';
    listEl.appendChild(fragment);
  }

  function renderPaletteList(colorMap) {
    const listEl = document.getElementById('paletteList');
    const entries = Array.from(colorMap.values()).sort((a, b) => b.count - a.count);

    // Prune stale selections
    for (const hex of Array.from(state.selectedHexes)) {
      if (!colorMap.has(hex)) state.selectedHexes.delete(hex);
    }
    updateMergeButtonState();

    if (entries.length === 0) {
      listEl.innerHTML = `<div style="font-size:0.78rem; color:var(--text-muted); text-align:center; padding:1rem;">No explicit colors found in SVG.</div>`;
      return;
    }

    const fragment = document.createDocumentFragment();
    entries.forEach(({ colorObj, count }) => {
      const row = document.createElement('div');
      row.className = 'palette-row';

      // Checkbox for multi-select merge
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = state.selectedHexes.has(colorObj.hex);
      cb.title = 'Select color to merge/flatten';
      cb.addEventListener('change', () => {
        if (cb.checked) state.selectedHexes.add(colorObj.hex);
        else state.selectedHexes.delete(colorObj.hex);
        updateMergeButtonState();
      });

      // Swatch preview
      const swatch = document.createElement('div');
      swatch.className = 'swatch-box';
      swatch.style.background = colorObj.hex;

      // Hex + HSL readout
      const info = document.createElement('div');
      info.className = 'color-info';
      info.innerHTML = `
        <div class="color-hex">${colorObj.hex} <span class="badge-count">${count}×</span></div>
        <div class="color-hsl">H:${Math.round(colorObj.hsl.h)}° S:${Math.round(colorObj.hsl.s)}% L:${Math.round(colorObj.hsl.l)}%</div>
      `;

      // Direct Color Remap Picker
      const picker = document.createElement('input');
      picker.type = 'color';
      picker.value = colorObj.hex;
      picker.title = `Replace ${colorObj.hex} with new color`;
      picker.addEventListener('change', (e) => {
        const targetColor = parseColor(e.target.value);
        if (!targetColor || targetColor.hex === colorObj.hex) return;
        const baseSvg = getCurrentCommittedSvg();
        const res = processSvg(baseSvg, (c) => c.hex === colorObj.hex ? buildColorObj(targetColor.r, targetColor.g, targetColor.b, c.a) : c);
        commitPipelineStep(res.svgText, `Remap ${colorObj.hex} → ${targetColor.hex}`);
      });

      row.appendChild(cb);
      row.appendChild(swatch);
      row.appendChild(info);
      row.appendChild(picker);
      fragment.appendChild(row);
    });

    listEl.innerHTML = '';
    listEl.appendChild(fragment);
  }

  function updateMergeButtonState() {
    const n = state.selectedHexes.size;
    document.getElementById('selectedCountLabel').textContent = `${n} selected`;
    document.getElementById('btnMergeSelected').disabled = n < 2;
  }

  // ============================================================================
  // 6. BRAND PALETTE QUANTIZATION & INTERACTIVE OVERRIDE TABLE
  // ============================================================================

  function parseBrandPaletteInput() {
    const raw = document.getElementById('brandInput').value;
    // Match hex tokens or rgb(...) / hsl(...) tokens or comma-separated tokens
    const tokens = raw.match(/(?:#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|[a-zA-Z]+)/g) || [];
    const unique = new Map();
    tokens.forEach(tok => {
      const parsed = parseColor(tok);
      if (parsed && !unique.has(parsed.hex)) {
        unique.set(parsed.hex, parsed);
      }
    });
    state.brandPalette = Array.from(unique.values());
    renderBrandChips();
    recomputeBrandRecommendations();
    if (state.historyIndex >= 0) {
      renderBrandMappingList(state.telemetry.colors);
      document.getElementById('btnApplyBrand').disabled = state.brandPalette.length === 0;
    }
  }

  function renderBrandChips() {
    const container = document.getElementById('parsedBrandChips');
    container.innerHTML = '';
    if (state.brandPalette.length === 0) {
      container.innerHTML = `<span style="font-size:0.72rem; color:var(--danger);">Enter at least one valid Hex or RGB color.</span>`;
      return;
    }
    state.brandPalette.forEach(c => {
      const chip = document.createElement('span');
      chip.className = 'brand-chip';
      chip.innerHTML = `<span style="width:10px;height:10px;border-radius:50%;background:${c.hex};border:1px solid rgba(255,255,255,0.3);"></span>${c.hex}`;
      container.appendChild(chip);
    });
  }

  function findNearestBrandColor(sourceColor) {
    if (state.brandPalette.length === 0) return null;
    let best = state.brandPalette[0];
    let bestDist = Infinity;
    for (const candidate of state.brandPalette) {
      const dist = deltaE76(sourceColor, candidate);
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }
    return best;
  }

  function recomputeBrandRecommendations() {
    if (state.brandPalette.length === 0 || state.historyIndex < 0) return;
    const { telemetry } = processSvg(getCurrentCommittedSvg(), null);
    state.brandAssignments.clear();
    telemetry.colors.forEach(({ colorObj }, hex) => {
      const nearest = findNearestBrandColor(colorObj);
      if (nearest) {
        state.brandAssignments.set(hex, nearest.hex);
      }
    });
  }

  function renderBrandMappingList(colorMap) {
    const container = document.getElementById('brandMappingList');
    if (colorMap.size === 0 || state.brandPalette.length === 0) {
      container.innerHTML = `<div style="font-size:0.78rem; color:var(--text-muted); text-align:center; padding:1rem;">Load an SVG and define brand colors above.</div>`;
      return;
    }

    // Sort source colors by Lightness (darkest to lightest) so shading ramps are easy to inspect
    const entries = Array.from(colorMap.values()).sort((a, b) => a.colorObj.hsl.l - b.colorObj.hsl.l);
    const fragment = document.createDocumentFragment();

    entries.forEach(({ colorObj, count }) => {
      const nearest = findNearestBrandColor(colorObj);
      if (!state.brandAssignments.has(colorObj.hex) && nearest) {
        state.brandAssignments.set(colorObj.hex, nearest.hex);
      }
      const assignedHex = state.brandAssignments.get(colorObj.hex) || state.brandPalette[0].hex;

      const row = document.createElement('div');
      row.className = 'mapping-row';

      // Source swatch + info
      const srcDiv = document.createElement('div');
      srcDiv.className = 'mapping-src';
      srcDiv.innerHTML = `
        <span class="swatch-box" style="width:20px;height:20px;background:${colorObj.hex};"></span>
        <div style="min-width:0;">
          <div style="font-family:var(--font-mono); font-size:0.74rem; font-weight:600;">${colorObj.hex}</div>
          <div style="font-size:0.65rem; color:var(--text-muted);">L:${Math.round(colorObj.hsl.l)}% • ${count}×</div>
        </div>
      `;

      const arrow = document.createElement('div');
      arrow.style.color = 'var(--text-muted)';
      arrow.style.textAlign = 'center';
      arrow.textContent = '→';

      // Target brand color selector with live swatch
      const targetWrap = document.createElement('div');
      targetWrap.className = 'mapping-target-wrap';

      const targetSwatch = document.createElement('span');
      targetSwatch.className = 'swatch-box';
      targetSwatch.style.width = '20px';
      targetSwatch.style.height = '20px';
      targetSwatch.style.background = assignedHex;

      const select = document.createElement('select');
      select.style.padding = '0.3rem 0.4rem';
      select.style.fontSize = '0.72rem';
      state.brandPalette.forEach(bColor => {
        const opt = document.createElement('option');
        opt.value = bColor.hex;
        const isMathMatch = nearest && nearest.hex === bColor.hex;
        opt.textContent = `${bColor.hex}${isMathMatch ? ' ★' : ''}`;
        if (bColor.hex === assignedHex) opt.selected = true;
        select.appendChild(opt);
      });

      select.addEventListener('change', (e) => {
        state.brandAssignments.set(colorObj.hex, e.target.value);
        targetSwatch.style.background = e.target.value;
      });

      targetWrap.appendChild(targetSwatch);
      targetWrap.appendChild(select);

      row.appendChild(srcDiv);
      row.appendChild(arrow);
      row.appendChild(targetWrap);
      fragment.appendChild(row);
    });

    container.innerHTML = '';
    container.appendChild(fragment);
  }

  function renderHistoryList() {
    const list = document.getElementById('historyList');
    list.innerHTML = '';
    state.history.forEach((step, idx) => {
      const item = document.createElement('div');
      item.className = 'history-item' + (idx === state.historyIndex ? ' current' : '');
      item.innerHTML = `
        <span>${idx}. ${escapeHtml(step.label)}</span>
        <span style="font-family:var(--font-mono); font-size:0.68rem;">${idx === state.historyIndex ? 'Active' : 'Jump'}</span>
      `;
      item.addEventListener('click', () => {
        state.historyIndex = idx;
        state.hslDelta = 0;
        document.getElementById('hslSlider').value = 0;
        updateHslLabels();
        recomputeBrandRecommendations();
        syncAllUI();
      });
      list.appendChild(item);
    });
    list.scrollTop = list.scrollHeight;
  }

  // ============================================================================
  // 7. EVENT LISTENERS & INTERACTIONS
  // ============================================================================

  function updateHslLabels() {
    const slider = document.getElementById('hslSlider');
    const axisLabel = document.getElementById('hslAxisLabel');
    const valLabel = document.getElementById('hslValueLabel');
    const formulaDesc = document.getElementById('formulaDesc');

    if (state.hslAxis === 'h') {
      slider.min = -180; slider.max = 180;
      axisLabel.textContent = 'Hue Rotation (ΔH)';
      valLabel.textContent = `${state.hslDelta > 0 ? '+' : ''}${state.hslDelta}°`;
      formulaDesc.innerHTML = `H' = (H + ${state.hslDelta} + 360) mod 360<br>S' = S (locked), L' = L (locked)`;
    } else if (state.hslAxis === 's') {
      slider.min = -100; slider.max = 100;
      axisLabel.textContent = 'Saturation Shift (ΔS)';
      valLabel.textContent = `${state.hslDelta > 0 ? '+' : ''}${state.hslDelta}%`;
      formulaDesc.innerHTML = `S' = clamp(S + ${state.hslDelta}, 0%, 100%)<br>H' = H (locked), L' = L (locked)`;
    } else {
      slider.min = -100; slider.max = 100;
      axisLabel.textContent = 'Lightness Shift (ΔL)';
      valLabel.textContent = `${state.hslDelta > 0 ? '+' : ''}${state.hslDelta}%`;
      formulaDesc.innerHTML = `L' = clamp(L + ${state.hslDelta}, 0%, 100%)<br>H' = H (locked), S' = S (locked)`;
    }
  }

  // File Drop & Upload
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) readSvgFile(file);
  });
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) readSvgFile(file);
  });

  function readSvgFile(file) {
    const reader = new FileReader();
    reader.onload = (evt) => loadNewSvg(evt.target.result, file.name);
    reader.readAsText(file);
  }

  // Header Undo / Redo / Reset / Download
  document.getElementById('btnUndo').addEventListener('click', () => {
    if (state.historyIndex > 0) {
      state.historyIndex--;
      state.hslDelta = 0;
      document.getElementById('hslSlider').value = 0;
      updateHslLabels();
      recomputeBrandRecommendations();
      syncAllUI();
    }
  });

  document.getElementById('btnRedo').addEventListener('click', () => {
    if (state.historyIndex < state.history.length - 1) {
      state.historyIndex++;
      state.hslDelta = 0;
      document.getElementById('hslSlider').value = 0;
      updateHslLabels();
      recomputeBrandRecommendations();
      syncAllUI();
    }
  });

  document.getElementById('btnReset').addEventListener('click', () => {
    if (state.historyIndex > 0) {
      commitPipelineStep(state.originalSvgText, 'Reset to Original');
    }
  });

  document.getElementById('btnDownload').addEventListener('click', () => {
    const svgOut = getLivePreviewSvg();
    if (!svgOut) return;
    const blob = new Blob([svgOut], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const baseName = state.fileName.replace(/\.svg$/i, '');
    a.href = url;
    a.download = `${baseName}-modified.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Exported ${baseName}-modified.svg`);
  });

  // Viewport Before / After / Split & Zoom
  document.getElementById('viewAfter').addEventListener('click', () => setViewMode('after'));
  document.getElementById('viewBefore').addEventListener('click', () => setViewMode('before'));
  document.getElementById('viewSplit').addEventListener('click', () => setViewMode('split'));

  function setViewMode(mode) {
    state.viewMode = mode;
    document.getElementById('viewAfter').classList.toggle('active', mode === 'after');
    document.getElementById('viewBefore').classList.toggle('active', mode === 'before');
    document.getElementById('viewSplit').classList.toggle('active', mode === 'split');
    if (state.historyIndex >= 0) {
      renderViewport(state.originalSvgText, getLivePreviewSvg());
    }
  }

  const btnHoldCompare = document.getElementById('btnHoldCompare');
  const startHold = () => {
    if (state.historyIndex < 0) return;
    state.holdingOriginal = true;
    renderViewport(state.originalSvgText, getLivePreviewSvg());
  };
  const endHold = () => {
    if (!state.holdingOriginal) return;
    state.holdingOriginal = false;
    renderViewport(state.originalSvgText, getLivePreviewSvg());
  };
  btnHoldCompare.addEventListener('mousedown', startHold);
  btnHoldCompare.addEventListener('touchstart', (e) => { e.preventDefault(); startHold(); });
  window.addEventListener('mouseup', endHold);
  window.addEventListener('touchend', endHold);

  document.getElementById('btnBgToggle').addEventListener('click', () => {
    state.lightBackdrop = !state.lightBackdrop;
    document.getElementById('canvasStage').classList.toggle('bg-light', state.lightBackdrop);
  });

  document.getElementById('btnZoomIn').addEventListener('click', () => {
    state.zoom = clamp(state.zoom + 0.25, 0.25, 4);
    applyZoomTransform();
  });
  document.getElementById('btnZoomOut').addEventListener('click', () => {
    state.zoom = clamp(state.zoom - 0.25, 0.25, 4);
    applyZoomTransform();
  });
  document.getElementById('btnZoomFit').addEventListener('click', () => {
    state.zoom = 1;
    applyZoomTransform();
  });

  // Mode Tabs
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.activeTab = tab.dataset.tab;
      document.querySelectorAll('.mode-pane').forEach(p => p.style.display = 'none');
      document.getElementById(`tab-${state.activeTab}`).style.display = 'block';
      syncAllUI();
    });
  });

  // Mode A: Single-Axis HSL Controls
  document.querySelectorAll('.axis-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.axis-btn').forEach(b => b.classList.remove('active-pill'));
      btn.classList.add('active-pill');
      state.hslAxis = btn.dataset.axis;
      state.hslDelta = 0;
      document.getElementById('hslSlider').value = 0;
      updateHslLabels();
      syncAllUI();
    });
  });

  document.getElementById('hslSlider').addEventListener('input', (e) => {
    state.hslDelta = parseInt(e.target.value, 10);
    updateHslLabels();
    syncAllUI();
  });

  document.getElementById('btnResetSlider').addEventListener('click', () => {
    state.hslDelta = 0;
    document.getElementById('hslSlider').value = 0;
    updateHslLabels();
    syncAllUI();
  });

  document.getElementById('btnApplyHsl').addEventListener('click', () => {
    if (state.historyIndex < 0 || state.hslDelta === 0) return;
    const axisName = state.hslAxis === 'h' ? 'Hue' : state.hslAxis === 's' ? 'Saturation' : 'Lightness';
    const unit = state.hslAxis === 'h' ? '°' : '%';
    const sign = state.hslDelta > 0 ? '+' : '';
    const transformed = getLivePreviewSvg();
    commitPipelineStep(transformed, `${axisName} ${sign}${state.hslDelta}${unit}`);
  });

  // Mode B: Merge Selected Colors
  document.getElementById('btnMergeSelected').addEventListener('click', () => {
    if (state.selectedHexes.size < 2 || state.historyIndex < 0) return;
    const targetHex = document.getElementById('mergeTargetPicker').value;
    const targetColor = parseColor(targetHex);
    if (!targetColor) return;

    const count = state.selectedHexes.size;
    const baseSvg = getCurrentCommittedSvg();
    const res = processSvg(baseSvg, (c) => {
      if (state.selectedHexes.has(c.hex)) {
        return buildColorObj(targetColor.r, targetColor.g, targetColor.b, c.a);
      }
      return c;
    });
    commitPipelineStep(res.svgText, `Merge ${count} colors → ${targetColor.hex}`);
  });

  // Mode C: Brand Quantization
  document.getElementById('brandInput').addEventListener('input', parseBrandPaletteInput);
  document.querySelectorAll('.preset-btn[data-brand]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('brandInput').value = btn.dataset.brand;
      parseBrandPaletteInput();
    });
  });

  document.getElementById('btnAutoRecommend').addEventListener('click', () => {
    recomputeBrandRecommendations();
    if (state.historyIndex >= 0) {
      renderBrandMappingList(state.telemetry.colors);
    }
    showToast('Recalculated nearest perceptual CIELAB matches');
  });

  document.getElementById('btnApplyBrand').addEventListener('click', () => {
    if (state.historyIndex < 0 || state.brandPalette.length === 0) return;
    const baseSvg = getCurrentCommittedSvg();
    const res = processSvg(baseSvg, (c) => {
      const assignedHex = state.brandAssignments.get(c.hex);
      if (!assignedHex) return c;
      const target = parseColor(assignedHex);
      return target ? buildColorObj(target.r, target.g, target.b, c.a) : c;
    });
    commitPipelineStep(res.svgText, `Brand Quantize (${state.brandPalette.length} colors)`);
  });

  // Built-in Rich Multi-Shade Demo SVG
  const DEMO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 440" width="640" height="440">
    <defs>
      <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1E1B4B"/>
        <stop offset="55%" stop-color="#4338CA"/>
        <stop offset="100%" stop-color="#F472B6"/>
      </linearGradient>
    </defs>
    <!-- Sky & Sun -->
    <rect id="sky-backdrop" x="0" y="0" width="640" height="440" rx="18" fill="url(#skyGrad)"/>
    <circle id="sun-halo" cx="465" cy="135" r="74" fill="#FDE68A" opacity="0.28"/>
    <circle id="sun-core" cx="465" cy="135" r="48" fill="#FBBF24"/>
    <!-- Far Mountain Range (3-tone shading) -->
    <polygon id="mountain-far-left" points="0,310 140,145 290,310" fill="#312E81"/>
    <polygon id="mountain-far-lit" points="140,145 215,230 165,310 290,310" fill="#4F46E5"/>
    <polygon id="mountain-far-right" points="210,310 385,165 560,310" fill="#3730A3"/>
    <polygon id="mountain-right-lit" points="385,165 460,245 410,310 560,310" fill="#6366F1"/>
    <!-- Foreground Hills -->
    <path id="hill-mid" d="M0,305 Q170,245 340,300 T640,285 L640,440 L0,440 Z" fill="#0F766E"/>
    <path id="hill-front" d="M0,345 Q220,305 420,355 T640,335 L640,440 L0,440 Z" fill="#115E59"/>
    <!-- Geometric Observatory Building -->
    <rect id="tower-shadow" x="155" y="220" width="76" height="125" rx="4" fill="#1E293B"/>
    <rect id="tower-lit" x="195" y="220" width="36" height="125" rx="4" fill="#334155"/>
    <path id="dome-shadow" d="M150,222 A43,43 0 0,1 236,222 Z" fill="#E2E8F0"/>
    <path id="dome-highlight" d="M193,179 A43,43 0 0,1 236,222 L193,222 Z" fill="#FFFFFF"/>
    <rect id="telescope-slit" x="188" y="184" width="10" height="38" rx="3" fill="#0F172A"/>
    <circle id="window-glow-1" cx="176" cy="256" r="7" fill="#F59E0B"/>
    <circle id="window-glow-2" cx="212" cy="256" r="7" fill="#FCD34D"/>
    <!-- Stylized Pine Trees -->
    <polygon id="tree-1-dark" points="85,355 110,275 135,355" fill="#064E3B"/>
    <polygon id="tree-1-lit" points="110,275 123,315 110,355 135,355" fill="#10B981"/>
    <polygon id="tree-2-dark" points="505,365 535,270 565,365" fill="#065F46"/>
    <polygon id="tree-2-lit" points="535,270 550,318 535,365 565,365" fill="#34D399"/>
    <!-- Accent Trail -->
    <path id="river-ribbon" d="M265,335 C315,355 245,395 335,440 L395,440 C310,395 365,355 295,335 Z" fill="#38BDF8"/>
  </svg>`;

  document.getElementById('btnLoadDemo').addEventListener('click', () => {
    loadNewSvg(DEMO_SVG, 'observatory-landscape.svg');
  });

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  let toastTimer = null;
  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  // Initialize default brand palette chips & load demo on boot for instant exploration
  parseBrandPaletteInput();
  loadNewSvg(DEMO_SVG, 'observatory-landscape.svg');
})();
