/**
 * InfGlo × Demandes de service — SERVEUR UNIQUEMENT.
 * Pastilles de tri locales + résumé / brouillon de réponse IA à la demande (cache : table infglo_request_ai).
 * Seuls les champs utiles au besoin sont envoyés à l'IA : jamais le nom, l'e-mail ni le téléphone du client.
 */
import { textBadges, type Badge } from './badges';
import { generateCached, loadAiRows, type AiKind, type AiRow, type GenResult } from './ai-cache';
import type { GenerativeClient } from './generative';
import type { Db } from './supabase-repo';

const T = { table: 'infglo_request_ai', keyCol: 'request_id' };
export interface RequestInput {
  id: string; service_name: string; project_name: string; description: string; country: string; city?: string | null;
  budget_amount?: number | string | null; budget_currency?: string | null; desired_date?: string | null;
  status?: string; created_at?: string;
}

/** Texte transmis à l'IA : uniquement les informations de la demande, sans coordonnées. */
export function buildRequestInput(r: RequestInput): string {
  return [
    `Service : ${r.service_name}`, `Projet : ${r.project_name}`, `Lieu : ${r.country}${r.city ? `, ${r.city}` : ''}`,
    `Budget : ${r.budget_amount ? `${r.budget_amount} ${r.budget_currency ?? ''}`.trim() : 'non précisé'}`, `Date souhaitée : ${r.desired_date ?? 'non précisée'}`,
    `Description :\n${r.description}`,
  ].join('\n');
}

/** Pastilles : analyse du texte + complétude du dossier + retard de traitement (même seuil que la règle « requests.stale » : 48 h). */
export function requestBadges(r: RequestInput, now = Date.now()): Badge[] {
  const out: Badge[] = [];
  if (r.created_at && (r.status === 'new' || r.status === 'analyzing') && now - Date.parse(r.created_at) > 48 * 3_600_000) out.push({ label: 'En attente > 48 h', tone: 'alert' });
  out.push(...textBadges(`${r.project_name}\n${r.description}`));
  if (!r.budget_amount) out.push({ label: 'Budget non précisé', tone: 'warn' });
  if (!r.desired_date) out.push({ label: 'Délai non précisé', tone: 'warn' });
  if (r.description.trim().length < 40) out.push({ label: 'Description courte', tone: 'warn' });
  return out;
}

export const loadRequestAi = (db: Db, ids: string[]): Promise<Map<string, AiRow>> => loadAiRows(db, T, ids);

export function generateForRequest(db: Db, gen: GenerativeClient, kind: AiKind, r: RequestInput, rateKey: string): Promise<GenResult> {
  const input = buildRequestInput(r);
  return generateCached(db, T, r.id, kind, gen.enabled, () => (kind === 'summary' ? gen.summarizeRequest(input, rateKey) : gen.draftRequestReply(input, rateKey)));
}
