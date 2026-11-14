import type { InfGloEvent, InfGloModule, ModuleHealth } from './types';
import { percentile } from './stats';

/** Cache TTL borné (LRU simple) avec dédoublonnage des chargements simultanés : évite de rappeler la base/l'IA pour rien. */
export class TtlCache<T> {
  private m = new Map<string, { v: T; exp: number }>(); private inflight = new Map<string, Promise<T>>();
  constructor(private readonly ttlMs: number, private readonly max = 200, private readonly now: () => number = Date.now) {}
  get(k: string): T | undefined { const e = this.m.get(k); if (!e) return undefined; if (e.exp <= this.now()) { this.m.delete(k); return undefined; } this.m.delete(k); this.m.set(k, e); return e.v; }
  set(k: string, v: T) { this.m.delete(k); this.m.set(k, { v, exp: this.now() + this.ttlMs }); if (this.m.size > this.max) this.m.delete(this.m.keys().next().value as string); }
  async getOrLoad(k: string, load: () => Promise<T>): Promise<T> {
    const hit = this.get(k); if (hit !== undefined) return hit;
    const run = this.inflight.get(k); if (run) return run;
    const p = load().then((v) => { this.set(k, v); return v; }).finally(() => this.inflight.delete(k));
    this.inflight.set(k, p); return p;
  }
  get size() { return this.m.size; }
}

/** Registre de métriques internes : compteurs et latences (p50/p95 sur les 200 dernières mesures). */
export class Metrics {
  private c = new Map<string, number>(); private t = new Map<string, number[]>();
  inc(name: string, n = 1) { this.c.set(name, (this.c.get(name) ?? 0) + n); }
  observe(name: string, ms: number) { const a = this.t.get(name) ?? []; a.push(ms); if (a.length > 200) a.shift(); this.t.set(name, a); }
  async timed<T>(name: string, fn: () => Promise<T>, clock: () => number = Date.now): Promise<T> { const s = clock(); try { return await fn(); } finally { this.observe(name, clock() - s); } }
  snapshot() {
    const timings: Record<string, { count: number; p50: number; p95: number }> = {};
    this.t.forEach((a, k) => (timings[k] = { count: a.length, p50: percentile(a, 50), p95: percentile(a, 95) }));
    return { counters: Object.fromEntries(this.c), timings };
  }
}

/** InfGlo Monitoring : comptage des évènements par type (types bornés) et dernière activité. */
export class MonitoringModule implements InfGloModule {
  readonly name = 'infglo.monitoring'; readonly version = '1.0.0';
  readonly metrics = new Metrics(); private last = 0; private overflow = 0; private types = new Set<string>();
  handle(e: InfGloEvent) {
    this.last = e.at;
    if (!this.types.has(e.type)) { if (this.types.size >= 100) { this.overflow++; return; } this.types.add(e.type); }
    this.metrics.inc(`events.${e.type}`);
  }
  health(): ModuleHealth { return this.overflow > 0 ? { status: 'degraded', detail: `${this.overflow} évènements de types inattendus ignorés` } : { status: 'ok', detail: this.last ? `dernier évènement : ${new Date(this.last).toISOString()}` : undefined }; }
}
