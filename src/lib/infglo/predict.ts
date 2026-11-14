import { stdDev } from './stats';

export interface ForecastPoint { step: number; value: number; lower: number; upper: number }
export interface Forecast { points: ForecastPoint[]; residualStd: number; level: number; trend: number }

/**
 * InfGlo Predict — lissage exponentiel double (Holt) avec intervalle de confiance ≈ 95 %.
 * Léger, sans entraînement lourd : convient aux séries métier courtes (demandes/jour, inscriptions…).
 * Les modèles ML plus lourds se brancheront ensuite derrière la même interface `forecast()`.
 */
export function forecast(series: number[], horizon = 7, alpha = 0.5, beta = 0.3): Forecast | null {
  if (series.length < 3 || horizon < 1) return null;
  let level = series[0], trendV = series[1] - series[0]; const residuals: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const pred = level + trendV; residuals.push(series[i] - pred);
    const prev = level; level = alpha * series[i] + (1 - alpha) * (level + trendV);
    trendV = beta * (level - prev) + (1 - beta) * trendV;
  }
  const rs = stdDev(residuals);
  const points: ForecastPoint[] = [];
  for (let h = 1; h <= Math.floor(horizon); h++) {
    const value = level + h * trendV; const margin = 1.96 * rs * Math.sqrt(h);
    points.push({ step: h, value, lower: value - margin, upper: value + margin });
  }
  return { points, residualStd: rs, level, trend: trendV };
}
