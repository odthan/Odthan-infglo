import { EwmaDetector } from './anomaly';
import { DecisionEngine, type Rule } from './decision';
import { forecast, type Forecast } from './predict';
import { isNum, trend, type Trend } from './stats';
import type { InfGloContext, InfGloEvent, InfGloModule, ModuleHealth } from './types';

/** Payload attendu pour l'évènement "metric.recorded". */
export interface MetricPayload { name: string; value: number }

/**
 * InfGlo Analytics : écoute "metric.recorded", conserve une fenêtre bornée par métrique,
 * détecte les anomalies en flux et expose tendance + prévision à la demande.
 */
export class AnalyticsModule implements InfGloModule {
  readonly name = 'infglo.analytics'; readonly version = '1.0.0';
  private ctx!: InfGloContext;
  private series = new Map<string, number[]>();
  private detectors = new Map<string, EwmaDetector>();
  private rejected = 0;
  constructor(private readonly opts: { maxPoints?: number; maxMetrics?: number } = {}) {}

  init(ctx: InfGloContext) { this.ctx = ctx; }

  handle(e: InfGloEvent) {
    if (e.type !== 'metric.recorded') return;
    const p = e.payload as Partial<MetricPayload> | null;
    if (!p || typeof p.name !== 'string' || !/^[a-zA-Z0-9_.:-]{1,80}$/.test(p.name) || !isNum(p.value)) { this.rejected++; return; }
    const max = this.opts.maxMetrics ?? 200;
    if (!this.series.has(p.name) && this.series.size >= max) { this.rejected++; return; }   // borne mémoire
    const arr = this.series.get(p.name) ?? []; arr.push(p.value);
    const cap = this.opts.maxPoints ?? 1000; if (arr.length > cap) arr.splice(0, arr.length - cap);
    this.series.set(p.name, arr);
    let d = this.detectors.get(p.name); if (!d) { d = new EwmaDetector(); this.detectors.set(p.name, d); }
    const r = d.update(p.value);
    if (r.anomaly) {
      this.ctx.emitInsight({
        kind: 'anomaly', severity: Math.abs(r.score) > 8 ? 'high' : 'medium', source: e.source,
        title: `Anomalie sur « ${p.name} »`,
        detail: `Valeur ${p.value} ${r.direction === 'high' ? 'anormalement élevée' : 'anormalement basse'} (score ${r.score.toFixed(1)}).`,
        data: { metric: p.name, value: p.value, score: r.score },
      });
    }
  }
  /** Charge un historique (sans émettre d'insight) : entraîne le détecteur pour qu'il soit déjà « chaud ». */
  seed(name: string, values: number[]): void {
    if (!/^[a-zA-Z0-9_.:-]{1,80}$/.test(name)) return;
    const clean = values.filter(isNum); const d = new EwmaDetector();
    clean.forEach((v) => d.update(v));
    this.detectors.set(name, d); this.series.set(name, clean.slice(-(this.opts.maxPoints ?? 1000)));
  }
  getSeries(name: string): number[] { return [...(this.series.get(name) ?? [])]; }
  getTrend(name: string): Trend { return trend(this.getSeries(name)); }
  getForecast(name: string, horizon = 7): Forecast | null { return forecast(this.getSeries(name), horizon); }
  health(): ModuleHealth { return this.rejected > 100 ? { status: 'degraded', detail: `${this.rejected} mesures rejetées` } : { status: 'ok' }; }
}

/** Payload attendu pour "facts.updated" : instantané des faits métier ODTHAN (voir odthan-rules.ts). */
export interface FactsPayload { facts: Record<string, unknown> }

/**
 * InfGlo Decision : sur "facts.updated", évalue les règles et publie une recommandation par règle déclenchée.
 * Anti-bruit : une même règle n'est ré-émise qu'après `cooldownMs` (30 min par défaut).
 */
export class DecisionModule implements InfGloModule {
  readonly name = 'infglo.decision'; readonly version = '1.0.0';
  private ctx!: InfGloContext; private last = new Map<string, number>();
  readonly engine: DecisionEngine;
  constructor(rules: Rule[] = [], private readonly cooldownMs = 30 * 60_000, private readonly isMuted: (ruleId: string) => boolean = () => false) { this.engine = new DecisionEngine(rules); }
  init(ctx: InfGloContext) { this.ctx = ctx; }
  handle(e: InfGloEvent) {
    if (e.type !== 'facts.updated') return;
    const facts = (e.payload as FactsPayload | null)?.facts; if (!facts || typeof facts !== 'object') return;
    const now = this.ctx.now(); const active = new Set<string>();
    for (const d of this.engine.decide(facts)) {
      if (this.isMuted(d.ruleId)) continue;   // règle jugée peu utile par les retours (InfGlo Learning)
      active.add(d.ruleId);
      if (now - (this.last.get(d.ruleId) ?? -Infinity) < this.cooldownMs) continue;
      this.last.set(d.ruleId, now);
      this.ctx.emitInsight({ kind: 'recommendation', severity: d.severity, source: e.source, title: d.title, detail: d.recommendation, data: { ruleId: d.ruleId, action: d.action } });
    }
    for (const id of [...this.last.keys()]) if (!active.has(id)) this.last.delete(id);   // règle résolue → ré-émission possible
  }
}
