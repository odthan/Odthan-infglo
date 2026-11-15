import { checkPerm } from '@/lib/auth';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { Card, Empty, Flash, Forbidden, PageHead } from '@/components/admin-ui';
import { contactBadges, loadMessageAi } from '@/lib/infglo/server';
import { BadgeRow } from '@/components/infglo/AdminBadges';
import { setContactStatus } from '../actions';
import { aiDraft, aiSummarize } from './ai-actions';

export const metadata = { title: 'Messages de contact' };
const L: Record<string, string> = { new: 'Nouveau', read: 'Lu', replied: 'Répondu', archived: 'Archivé' };
const aiBtn = 'min-h-10 rounded-lg border border-blue-900/30 bg-white px-3 text-sm font-medium text-blue-950 hover:border-blue-900';

export default async function ContactAdmin({ searchParams }: { searchParams: Promise<{ status?: string; m?: string; e?: string }> }) {
  if (!(await checkPerm('contact.manage'))) return <Forbidden />;
  const sp = await searchParams; let q = (await createClient()).from('contact_messages').select('*').order('created_at', { ascending: false }).limit(200);
  if (sp.status && L[sp.status]) q = q.eq('status', sp.status);
  const { data } = await q;
  // Résumés IA déjà générés (lecture serveur ; jamais exposés sans la permission contact.manage vérifiée ci-dessus).
  let ai = new Map<string, { summary: string | null; draft: string | null }>();
  try { ai = await loadMessageAi(createAdminClient(), (data ?? []).map((m) => m.id)); } catch { /* clé service absente */ }
  const statusField = L[sp.status ?? ''] ? sp.status : '';
  return (
    <>
      <PageHead title="Messages de contact" sub="Messages envoyés depuis le formulaire public. Les messages WhatsApp restent dans WhatsApp." />
      <Flash m={sp.m} e={sp.e} />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">{[['', 'Tous'], ...Object.entries(L)].map(([k, v]) => <a key={k} href={k ? `?status=${k}` : '?'} className={`rounded-full border px-4 py-2 font-medium ${(sp.status ?? '') === k ? 'bg-ink text-white' : ''}`}>{v}</a>)}</div>
      {(data ?? []).length === 0 ? <Empty>Aucun message.</Empty> : <ul className="space-y-3">{data!.map((m) => {
        const badges = contactBadges(m); const r = ai.get(m.id);
        return (
        <li key={m.id} id={`msg-${m.id}`}><Card><div className="flex items-start justify-between gap-2"><div><p className="font-bold">{m.name} <span className="font-normal text-neutral-500">— {m.subject || 'Sans sujet'}</span></p>
          <p className="text-xs text-neutral-500"><a className="text-brand" href={`mailto:${m.email}`}>{m.email}</a>{m.phone ? ` · ${m.phone}` : ''} · {new Date(m.created_at).toLocaleString('fr-FR')}</p></div>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${m.status === 'new' ? 'bg-brand text-white' : 'bg-neutral-100'}`}>{L[m.status]}</span></div>
          <BadgeRow badges={badges} />
          <p className="mt-3 whitespace-pre-line text-sm">{m.message}</p>

          <div className="mt-3 rounded-xl border border-blue-900/20 bg-[#0A1633] p-3 text-white">
            <p className="text-xs font-bold uppercase tracking-wider text-blue-300">InfGlo · assistant IA</p>
            {r?.summary ? <p className="mt-1 whitespace-pre-line text-sm">{r.summary}</p> : <p className="mt-1 text-xs text-blue-200/70">Aucun résumé pour l’instant.</p>}
            {r?.draft && <div className="mt-3"><p className="text-xs font-semibold text-blue-300">Brouillon de réponse — à relire avant envoi</p>
              <textarea readOnly rows={6} defaultValue={r.draft} className="mt-1 w-full rounded-lg bg-white p-2 text-sm text-neutral-900" aria-label="Brouillon de réponse" />
              <a className="mt-1 inline-flex min-h-10 items-center rounded-lg bg-blue-700 px-3 text-sm font-semibold text-white" href={`mailto:${encodeURIComponent(m.email).replace('%40', '@')}?subject=${encodeURIComponent('Re: ' + (m.subject || 'Votre message'))}&body=${encodeURIComponent(r.draft)}`}>Ouvrir dans ma messagerie</a></div>}
            <div className="mt-3 flex flex-wrap gap-2">
              {!r?.summary && <form action={aiSummarize}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="status" value={statusField} /><button className={aiBtn}>Résumer avec l’IA</button></form>}
              {!r?.draft && <form action={aiDraft}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="status" value={statusField} /><button className={aiBtn}>Proposer un brouillon de réponse</button></form>}
            </div>
            <p className="mt-2 text-[11px] text-blue-200/60">Généré par IA à la demande ; peut contenir des erreurs. Coordonnées masquées avant envoi.</p>
          </div>

          <form action={setContactStatus} className="mt-3 flex gap-2"><input type="hidden" name="id" value={m.id} />
            {Object.entries(L).filter(([k]) => k !== m.status).map(([k, v]) => <button key={k} name="status" value={k} className="min-h-10 rounded-lg border px-3 text-sm font-medium">{v}</button>)}</form></Card></li>);})}</ul>}
    </>
  );
}
