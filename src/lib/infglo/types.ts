/**
 * InfGlo — types partagés.
 * Pourquoi : un contrat unique entre le noyau et tous les modules ODTHAN (aucune dépendance croisée).
 */
export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export const SEVERITY_ORDER: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

export interface InfGloEvent<T = unknown> {
  id: string;
  /** ex. "metric.recorded", "facts.updated", "request.created" */
  type: string;
  /** module ou service émetteur, ex. "odthan.requests" */
  source: string;
  /** horodatage ms (horloge du noyau) */
  at: number;
  payload: T;
}

export type InsightKind = 'anomaly' | 'prediction' | 'recommendation' | 'alert';

export interface Insight {
  id: string;
  kind: InsightKind;
  severity: Severity;
  title: string;
  detail: string;
  source: string;
  at: number;
  data?: Record<string, unknown>;
}

export interface Logger {
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
}

export interface InfGloContext {
  publish(type: string, payload: unknown, source: string): Promise<InfGloEvent>;
  emitInsight(i: Omit<Insight, 'id' | 'at'>): Insight;
  now(): number;
  logger: Logger;
}

export interface ModuleHealth {
  status: 'ok' | 'degraded' | 'down';
  detail?: string;
}

/** Tout module InfGlo (interne ou adaptateur d'un module ODTHAN) implémente ce contrat. */
export interface InfGloModule {
  readonly name: string;
  readonly version: string;
  init?(ctx: InfGloContext): void | Promise<void>;
  handle?(event: InfGloEvent): void | Promise<void>;
  health?(): ModuleHealth;
  dispose?(): void | Promise<void>;
}
