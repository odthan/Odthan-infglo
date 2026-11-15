import { describe, expect, it } from 'vitest';
import { GenerativeClient, RateLimiter, buildRequestInput, generateForMessage, generateForRequest, loadRequestAi, requestBadges } from '@/lib/infglo/server';

/** Faux Supabase : une « table » par nom, clé primaire configurable, upsert fusionnant comme PostgREST. */
function fakeDb() {
  const tables: Record<string, Map<string, Record<string, unknown>>> = {};
  const T = (n: string) => (tables[n] ??= new Map());
  const keyOf: Record<string, string> = { infglo_request_ai: 'request_id', infglo_message_ai: 'message_id' };
  return { tables, from: (t: string) => ({
    select: () => ({
      in: async (_c: string, ids: string[]) => ({ data: ids.filter((i) => T(t).has(i)).map((i) => ({ [keyOf[t]]: i, summary: null, draft: null, ...T(t).get(i) })) }),
      eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: T(t).get(id) ?? null }) }),
    }),
    upsert: async (r: Record<string, unknown>) => { const k = r[keyOf[t]] as string; T(t).set(k, { ...(T(t).get(k) ?? {}), ...r }); return { error: null }; },
  }) };
}
const mkFetch = (text: string, calls: any[] = []) => (async (_u: string, init: any) => { calls.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ content: [{ type: 'text', text }] }) }; }) as any;
const gen = (text: string, calls: any[] = []) => new GenerativeClient({ apiKey: 'k', fetchImpl: mkFetch(text, calls), limiter: new RateLimiter(10, 1) });
const NOW = Date.parse('2026-11-14T12:00:00Z');
const req = { id: 'r1', service_name: 'KONSTRIVAL', project_name: 'Carrelage villa', description: 'Je souhaite carreler ma maison de 120 m² à Port-au-Prince, contactez-moi au +509 40 89 40 38.', country: 'Haïti', city: 'Port-au-Prince', budget_amount: null, budget_currency: null, desired_date: null, status: 'new', created_at: '2026-11-10T12:00:00Z' };

describe('InfGlo × demandes de service', () => {
  it('pastilles : retard > 48 h, complétude du dossier, thème', () => {
    const l = requestBadges(req, NOW).map((b) => b.label);
    expect(l).toContain('En attente > 48 h'); expect(l).toContain('Budget non précisé'); expect(l).toContain('Délai non précisé'); expect(l).toContain('Construction');
    const ok = requestBadges({ ...req, status: 'in_progress', budget_amount: 5000, budget_currency: 'USD', desired_date: '2026-12-01' }, NOW).map((b) => b.label);
    expect(ok).not.toContain('En attente > 48 h'); expect(ok).not.toContain('Budget non précisé');
    expect(requestBadges({ ...req, description: 'court' }, NOW).map((b) => b.label)).toContain('Description courte');
  });
  it('le texte envoyé à l’IA ne contient AUCUNE coordonnée du client', async () => {
    expect(buildRequestInput(req)).toContain('Service : KONSTRIVAL');
    const calls: any[] = []; const db = fakeDb();
    const r = await generateForRequest(db, gen('Besoin : carrelage de 120 m².', calls), 'summary', { ...req, contact_email: 'client@mail.com', contact_name: 'Jean Dupont' } as any, 'u1');
    expect(r).toEqual({ ok: true, text: 'Besoin : carrelage de 120 m².', cached: false });
    const sent = calls[0].messages[0].content as string;
    expect(sent).not.toContain('Jean'); expect(sent).not.toContain('client@mail.com'); expect(sent).not.toContain('40 89 40 38'); expect(sent).toContain('[tel]');
    expect(calls[0].messages[0].content).toContain('informations manquantes');
  });
  it('brouillon : prompt dédié (pas de promesse de prix/délai), cache indépendant du résumé', async () => {
    const calls: any[] = []; const db = fakeDb(); const g = gen('Bonjour, merci pour votre demande…', calls);
    await generateForRequest(db, g, 'summary', req, 'u'); await generateForRequest(db, g, 'draft', req, 'u');
    expect(calls[1].messages[0].content).toContain('Ne promets AUCUN prix'); expect(calls[1].messages[0].content).toContain('messagerie');
    const row = (await loadRequestAi(db, ['r1'])).get('r1')!; expect(row.summary).toBeTruthy(); expect(row.draft).toBeTruthy();
    await generateForRequest(db, g, 'draft', req, 'u'); expect(calls).toHaveLength(2);   // 3ᵉ appel servi par le cache
  });
  it('les tables « demandes » et « contacts » ne se mélangent pas', async () => {
    const db = fakeDb(); const g = gen('x');
    await generateForRequest(db, g, 'summary', { ...req, id: 'same-id' }, 'u');
    expect(db.tables.infglo_request_ai.size).toBe(1); expect(db.tables.infglo_message_ai).toBeUndefined();
    await generateForMessage(db, g, 'summary', { id: 'same-id', message: 'bonjour à tous' }, 'u'); expect(db.tables.infglo_message_ai.size).toBe(1);
  });
  it('sans clé : désactivé ; table absente : aucune exception', async () => {
    expect(await generateForRequest(fakeDb(), new GenerativeClient({ apiKey: '' }), 'summary', req, 'u')).toEqual({ ok: false, reason: 'disabled' });
    expect((await loadRequestAi({ from: () => ({ select: () => ({ in: async () => { throw new Error('absente'); } }) }) }, ['r1'])).size).toBe(0);
  });
});
