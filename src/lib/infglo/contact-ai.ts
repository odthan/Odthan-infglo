/**
 * InfGlo × Messages de contact — SERVEUR UNIQUEMENT.
 * Analyse locale instantanée + résumé/brouillon IA à la demande, mis en cache (voir ai-cache.ts).
 */
import { textBadges, type Badge } from './badges';
import { generateCached, loadAiRows, type AiRow, type GenResult, type AiKind } from './ai-cache';
import type { GenerativeClient } from './generative';
import type { Db } from './supabase-repo';

const T = { table: 'infglo_message_ai', keyCol: 'message_id' };
export interface ContactInput { id: string; subject?: string | null; message: string }
export type ContactBadge = Badge;

export const contactBadges = (m: Pick<ContactInput, 'subject' | 'message'>): Badge[] => textBadges(`${m.subject ?? ''}\n${m.message}`);
export const loadMessageAi = (db: Db, ids: string[]): Promise<Map<string, AiRow>> => loadAiRows(db, T, ids);

export function generateForMessage(db: Db, gen: GenerativeClient, kind: AiKind, msg: ContactInput, rateKey: string): Promise<GenResult> {
  const input = `Sujet : ${msg.subject ?? '(aucun)'}\n${msg.message}`;
  return generateCached(db, T, msg.id, kind, gen.enabled, () => (kind === 'summary' ? gen.summarize(input, rateKey) : gen.draftReply(input, rateKey)));
}
