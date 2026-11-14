import { mad, mean, median } from './stats';

export interface Anomaly { index: number; value: number; score: number; direction: 'high' | 'low' }

/**
 * Détection par z-score modifié (Iglewicz & Hoaglin) : robuste, ne se laisse pas masquer par les valeurs extrêmes.
 * Seuil usuel 3.5. Repli sur l'écart moyen absolu si MAD = 0 (séries très répétitives).
 */
export function detectAnomalies(series: number[], threshold = 3.5, minSamples = 8): Anomaly[] {
  if (series.length < minSamples) return [];
  const med = median(series); const m = mad(series);
  let denom: number, k: number;
  if (m > 0) { denom = m; k = 0.6745; }
  else { const meanAd = mean(series.map((x) => Math.abs(x - med))); if (meanAd === 0) return []; denom = meanAd; k = 1 / 1.253314; }
  const out: Anomaly[] = [];
  series.forEach((value, index) => {
    const score = (k * (value - med)) / denom;
    if (Math.abs(score) > threshold) out.push({ index, value, score, direction: score > 0 ? 'high' : 'low' });
  });
  return out;
}

export interface StreamResult { anomaly: boolean; score: number; direction?: 'high' | 'low' }

/**
 * Détecteur en flux (EWMA) : O(1) mémoire, adapté au temps réel.
 * Une valeur anormale n'est pas intégrée au modèle (pas de contamination), sauf si elle persiste
 * `adaptAfter` fois de suite (changement de régime légitime).
 */
export class EwmaDetector {
  private mean = 0; private varc = 0; private n = 0; private streak = 0;
  constructor(private readonly alpha = 0.2, private readonly k = 4, private readonly warmup = 8, private readonly adaptAfter = 5) {}

  update(x: number): StreamResult {
    if (this.n === 0) { this.mean = x; this.n = 1; return { anomaly: false, score: 0 }; }
    const sd = Math.sqrt(this.varc);
    // plancher d'écart-type : évite les faux positifs sur une série quasi constante
    const floor = Math.max(sd, Math.abs(this.mean) * 0.02, 1e-9);
    const score = (x - this.mean) / floor;
    const anomaly = this.n >= this.warmup && Math.abs(score) > this.k;
    if (anomaly) { this.streak++; if (this.streak < this.adaptAfter) return { anomaly: true, score, direction: score > 0 ? 'high' : 'low' }; }
    this.streak = 0;
    const diff = x - this.mean, incr = this.alpha * diff;
    this.mean += incr; this.varc = (1 - this.alpha) * (this.varc + diff * incr); this.n++;
    return anomaly ? { anomaly: true, score, direction: score > 0 ? 'high' : 'low' } : { anomaly: false, score };
  }
  get samples() { return this.n; }
}
