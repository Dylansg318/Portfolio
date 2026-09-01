'use strict';

// Minimal schema for JSON layout profiles: a document is a page geometry plus a
// flat list of positioned elements, exactly one of which is the repeating
// items region. Everything is millimetres at the schema level; the renderer
// converts to printer dots at the edge (mmToDots), so a profile is portable
// across 203/300 dpi hardware.

export const VALID_DOC_TYPES = ['pick_list', 'packing_slip'];

export const ELEMENT_TYPES = [
  'field', 'text', 'barcode', 'line', 'box', 'logo',
  'shipto_block', 'shipfrom_block', 'totals_footer', 'page_footer', 'items_region',
];

export const DEFAULT_PAGE = Object.freeze({
  pageWidthMm: 101.6,   // 4 in
  pageHeightMm: 152.4,  // 6 in
  dpi: 203,             // 8 dpmm thermal
});

// mm -> printer dots. Round to the nearest dot.
export function mmToDots(mm: number, dpi: number): number {
  return Math.round((Number(mm) || 0) * dpi / 25.4);
}

export function validateLayout(layout: any): { ok: boolean; errors: string[] } {
  const errors = [];
  if (!layout || typeof layout !== 'object') return { ok: false, errors: ['layout missing'] };
  if (!VALID_DOC_TYPES.includes(layout.docType)) errors.push(`bad docType: ${layout.docType}`);
  if (layout.schemaVersion !== 1) errors.push(`bad schemaVersion: ${layout.schemaVersion}`);
  if (!Array.isArray(layout.elements)) {
    errors.push('elements must be an array');
    return { ok: errors.length === 0, errors };
  }
  let regionCount = 0;
  for (const [i, el] of layout.elements.entries()) {
    if (!el || !ELEMENT_TYPES.includes(el.type)) { errors.push(`element[${i}] bad type: ${el && el.type}`); continue; }
    if (el.type === 'items_region') regionCount += 1;
    for (const k of ['xMm', 'yMm', 'wMm', 'hMm']) {
      if (typeof el[k] !== 'number' || Number.isNaN(el[k])) errors.push(`element[${i}].${k} must be a number`);
    }
  }
  if (regionCount !== 1) errors.push('exactly one items_region is required in phase 1');
  return { ok: errors.length === 0, errors };
}
