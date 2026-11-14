/**
 * Moteur de recommandations (filtrage collaboratif item-item, similarité cosinus).
 * Entrée : paniers = ensembles de services demandés par un même client. Sortie : services suggérés.
 */
export class CoOccurrenceRecommender {
  private freq = new Map<string, number>(); private co = new Map<string, Map<string, number>>();
  fit(baskets: string[][]): this {
    this.freq.clear(); this.co.clear();
    for (const raw of baskets) {
      const b = [...new Set(raw)].slice(0, 50);
      for (const a of b) { this.freq.set(a, (this.freq.get(a) ?? 0) + 1); for (const c of b) if (a !== c) { const m = this.co.get(a) ?? new Map(); m.set(c, (m.get(c) ?? 0) + 1); this.co.set(a, m); } }
    }
    return this;
  }
  recommend(owned: string[], k = 3): { item: string; score: number }[] {
    const have = new Set(owned); const score = new Map<string, number>();
    for (const o of have) for (const [item, n] of this.co.get(o) ?? []) {
      if (have.has(item)) continue;
      score.set(item, (score.get(item) ?? 0) + n / Math.sqrt((this.freq.get(item) ?? 1) * (this.freq.get(o) ?? 1)));
    }
    const ranked = [...score].map(([item, s]) => ({ item, score: s })).sort((a, b) => b.score - a.score || a.item.localeCompare(b.item));
    if (ranked.length) return ranked.slice(0, k);
    // aucun signal collaboratif : repli sur la popularité (utile pour un nouveau client)
    const max = Math.max(1, ...this.freq.values());
    return [...this.freq].filter(([i]) => !have.has(i)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, k).map(([item, n]) => ({ item, score: n / max }));
  }
}
