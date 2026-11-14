import { AutomationModule, type ActionDef, type ActionRecord } from './automation';
import { InfGloCore } from './core';
import { ODTHAN_DEFAULT_RULES } from './odthan-rules';
import { LearningModule } from './learning';
import { AnalyticsModule, DecisionModule } from './modules';
import { MonitoringModule } from './optimizer';
import { AuditChain, SecurityModule } from './security';
import { riskScore, type Rule } from './decision';
import { trend } from './stats';
import { buildDefaultActions } from './actions';
import type { InfGloRepository, RunSummary } from './repository';
import type { Insight } from './types';

export interface CycleOptions { now?: number; mode?: 'dry-run' | 'live'; rules?: Rule[]; actions?: ActionDef[]; salt?: string; dedupeMs?: number; historyLimit?: number }
export interface CycleResult extends RunSummary { newInsights: Insight[]; actionRecords: ActionRecord[] }

const setPath = (o: Record<string, unknown>, path: string, v: unknown) => {
  const ks = path.split('.'); let cur = o;
  ks.slice(0, -1).forEach((k) => { cur = (cur[k] = (cur[k] as Record<string, unknown>) ?? {}) as Record<string, unknown>; });
  cur[ks[ks.length - 1]] = v;
};
const nest = (flat: Record<string, unknown>) => { const o: Record<string, unknown> = {}; Object.entries(flat).forEach(([k, v]) => v !== undefined && setPath(o, k, v)); return o; };
const num = (v: unknown) => (typeof v === 'number' ? v : 0);

/**
 * Un cycle InfGlo complet (tâche planifiée ou bouton « Lancer l'analyse ») :
 * collecte → historique → détection d'anomalies → règles de décision → score de risque → dédoublonnage → persistance → automatisations → audit.
 * Sans état entre deux cycles (adapté au serverless) : tout l'état durable passe par le dépôt.
 */
export async function runCycle(repo: InfGloRepository, o: CycleOptions = {}): Promise<CycleResult> {
  const now = o.now ?? Date.now();
  const snap = await repo.collect(now);
  const names = Object.keys(snap.metrics);
  const [history, feedback, head] = await Promise.all([repo.loadHistory(names, o.historyLimit ?? 90), repo.feedbackCounts(), repo.lastAudit()]);

  const core = new InfGloCore({ now: () => now });
  const analytics = new AnalyticsModule(); const learning = new LearningModule(); learning.load(feedback);
  const decision = new DecisionModule(o.rules ?? ODTHAN_DEFAULT_RULES, 0, learning.isMuted);
  const security = new SecurityModule({ salt: o.salt, head }); const monitoring = new MonitoringModule();
  const automation = new AutomationModule({ mode: o.mode ?? 'dry-run' });
  (o.actions ?? buildDefaultActions(repo)).forEach((a) => automation.register(a));
  core.register(analytics).register(decision).register(security).register(learning).register(automation).register(monitoring);
  await core.start();

  names.forEach((n) => analytics.seed(n, history[n] ?? []));
  const facts = nest(snap.facts);
  const openSeries = [...(history['requests.open'] ?? []), snap.metrics['requests.open']].filter((x): x is number => typeof x === 'number');
  setPath(facts, 'requests.trend', trend(openSeries));

  await core.publish('admin.cycle_started', { actor: 'infglo.cycle' }, 'infglo.engine');
  for (const [name, value] of Object.entries(snap.metrics)) await core.publish('metric.recorded', { name, value }, 'infglo.collector');
  await core.publish('facts.updated', { facts }, 'infglo.collector');
  await core.flush();

  const all = core.getInsights().reverse();
  const f = facts as { auth?: { failed_logins_last_hour?: unknown }; requests?: { pending_over_48h?: unknown }; messages?: { unanswered_over_24h?: unknown } };
  const risk = riskScore([
    { name: 'échecs de connexion', value: num(f.auth?.failed_logins_last_hour), weight: 3, max: 50 },
    { name: 'demandes en retard', value: num(f.requests?.pending_over_48h), weight: 2, max: 10 },
    { name: 'messages sans réponse', value: num(f.messages?.unanswered_over_24h), weight: 1, max: 10 },
    { name: 'anomalies détectées', value: all.filter((i) => i.kind === 'anomaly').length, weight: 2, max: 3 },
  ]);

  const known = await repo.recentInsightKeys(now - (o.dedupeMs ?? 6 * 3_600_000));
  const fresh = all.filter((i) => !known.has(`${i.kind}|${i.title}`));
  const idMap = fresh.length ? await repo.saveInsights(fresh) : new Map<string, string>();
  const actionRecords = await automation.execute((i) => idMap.get(i.id), now);
  if (actionRecords.length) await repo.saveActions(actionRecords);
  await repo.saveMetrics({ ...snap.metrics, 'infglo.risk_score': risk.score }, now);
  if (security.audit.all.length) await repo.saveAudit(security.audit.all);

  const summary: RunSummary = { at: now, risk: risk.score, riskLevel: risk.level, insights: all.length, saved: fresh.length, actions: actionRecords.length, health: core.health() };
  await repo.saveRun(summary);
  return { ...summary, newInsights: fresh, actionRecords };
}

/** Inscrit une action d'administrateur dans la chaîne d'audit persistée (best-effort : n'interrompt jamais l'action métier). */
export async function auditAdmin(repo: InfGloRepository, actor: string, action: string, target?: string, data?: Record<string, unknown>) {
  try { const chain = new AuditChain(await repo.lastAudit()); chain.append(actor, action, Date.now(), target, data); await repo.saveAudit(chain.all); } catch { /* conflit de séquence ou base indisponible */ }
}
