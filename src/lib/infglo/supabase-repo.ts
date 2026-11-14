/**
 * Implémentation Supabase du dépôt InfGlo. SERVEUR UNIQUEMENT : à utiliser avec le client service_role (createAdminClient()).
 * INFGLO_SCHEMA reflète les migrations ODTHAN 001–007 ; à ajuster seulement si vous renommez des tables ou des statuts.
 * Un fait introuvable (table absente, colonne inconnue) est simplement ignoré : la règle correspondante ne se déclenche pas.
 */
import type { ActionRecord } from './automation';
import type { InfGloRepository, RunSummary, Snapshot } from './repository';
import type { AuditEntry } from './security';
import type { Insight } from './types';

export const INFGLO_SCHEMA = {
  // Statuts réels d'ODTHAN (002_workflow.sql). « pending » = en attente d'une action de l'équipe (pas du client).
  requests: { table: 'service_requests', status: 'status', created: 'created_at', open: ['new', 'analyzing', 'info_required', 'quote_sent', 'accepted', 'in_progress'], pending: ['new', 'analyzing'] },
  messages: { table: 'contact_messages', status: 'status', created: 'created_at', unanswered: ['new', 'read'] },
  services: { table: 'services', status: 'status', draft: 'draft' },
  profiles: { table: 'profiles', created: 'created_at' },
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = { from: (table: any) => any };
const iso = (ms: number) => new Date(ms).toISOString();
const H = 3_600_000;

export class SupabaseRepository implements InfGloRepository {
  constructor(private readonly db: Db, private readonly schema = INFGLO_SCHEMA) {}

  private async count(table: string, f: (q: any) => any): Promise<number | undefined> {
    try { const { count, error } = await f(this.db.from(table).select('id', { count: 'exact', head: true })); return error ? undefined : count ?? 0; } catch { return undefined; }
  }

  async collect(now: number): Promise<Snapshot> {
    const s = this.schema;
    const [open, pending, unanswered, drafts, failed, req24, msg24, usr24] = await Promise.all([
      this.count(s.requests.table, (q) => q.in(s.requests.status, s.requests.open)),
      this.count(s.requests.table, (q) => q.in(s.requests.status, s.requests.pending).lt(s.requests.created, iso(now - 48 * H))),
      this.count(s.messages.table, (q) => q.in(s.messages.status, s.messages.unanswered).lt(s.messages.created, iso(now - 24 * H))),
      this.count(s.services.table, (q) => q.eq(s.services.status, s.services.draft)),
      this.count('infglo_security_events', (q) => q.eq('kind', 'login_failed').gte('at', iso(now - H))),
      this.count(s.requests.table, (q) => q.gte(s.requests.created, iso(now - 24 * H))),
      this.count(s.messages.table, (q) => q.gte(s.messages.created, iso(now - 24 * H))),
      this.count(s.profiles.table, (q) => q.gte(s.profiles.created, iso(now - 24 * H))),
    ]);
    const facts: Record<string, unknown> = { 'requests.open_count': open, 'requests.pending_over_48h': pending, 'messages.unanswered_over_24h': unanswered, 'services.draft_count': drafts, 'auth.failed_logins_last_hour': failed };
    const metrics: Record<string, number> = {};
    const put = (k: string, v: number | undefined) => { if (v !== undefined) metrics[k] = v; };
    put('requests.open', open); put('requests.created_per_day', req24); put('messages.created_per_day', msg24); put('users.created_per_day', usr24); put('auth.failed_logins_per_hour', failed);
    return { facts, metrics };
  }

  async loadHistory(names: string[], limit: number): Promise<Record<string, number[]>> {
    const out: Record<string, number[]> = {};
    await Promise.all(names.map(async (n) => {
      const { data } = await this.db.from('infglo_metrics').select('value').eq('name', n).order('at', { ascending: false }).limit(limit);
      out[n] = ((data ?? []) as { value: number }[]).map((r) => r.value).reverse();
    }));
    return out;
  }
  async saveMetrics(m: Record<string, number>, at: number) {
    const rows = Object.entries(m).filter(([, v]) => Number.isFinite(v)).map(([name, value]) => ({ name, value, at: iso(at) }));
    if (rows.length) await this.db.from('infglo_metrics').insert(rows);
  }
  async recentInsightKeys(sinceMs: number) {
    const { data } = await this.db.from('infglo_insights').select('kind,title').gte('created_at', iso(sinceMs));
    return new Set(((data ?? []) as { kind: string; title: string }[]).map((r) => `${r.kind}|${r.title}`));
  }
  async saveInsights(list: Insight[]) {
    const rows = list.map((i) => ({ core_id: i.id, kind: i.kind, severity: i.severity, title: i.title, detail: i.detail, source: i.source, data: i.data ?? {} }));
    const { data, error } = await this.db.from('infglo_insights').insert(rows).select('id,core_id');
    if (error) throw new Error(error.message);
    return new Map<string, string>(((data ?? []) as { id: string; core_id: string }[]).map((r) => [r.core_id, r.id]));
  }
  async setInsightStatus(dbId: string, status: 'open' | 'escalated' | 'dismissed' | 'resolved') { await this.db.from('infglo_insights').update({ status }).eq('id', dbId); }
  async feedbackCounts() {
    const { data } = await this.db.from('infglo_feedback').select('rule_id,useful').limit(10000);
    const m = new Map<string, { up: number; down: number }>();
    ((data ?? []) as { rule_id: string | null; useful: boolean }[]).forEach((r) => { if (!r.rule_id) return; const c = m.get(r.rule_id) ?? { up: 0, down: 0 }; r.useful ? c.up++ : c.down++; m.set(r.rule_id, c); });
    return [...m].map(([ruleId, c]) => ({ ruleId, ...c }));
  }
  async saveActions(records: ActionRecord[]) {
    await this.db.from('infglo_actions').insert(records.map((r) => ({ insight_id: r.insightId, action: r.action, status: r.status, result: r.result ?? null })));
  }
  async lastAudit() {
    const { data } = await this.db.from('infglo_audit').select('seq,hash').order('seq', { ascending: false }).limit(1);
    const r = (data ?? [])[0] as { seq: number; hash: string } | undefined; return r ? { seq: Number(r.seq), hash: r.hash } : null;
  }
  async saveAudit(entries: AuditEntry[]) { if (entries.length) await this.db.from('infglo_audit').upsert(entries, { onConflict: 'seq', ignoreDuplicates: true }); }
  /** Crée une notification ODTHAN (table `notifications`) pour chaque personne active ayant l'un des rôles : le webhook Push existant l'envoie ensuite. */
  async notifyRoles(roles: string[], n: { title: string; body: string; link: string }): Promise<number> {
    const { data } = await this.db.from('user_roles').select('user_id').in('role', roles).eq('is_active', true);
    const ids = [...new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id))];
    if (!ids.length) return 0;
    const { error } = await this.db.from('notifications').insert(ids.map((user_id) => ({ user_id, type: 'infglo_alert', title: n.title.slice(0, 150), body: n.body.slice(0, 300), link: n.link, data: { source: 'infglo' } })));
    return error ? 0 : ids.length;
  }
  async saveRun(s: RunSummary) { await this.db.from('infglo_runs').insert({ at: iso(s.at), risk: s.risk, summary: s }); }
}

/** À appeler depuis l'action serveur de connexion quand un mot de passe est refusé (anonymisé par hachage). */
export async function reportLoginFailure(db: Db, identity: string, salt = process.env.INFGLO_SALT ?? ''): Promise<void> {
  const { hashId } = await import('./security');
  try { await db.from('infglo_security_events').insert({ kind: 'login_failed', key_hash: hashId(identity, salt) }); } catch { /* ne jamais bloquer la connexion */ }
}
