import type { InfGloContext, InfGloEvent, InfGloModule, Insight, Logger, ModuleHealth } from './types';

type Handler = (e: InfGloEvent) => void | Promise<void>;

export interface CoreOptions {
  now?: () => number;
  /** taille max du tampon d'insights en mémoire (anneau) */
  maxInsights?: number;
  logger?: Logger;
}

const silent: Logger = { info() {}, warn() {}, error() {} };

/** Motif d'abonnement : "*" (tout), "metric.*" (préfixe) ou type exact. */
export function matches(pattern: string, type: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('.*')) return type.startsWith(pattern.slice(0, -1));
  return pattern === type;
}

/**
 * InfGlo Core — bus d'évènements + registre de modules + tampon d'insights.
 * Les erreurs d'un module sont isolées (jamais propagées aux autres) et comptées pour le monitoring.
 */
export class InfGloCore {
  private readonly modules = new Map<string, InfGloModule>();
  private readonly subs: { pattern: string; fn: Handler }[] = [];
  private readonly listeners = new Set<(i: Insight) => void>();
  private readonly errors = new Map<string, number>();
  private insights: Insight[] = [];
  private seq = 0;
  private readonly pending = new Set<Promise<unknown>>();
  private startedAt = 0;
  private started = false;
  private readonly logger: Logger;
  private readonly maxInsights: number;
  private readonly ctx: InfGloContext;

  constructor(private readonly opts: CoreOptions = {}) {
    this.logger = opts.logger ?? silent;
    this.maxInsights = opts.maxInsights ?? 500;
    this.ctx = {
      publish: (t, p, s) => this.publish(t, p, s),
      emitInsight: (i) => this.emitInsight(i),
      now: () => this.now(),
      logger: this.logger,
    };
  }

  now(): number { return (this.opts.now ?? Date.now)(); }
  private nextId(prefix: string): string { return `${prefix}_${this.now().toString(36)}_${(++this.seq).toString(36)}`; }

  register(m: InfGloModule): this {
    if (this.modules.has(m.name)) throw new Error(`Module déjà enregistré : ${m.name}`);
    this.modules.set(m.name, m);
    return this;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true; this.startedAt = this.now();
    for (const m of this.modules.values()) {
      try { await m.init?.(this.ctx); }
      catch (e) { this.bumpError(m.name); this.logger.error(`init a échoué : ${m.name}`, e); }
    }
  }

  async stop(): Promise<void> {
    for (const m of this.modules.values()) { try { await m.dispose?.(); } catch (e) { this.logger.error(`dispose : ${m.name}`, e); } }
    this.started = false;
  }

  subscribe(pattern: string, fn: Handler): () => void {
    const s = { pattern, fn }; this.subs.push(s);
    return () => { const i = this.subs.indexOf(s); if (i >= 0) this.subs.splice(i, 1); };
  }

  onInsight(fn: (i: Insight) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  async publish(type: string, payload: unknown, source = 'external'): Promise<InfGloEvent> {
    const event: InfGloEvent = { id: this.nextId('evt'), type, source, at: this.now(), payload };
    const jobs: Promise<void>[] = [];
    for (const s of [...this.subs]) if (matches(s.pattern, type)) jobs.push(this.safe('subscriber', () => s.fn(event)));
    for (const m of this.modules.values()) if (m.handle) jobs.push(this.safe(m.name, () => m.handle!(event)));
    await Promise.all(jobs);
    return event;
  }

  emitInsight(i: Omit<Insight, 'id' | 'at'>): Insight {
    const insight: Insight = { ...i, id: this.nextId('ins'), at: this.now() };
    this.insights.push(insight);
    if (this.insights.length > this.maxInsights) this.insights = this.insights.slice(-this.maxInsights);
    for (const l of this.listeners) { try { l(insight); } catch (e) { this.logger.error('listener', e); } }
    // Diffusion asynchrone pour les modules (ex. Automation) ; `flush()` attend la fin de ces traitements.
    const p: Promise<unknown> = this.publish('insight.created', insight, 'infglo.core').then(() => { this.pending.delete(p); });
    this.pending.add(p);
    return insight;
  }

  getInsights(filter?: { kind?: Insight['kind']; minSeverity?: Insight['severity']; limit?: number }): Insight[] {
    const order = { info: 0, low: 1, medium: 2, high: 3, critical: 4 } as const;
    let r = this.insights.filter((x) => (!filter?.kind || x.kind === filter.kind) && (!filter?.minSeverity || order[x.severity] >= order[filter.minSeverity]));
    r = r.slice().reverse();
    return filter?.limit ? r.slice(0, filter.limit) : r;
  }

  /** Attend les traitements déclenchés par les insights (utile en tâche planifiée et dans les tests). */
  async flush(): Promise<void> { while (this.pending.size) await Promise.all([...this.pending]); }

  health(): { status: 'ok' | 'degraded' | 'down'; uptimeMs: number; insights: number; modules: Record<string, ModuleHealth & { version: string; errors: number }> } {
    const modules: Record<string, ModuleHealth & { version: string; errors: number }> = {};
    let worst: 'ok' | 'degraded' | 'down' = 'ok';
    for (const m of this.modules.values()) {
      const h = m.health?.() ?? { status: 'ok' as const };
      const errors = this.errors.get(m.name) ?? 0;
      const status = h.status === 'ok' && errors > 0 ? 'degraded' : h.status;
      modules[m.name] = { ...h, status, version: m.version, errors };
      if (status === 'down') worst = 'down'; else if (status === 'degraded' && worst === 'ok') worst = 'degraded';
    }
    return { status: worst, uptimeMs: this.started ? this.now() - this.startedAt : 0, insights: this.insights.length, modules };
  }

  private bumpError(name: string) { this.errors.set(name, (this.errors.get(name) ?? 0) + 1); }
  private async safe(name: string, fn: () => void | Promise<void>): Promise<void> {
    try { await fn(); } catch (e) { this.bumpError(name); this.logger.error(`erreur dans ${name}`, e); }
  }
}
