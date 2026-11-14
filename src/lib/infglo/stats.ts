/** InfGlo Analytics — statistiques de base, sans dépendance, robustes aux séries courtes/vides. */
export const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function mean(a: number[]): number { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
export function variance(a: number[]): number { if (a.length < 2) return 0; const m = mean(a); return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1); }
export function stdDev(a: number[]): number { return Math.sqrt(variance(a)); }

export function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y); const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}
/** Médiane des écarts absolus (robuste aux valeurs extrêmes). */
export function mad(a: number[]): number { const m = median(a); return median(a.map((x) => Math.abs(x - m))); }

/** Percentile p∈[0,100], interpolation linéaire. */
export function percentile(a: number[], p: number): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y); const r = (Math.min(100, Math.max(0, p)) / 100) * (s.length - 1);
  const lo = Math.floor(r), hi = Math.ceil(r);
  return s[lo] + (s[hi] - s[lo]) * (r - lo);
}

export function movingAverage(a: number[], window: number): number[] {
  const w = Math.max(1, Math.floor(window)); const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < a.length; i++) { sum += a[i]; if (i >= w) sum -= a[i - w]; out.push(sum / Math.min(i + 1, w)); }
  return out;
}

export interface Regression { slope: number; intercept: number; r2: number }
/** Régression linéaire (x = 0..n-1). */
export function linearRegression(y: number[]): Regression {
  const n = y.length; if (n < 2) return { slope: 0, intercept: y[0] ?? 0, r2: 0 };
  const mx = (n - 1) / 2, my = mean(y); let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (i - mx) * (y[i] - my); sxx += (i - mx) ** 2; syy += (y[i] - my) ** 2; }
  const slope = sxx ? sxy / sxx : 0;
  return { slope, intercept: my - slope * mx, r2: sxx && syy ? (sxy * sxy) / (sxx * syy) : 0 };
}

export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length); if (n < 2) return 0;
  const x = a.slice(0, n), y = b.slice(0, n), mx = mean(x), my = mean(y); let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

export type Trend = 'up' | 'down' | 'flat';
/** Tendance : pente significative (|pente| > seuil relatif à l'échelle) ET r² ≥ 0.3. */
export function trend(a: number[], relThreshold = 0.01): Trend {
  if (a.length < 3) return 'flat';
  const r = linearRegression(a); const scale = Math.max(Math.abs(mean(a)), 1e-9);
  if (r.r2 < 0.3 || Math.abs(r.slope) / scale < relThreshold) return 'flat';
  return r.slope > 0 ? 'up' : 'down';
}
