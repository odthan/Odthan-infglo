import type { ActionRecord } from './automation';
import type { AuditEntry } from './security';
import type { Insight } from './types';

export interface Snapshot { facts: Record<string, unknown>; metrics: Record<string, number> }
export interface RunSummary { at: number; risk: number; riskLevel: string; insights: number; saved: number; actions: number; health: unknown }

/** Contrat de persistance/collecte d'InfGlo : implémenté pour Supabase (supabase-repo.ts) et en mémoire pour les tests. */
export interface InfGloRepository {
  collect(now: number): Promise<Snapshot>;
  loadHistory(names: string[], limit: number): Promise<Record<string, number[]>>;
  saveMetrics(m: Record<string, number>, at: number): Promise<void>;
  recentInsightKeys(sinceMs: number): Promise<Set<string>>;
  /** retourne coreId → identifiant en base */
  saveInsights(list: Insight[]): Promise<Map<string, string>>;
  setInsightStatus(dbId: string, status: 'open' | 'escalated' | 'dismissed' | 'resolved'): Promise<void>;
  feedbackCounts(): Promise<{ ruleId: string; up: number; down: number }[]>;
  saveActions(records: ActionRecord[]): Promise<void>;
  lastAudit(): Promise<{ seq: number; hash: string } | null>;
  saveAudit(entries: AuditEntry[]): Promise<void>;
  /** notifie les personnes ayant l'un des rôles (retourne le nombre de destinataires) */
  notifyRoles(roles: string[], n: { title: string; body: string; link: string }): Promise<number>;
  saveRun(s: RunSummary): Promise<void>;
}
