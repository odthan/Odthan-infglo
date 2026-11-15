'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getAccess } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { SupabaseRepository, auditAdmin, buildDefaultActions, runApproved, runCycle } from '@/lib/infglo/server';

/** Permission requise pour InfGlo (voir README InfGlo : remplacez par une permission dédiée `infglo.manage` si vous en créez une). */
const PERM = 'users.manage';
const BACK = '/admin/infglo';
async function need() {
  const a = await getAccess();
  if (!a.user) redirect('/login');
  if (!a.permissions.includes(PERM)) throw new Error('forbidden');
  return a;
}
const done = (kind: 'm' | 'e', msg: string): never => redirect(`${BACK}?${kind}=${encodeURIComponent(msg)}`);
const uuid = (v: FormDataEntryValue | null) => (/^[0-9a-f-]{36}$/i.test(String(v ?? '')) ? String(v) : '');

export async function runNow() {
  const a = await need(); const repo = new SupabaseRepository(await createAdminClient());
  try {
    const r = await runCycle(repo, { mode: process.env.INFGLO_AUTOMATION === 'live' ? 'live' : 'dry-run', salt: process.env.INFGLO_SALT });
    await auditAdmin(repo, a.user!.id, 'admin.infglo_run', undefined, { risk: r.risk, saved: r.saved });
    revalidatePath(BACK);
  } catch { return done('e', 'L’analyse a échoué. Vérifiez la migration 007 et le schéma (supabase-repo.ts).'); }
  return done('m', 'Analyse terminée.');
}

export async function sendFeedback(fd: FormData) {
  const a = await need(); const id = uuid(fd.get('id')); const useful = fd.get('useful') === '1';
  if (!id) return done('e', 'Insight invalide.');
  const db = await createAdminClient();
  const { data } = await db.from('infglo_insights').select('data').eq('id', id).maybeSingle();
  const ruleId = typeof data?.data?.ruleId === 'string' ? data.data.ruleId : null;
  await db.from('infglo_feedback').insert({ insight_id: id, rule_id: ruleId, useful, user_id: a.user!.id });
  revalidatePath(BACK); return done('m', 'Merci : InfGlo en tient compte.');
}

export async function dismissInsight(fd: FormData) {
  const a = await need(); const id = uuid(fd.get('id')); if (!id) return done('e', 'Insight invalide.');
  const repo = new SupabaseRepository(await createAdminClient());
  await repo.setInsightStatus(id, 'dismissed'); await auditAdmin(repo, a.user!.id, 'admin.insight_dismissed', id);
  revalidatePath(BACK); return done('m', 'Insight écarté.');
}

/** Décision humaine sur une action sensible : l'action ne s'exécute QUE si l'administrateur approuve. */
export async function decideAction(fd: FormData) {
  const a = await need(); const id = uuid(fd.get('id')); const approve = fd.get('approve') === '1';
  if (!id) return done('e', 'Action invalide.');
  const db = await createAdminClient(); const repo = new SupabaseRepository(db);
  const { data: row } = await db.from('infglo_actions').select('id,insight_id,action,status').eq('id', id).maybeSingle();
  if (!row || row.status !== 'pending') return done('e', 'Action introuvable ou déjà traitée.');
  let status = 'rejected'; let result: string | undefined;
  if (approve) {
    const def = buildDefaultActions(repo).find((d) => d.id === row.action);
    if (!def) return done('e', 'Action inconnue.');
    const { data: ins } = await db.from('infglo_insights').select('id,kind,severity,title,detail,source,data,created_at').eq('id', row.insight_id).maybeSingle();
    if (!ins) return done('e', 'Insight introuvable.');
    const r = await runApproved(def, { dbId: ins.id, insight: { id: ins.id, kind: ins.kind, severity: ins.severity, title: ins.title, detail: ins.detail, source: ins.source, at: Date.parse(ins.created_at), data: ins.data } });
    status = r.status; result = r.result;
  }
  await db.from('infglo_actions').update({ status, result: result ?? null, decided_by: a.user!.id, decided_at: new Date().toISOString() }).eq('id', id);
  await auditAdmin(repo, a.user!.id, approve ? 'admin.action_approved' : 'admin.action_rejected', id, { action: row.action });
  revalidatePath(BACK); return done('m', approve ? 'Action exécutée.' : 'Action refusée.');
}
