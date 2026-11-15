import { describe, expect, it } from 'vitest';
import { GenerativeClient, RateLimiter, contactBadges, generateForMessage, loadMessageAi } from '@/lib/infglo/server';

/** Faux Supabase minimal pour la table infglo_message_ai (upsert fusionnant, comme PostgREST). */
function fakeDb(opts: { failUpsert?: boolean } = {}) {
  const rows = new Map<string, Record<string, unknown>>();
  const db = { rows, from: (t: string) => {
    if (t !== 'infglo_message_ai') throw new Error('table inattendue ' + t);
    return {
      select: () => ({
        in: async (_c: string, ids: string[]) => ({ data: ids.filter((i) => rows.has(i)).map((i) => ({ message_id: i, summary: null, draft: null, ...rows.get(i) })) }),
        eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: rows.get(id) ?? null }) }),
      }),
      upsert: async (r: Record<string, unknown>) => { if (opts.failUpsert) return { error: { message: 'x' } }; rows.set(r.message_id as string, { ...(rows.get(r.message_id as string) ?? {}), ...r }); return { error: null }; },
    };
  } };
  return db;
}
const fakeFetch = (text: string, calls: any[] = []) => (async (_u: string, init: any) => { calls.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ content: [{ type: 'text', text }] }) }; }) as any;
const msg = { id: 'm1', subject: 'Devis', message: 'Bonjour, contactez-moi au +509 40 89 40 38 ou a@b.com pour un devis carrelage.' };

describe('InfGlo × messages de contact', () => {
  it('pastilles de tri : urgence, thème, langue, ton', () => {
    const b = contactBadges({ subject: 'URGENT', message: 'Mon paiement est bloqué, c’est urgent !! problème de facture' }).map((x) => x.label);
    expect(b).toContain('Urgent'); expect(b).toContain('Paiement'); expect(b).toContain('Ton négatif');
    expect(contactBadges({ subject: null, message: '...' })).toEqual([]);
  });
  it('génère, masque les données personnelles, met en cache (un seul appel IA)', async () => {
    const db = fakeDb(); const calls: any[] = []; const gen = new GenerativeClient({ apiKey: 'k', fetchImpl: fakeFetch('Demande de devis carrelage.', calls), limiter: new RateLimiter(5, 1) });
    const r1 = await generateForMessage(db, gen, 'summary', msg, 'u1'); expect(r1).toEqual({ ok: true, text: 'Demande de devis carrelage.', cached: false });
    const sent = calls[0].messages[0].content as string; expect(sent).toContain('[email]'); expect(sent).toContain('[tel]'); expect(sent).not.toContain('a@b.com');
    const r2 = await generateForMessage(db, gen, 'summary', msg, 'u1'); expect(r2.ok && r2.cached).toBe(true); expect(calls).toHaveLength(1);
    expect((await loadMessageAi(db, ['m1', 'm2'])).get('m1')?.summary).toBe('Demande de devis carrelage.');
  });
  it('résumé et brouillon sont indépendants (le second n’écrase pas le premier)', async () => {
    const db = fakeDb(); const gen = new GenerativeClient({ apiKey: 'k', fetchImpl: fakeFetch('texte'), limiter: new RateLimiter(5, 1) });
    await generateForMessage(db, gen, 'summary', msg, 'u'); await generateForMessage(db, gen, 'draft', msg, 'u');
    const r = (await loadMessageAi(db, ['m1'])).get('m1')!; expect(r.summary).toBe('texte'); expect(r.draft).toBe('texte');
  });
  it('sans clé : désactivé ; échec IA : indisponible ; stockage KO : signalé ; rien n’est enregistré à tort', async () => {
    const db = fakeDb();
    expect(await generateForMessage(db, new GenerativeClient({ apiKey: '' }), 'summary', msg, 'u')).toEqual({ ok: false, reason: 'disabled' });
    const bad = (async () => ({ ok: false, json: async () => ({}) })) as any;
    expect(await generateForMessage(db, new GenerativeClient({ apiKey: 'k', fetchImpl: bad }), 'draft', msg, 'u')).toEqual({ ok: false, reason: 'unavailable' }); expect(db.rows.size).toBe(0);
    const ko = fakeDb({ failUpsert: true }); expect(await generateForMessage(ko, new GenerativeClient({ apiKey: 'k', fetchImpl: fakeFetch('x'), limiter: new RateLimiter(5, 1) }), 'summary', msg, 'u')).toEqual({ ok: false, reason: 'storage' });
  });
  it('limite de débit par utilisateur', async () => {
    const lim = new RateLimiter(1, 0); const gen = new GenerativeClient({ apiKey: 'k', fetchImpl: fakeFetch('ok'), limiter: lim, now: () => 0 });
    expect((await generateForMessage(fakeDb(), gen, 'summary', msg, 'u1')).ok).toBe(true);
    expect(await generateForMessage(fakeDb(), gen, 'summary', { ...msg, id: 'm9' }, 'u1')).toEqual({ ok: false, reason: 'unavailable' });
    expect((await generateForMessage(fakeDb(), gen, 'summary', { ...msg, id: 'm8' }, 'u2')).ok).toBe(true);
  });
  it('table absente (migration non exécutée) : aucune exception à l’affichage', async () => {
    const boom = { from: () => ({ select: () => ({ in: async () => { throw new Error('relation absente'); } }) }) };
    expect((await loadMessageAi(boom, ['m1'])).size).toBe(0);
  });
});
