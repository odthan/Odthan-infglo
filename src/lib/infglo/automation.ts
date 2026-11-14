import type { InfGloContext, InfGloEvent, InfGloModule, Insight } from './types';

export interface ActionInput { insight: Insight; dbId: string }
export interface ActionDef { id: string; requiresApproval: boolean; run: (a: ActionInput) => Promise<string | void> }
export interface ActionRecord { id: string; insightId: string; action: string; status: 'pending' | 'done' | 'failed' | 'dry-run' | 'rejected'; result?: string; at: number }

/**
 * InfGlo Automation : transforme les recommandations en actions.
 * Sécurité : mode "dry-run" par défaut ; les actions sensibles exigent une approbation humaine ; seules les actions enregistrées s'exécutent.
 * Flux : 'insight.created' → file d'attente → `execute()` (appelé après persistance des insights).
 */
export class AutomationModule implements InfGloModule {
  readonly name = 'infglo.automation'; readonly version = '1.0.0';
  private defs = new Map<string, ActionDef>(); private queue: Insight[] = []; private records: ActionRecord[] = []; private seq = 0;
  constructor(private readonly opts: { mode?: 'dry-run' | 'live'; maxQueue?: number } = {}) {}
  init(_ctx: InfGloContext) { /* rien à initialiser */ }
  get mode() { return this.opts.mode ?? 'dry-run'; }
  register(d: ActionDef): this { this.defs.set(d.id, d); return this; }
  getDef(id: string) { return this.defs.get(id); }
  handle(e: InfGloEvent) {
    if (e.type !== 'insight.created') return;
    const i = e.payload as Insight; const a = i.data?.action;
    if (typeof a === 'string' && this.defs.has(a) && this.queue.length < (this.opts.maxQueue ?? 200)) this.queue.push(i);
  }
  /** Exécute la file. `resolve` donne l'identifiant en base de l'insight (undefined = ignoré, ex. doublon non enregistré). */
  async execute(resolve: (i: Insight) => string | undefined, now = Date.now()): Promise<ActionRecord[]> {
    const out: ActionRecord[] = []; const seen = new Set<string>();
    for (const i of this.queue.splice(0)) {
      const dbId = resolve(i); const action = i.data!.action as string; const def = this.defs.get(action);
      if (!dbId || !def || seen.has(action + '|' + i.title)) continue; seen.add(action + '|' + i.title);
      const rec: ActionRecord = { id: `act_${++this.seq}`, insightId: dbId, action, status: 'pending', at: now };
      if (!def.requiresApproval) {
        if (this.mode === 'dry-run') rec.status = 'dry-run';
        else { try { rec.result = (await def.run({ insight: i, dbId })) ?? undefined; rec.status = 'done'; } catch (e) { rec.status = 'failed'; rec.result = (e as Error).message.slice(0, 200); } }
      }
      out.push(rec);
    }
    this.records.push(...out); this.records = this.records.slice(-500);
    return out;
  }
  history(): ActionRecord[] { return [...this.records]; }
}

/** Exécute une action après décision humaine (utilisé par l'interface d'administration). */
export async function runApproved(def: ActionDef, a: ActionInput): Promise<{ status: 'done' | 'failed'; result?: string }> {
  try { return { status: 'done', result: (await def.run(a)) ?? undefined }; } catch (e) { return { status: 'failed', result: (e as Error).message.slice(0, 200) }; }
}
