import type { InfGloEvent, InfGloModule } from './types';

export interface RuleFeedback { ruleId: string; up: number; down: number }

/**
 * InfGlo Learning : apprend de l'utilité perçue des recommandations ("feedback.recorded" {ruleId, useful}).
 * Score bayésien lissé (Laplace) ; une règle clairement jugée inutile (≥ minVotes retours, score < muteBelow) est mise en sourdine.
 * Évolution prévue : pondérer les seuils/sévérités par règle, puis modèles supervisés.
 */
export class LearningModule implements InfGloModule {
  readonly name = 'infglo.learning'; readonly version = '1.0.0';
  private counts = new Map<string, { up: number; down: number }>();
  constructor(private readonly o: { minVotes?: number; muteBelow?: number } = {}) {}
  load(rows: RuleFeedback[]) { rows.forEach((r) => this.counts.set(r.ruleId, { up: r.up, down: r.down })); }
  handle(e: InfGloEvent) {
    if (e.type !== 'feedback.recorded') return;
    const p = e.payload as { ruleId?: unknown; useful?: unknown } | null;
    if (!p || typeof p.ruleId !== 'string' || typeof p.useful !== 'boolean') return;
    const c = this.counts.get(p.ruleId) ?? { up: 0, down: 0 }; p.useful ? c.up++ : c.down++; this.counts.set(p.ruleId, c);
  }
  score(ruleId: string): number { const c = this.counts.get(ruleId) ?? { up: 0, down: 0 }; return (c.up + 1) / (c.up + c.down + 2); }
  readonly isMuted = (ruleId: string): boolean => {
    const c = this.counts.get(ruleId); if (!c) return false;
    return c.up + c.down >= (this.o.minVotes ?? 10) && this.score(ruleId) < (this.o.muteBelow ?? 0.25);
  };
  report() { return [...this.counts.entries()].map(([ruleId, c]) => ({ ruleId, ...c, score: this.score(ruleId), muted: this.isMuted(ruleId) })); }
}
