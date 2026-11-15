import { describe, expect, it } from 'vitest';
import {
  AnalyticsModule, DecisionEngine, EwmaDetector, InfGloCore, ODTHAN_DEFAULT_RULES, createInfGlo, detectAnomalies,
  forecast, getFact, linearRegression, mad, matches, median, movingAverage, percentile, riskScore, trend, validateRule,
} from '@/lib/infglo';

describe('InfGlo Analytics — statistiques', () => {
  it('médiane / MAD / percentile', () => {
    expect(median([5, 1, 3])).toBe(3); expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(mad([1, 1, 2, 2, 4, 6, 9])).toBe(1); expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3); expect(percentile([], 50)).toBe(0);
  });
  it('moyenne mobile et régression', () => {
    expect(movingAverage([1, 2, 3, 4], 2)).toEqual([1, 1.5, 2.5, 3.5]);
    const r = linearRegression([2, 4, 6, 8]); expect(r.slope).toBeCloseTo(2); expect(r.r2).toBeCloseTo(1);
  });
  it('tendance', () => {
    expect(trend([1, 2, 3, 4, 5, 6])).toBe('up'); expect(trend([6, 5, 4, 3, 2, 1])).toBe('down'); expect(trend([5, 5, 5, 5])).toBe('flat'); expect(trend([1, 2])).toBe('flat');
  });
});

describe('InfGlo — détection d’anomalies', () => {
  it('z-score modifié détecte le pic et pas le bruit', () => {
    const s = [10, 11, 10, 12, 11, 10, 11, 10, 11, 95, 10, 11];
    const a = detectAnomalies(s); expect(a.map((x) => x.index)).toEqual([9]); expect(a[0].direction).toBe('high');
  });
  it('série trop courte ou constante → aucune anomalie', () => {
    expect(detectAnomalies([1, 2, 100])).toEqual([]); expect(detectAnomalies(Array(20).fill(7))).toEqual([]);
  });
  it('EWMA : détecte un pic, ignore le bruit, s’adapte à un changement de régime', () => {
    const d = new EwmaDetector(); const noise = [100, 101, 99, 100, 102, 98, 100, 101, 99, 100, 101, 100];
    expect(noise.map((x) => d.update(x).anomaly).some(Boolean)).toBe(false);
    expect(d.update(300).anomaly).toBe(true);
    let last = true; for (let i = 0; i < 12; i++) last = d.update(300).anomaly;   // nouveau palier persistant
    expect(last).toBe(false);
  });
});

describe('InfGlo Predict', () => {
  it('prolonge une tendance linéaire', () => {
    const f = forecast([10, 20, 30, 40, 50, 60], 3)!; expect(f.points[0].value).toBeCloseTo(70, 0); expect(f.points[2].value).toBeCloseTo(90, 0);
    expect(f.points[2].upper).toBeGreaterThanOrEqual(f.points[2].lower);
  });
  it('refuse les séries trop courtes', () => { expect(forecast([1, 2], 3)).toBeNull(); expect(forecast([1, 2, 3], 0)).toBeNull(); });
  it('l’intervalle s’élargit avec l’horizon', () => {
    const f = forecast([10, 14, 9, 15, 11, 16, 12], 5)!; const w = (i: number) => f.points[i].upper - f.points[i].lower;
    expect(w(4)).toBeGreaterThan(w(0));
  });
});

