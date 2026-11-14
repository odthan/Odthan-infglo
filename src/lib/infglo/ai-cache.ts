/** Cache des textes générés par l'IA (une génération par élément et par type) — commun aux messages de contact et aux demandes. SERVEUR UNIQUEMENT. */
import type { Db } from './supabase-repo';

export type AiKind = 'summary' | 'draft';
export interface AiRow { summary: string | null; draft: string | null }
export type GenResult = { ok: true; text: string; cached: boolean } | { ok: false; reason: 'disabled' | 'unavailable' | 'storage' };
export interface AiTable { table: string; keyCol: string }

/** Textes déjà générés (table absente ou erreur → aucun résultat, sans exception : la migration n'est peut-être pas encore exécutée). */
export async function loadAiRows(db: Db, t: AiTable, ids: string[]): Promise<Map<string, AiRow>> {
  const out = new Map<string, AiRow>(); if (!ids.length) return out;
  try {
    const { data } = await db.from(t.table).select(`${t.keyCol},summary,draft`).in(t.keyCol, ids);
    ((data ?? []) as Record<string, string | null>[]).forEach((r) => out.set(r[t.keyCol] as string, { summary: r.summary ?? null, draft: r.draft ?? null }));
  } catch { /* table absente */ }
  return out;
}

/** Renvoie le texte en cache, sinon le produit via `produce`, l'enregistre et le renvoie. L'upsert ne touche que la colonne générée. */
export async function generateCached(db: Db, t: AiTable, id: string, kind: AiKind, enabled: boolean, produce: () => Promise<string | null>): Promise<GenResult> {
  const { data: cur } = await db.from(t.table).select(kind).eq(t.keyCol, id).maybeSingle();
  const cached = cur?.[kind]; if (typeof cached === 'string' && cached) return { ok: true, text: cached, cached: true };
  if (!enabled) return { ok: false, reason: 'disabled' };
  const text = await produce(); if (!text) return { ok: false, reason: 'unavailable' };
  const { error } = await db.from(t.table).upsert({ [t.keyCol]: id, [kind]: text, model: process.env.INFGLO_MODEL ?? 'claude-sonnet-5-5' }, { onConflict: t.keyCol });
  return error ? { ok: false, reason: 'storage' } : { ok: true, text, cached: false };
}
