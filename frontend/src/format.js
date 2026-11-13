// Display-only formatting. No scoring logic lives in the frontend.
export function fmt(v, digits = 3) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return 'n/a';
  return Number(v).toFixed(digits);
}

export const METRICS = [
  { key: 'slope', label: 'Slope distribution', field: 'slope_histogram' },
  { key: 'relief', label: 'Relief (P95-P5)', field: 'relief_p95_p05_m' },
  { key: 'variation', label: 'Local height variation', field: 'local_variation_m' },
];

export const SLOPE_BIN_LABELS = ['0-1°', '1-3°', '3-5°', '5-10°', '10-20°', '20-30°', '30-45°', '45-90°'];

export function parentName(parents, id) {
  return parents.find((p) => p.id === id)?.name || id;
}