describe('InfGlo Decision Engine', () => {
  const facts = { requests: { pending_over_48h: 3, open_count: 25, trend: 'up' }, auth: { failed_logins_last_hour: 4 } };
  it('déclenche les bonnes règles, triées par gravité', () => {
    const d = new DecisionEngine(ODTHAN_DEFAULT_RULES).decide(facts);
    expect(d.map((x) => x.ruleId)).toEqual(['requests.stale', 'requests.backlog']);
    expect(d[0].recommendation).toContain('3 demande(s)');
  });
  it('opérateurs, all/any/not', () => {
    const e = new DecisionEngine([{ id: 'r.test1', title: 't', severity: 'low', recommendation: 'x',
      when: { all: [{ fact: 'a', op: 'in', value: [1, 2] }, { not: { fact: 'b', op: 'exists' } }, { any: [{ fact: 'c', op: 'lt', value: 0 }, { fact: 's', op: 'contains', value: 'ok' }] }] } }]);
    expect(e.decide({ a: 2, s: 'tout ok' })).toHaveLength(1); expect(e.decide({ a: 2, b: 1, s: 'ok' })).toHaveLength(0);
  });
  it('fait absent ou non numérique → ne déclenche pas', () => {
    expect(new DecisionEngine(ODTHAN_DEFAULT_RULES).decide({ requests: { pending_over_48h: 'beaucoup' } })).toEqual([]);
  });
  it('sécurité : pas de pollution de prototype, règles invalides refusées', () => {
    expect(getFact({}, '__proto__.polluted')).toBeUndefined(); expect(getFact({ a: { b: 1 } }, 'a.b')).toBe(1);
    expect(validateRule({ id: 'x', title: '', severity: 'low', recommendation: '', when: { fact: 'a', op: 'eq' } })).not.toBeNull();
    expect(validateRule({ id: 'ok.rule', title: '', severity: 'low', recommendation: '', when: { fact: 'constructor.x', op: 'eq' } })).not.toBeNull();
    expect(() => new DecisionEngine().addRule({ id: 'ok.rule', title: '', severity: 'bad' as never, recommendation: '', when: { fact: 'a', op: 'eq' } })).toThrow();
  });
  it('score de risque pondéré', () => {
    const r = riskScore([{ name: 'échecs', value: 30, weight: 3, max: 30 }, { name: 'retards', value: 0, weight: 1, max: 10 }]);
    expect(r.score).toBe(75); expect(r.level).toBe('high'); expect(r.top).toEqual(['échecs']); expect(riskScore([]).score).toBe(0);
  });
});

describe('InfGlo Core — intégration', () => {
  it('motifs d’abonnement', () => { expect(matches('*', 'a.b')).toBe(true); expect(matches('metric.*', 'metric.recorded')).toBe(true); expect(matches('metric.*', 'x.metric')).toBe(false); expect(matches('a.b', 'a.b')).toBe(true); });
  it('un module en erreur est isolé et marqué dégradé', async () => {
    const core = new InfGloCore(); let ok = 0;
    core.register({ name: 'bad', version: '1', handle() { throw new Error('boom'); } }).register({ name: 'good', version: '1', handle() { ok++; } });
    await core.start(); await core.publish('x', {});
    expect(ok).toBe(1); const h = core.health(); expect(h.status).toBe('degraded'); expect(h.modules.bad.errors).toBe(1); expect(h.modules.good.status).toBe('ok');
  });
  it('refuse deux modules de même nom', () => { const c = new InfGloCore(); c.register({ name: 'a', version: '1' }); expect(() => c.register({ name: 'a', version: '1' })).toThrow(); });
  it('de bout en bout : métrique anormale → insight ; faits → recommandations avec cooldown', async () => {
    let t = 1_000_000; const { core, analytics } = await createInfGlo({ now: () => t });
    for (const v of [50, 52, 49, 51, 50, 48, 52, 50, 51, 50]) await core.publish('metric.recorded', { name: 'requests.per_hour', value: v }, 'odthan.requests');
    await core.publish('metric.recorded', { name: 'requests.per_hour', value: 400 }, 'odthan.requests');
    const an = core.getInsights({ kind: 'anomaly' }); expect(an).toHaveLength(1); expect(an[0].title).toContain('requests.per_hour');
    await core.publish('metric.recorded', { name: '../hack', value: 1 }, 'x'); await core.publish('metric.recorded', { name: 'ok', value: NaN }, 'x');
    expect(analytics.getSeries('../hack')).toEqual([]);
    const f = { facts: { auth: { failed_logins_last_hour: 50 } } };
    await core.publish('facts.updated', f, 'odthan.auth'); await core.publish('facts.updated', f, 'odthan.auth');
    expect(core.getInsights({ kind: 'recommendation' })).toHaveLength(1);            // cooldown
    t += 31 * 60_000; await core.publish('facts.updated', f, 'odthan.auth');
    expect(core.getInsights({ kind: 'recommendation', minSeverity: 'critical' })).toHaveLength(2);
  });
  it('mémoire bornée', async () => {
    const a = new AnalyticsModule({ maxPoints: 5, maxMetrics: 1 }); const core = new InfGloCore().register(a); await core.start();
    for (let i = 0; i < 20; i++) await core.publish('metric.recorded', { name: 'm', value: i });
    await core.publish('metric.recorded', { name: 'autre', value: 1 });
    expect(a.getSeries('m')).toEqual([15, 16, 17, 18, 19]); expect(a.getSeries('autre')).toEqual([]);
  });
});
