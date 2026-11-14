import { SEVERITY_ORDER, type Severity } from './types';

/** Conditions déclaratives et sérialisables (JSON) : modifiables depuis l'admin sans redéployer. */
export type Op = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'exists';
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { fact: string; op: Op; value?: unknown };

export interface Rule {
  id: string;
  title: string;
  when: Condition;
  severity: Severity;
  /** texte affiché à l'utilisateur ; {fact.path} est remplacé par la valeur */
  recommendation: string;
  /** identifiant d'action automatisable (consommé par InfGlo Automation, phase suivante) */
  action?: string;
  priority?: number;
  enabled?: boolean;
}

export interface Decision { ruleId: string; title: string; severity: Severity; recommendation: string; action?: string; priority: number }

const MAX_DEPTH = 8;
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

/** Lecture sûre d'un chemin "a.b.c" (refuse les clés dangereuses : pas de pollution de prototype). */
export function getFact(facts: Record<string, unknown>, path: string): unknown {
  let cur: unknown = facts;
  for (const k of path.split('.')) {
    if (FORBIDDEN.has(k) || cur === null || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, k)) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function compare(a: unknown, op: Op, b: unknown): boolean {
  switch (op) {
    case 'exists': return a !== undefined && a !== null;
    case 'eq': return a === b;
    case 'neq': return a !== b;
    case 'in': return Array.isArray(b) && b.includes(a);
    case 'contains': return Array.isArray(a) ? a.includes(b) : typeof a === 'string' && typeof b === 'string' && a.includes(b);
    default: {
      if (typeof a !== 'number' || typeof b !== 'number' || Number.isNaN(a) || Number.isNaN(b)) return false;
      return op === 'gt' ? a > b : op === 'gte' ? a >= b : op === 'lt' ? a < b : a <= b;
    }
  }
}

export function evaluate(c: Condition, facts: Record<string, unknown>, depth = 0): boolean {
  if (depth > MAX_DEPTH) throw new Error('Condition trop profonde');
  if ('all' in c) return c.all.every((x) => evaluate(x, facts, depth + 1));
  if ('any' in c) return c.any.some((x) => evaluate(x, facts, depth + 1));
  if ('not' in c) return !evaluate(c.not, facts, depth + 1);
  return compare(getFact(facts, c.fact), c.op, c.value);
}

/** Valide la structure d'une règle (utile avant de l'enregistrer depuis une interface d'administration). */
export function validateRule(r: Rule): string | null {
  if (!r.id || !/^[a-z0-9._-]{3,64}$/.test(r.id)) return 'Identifiant de règle invalide';
  if (!(r.severity in SEVERITY_ORDER)) return 'Sévérité invalide';
  const check = (c: Condition, d: number): string | null => {
    if (d > MAX_DEPTH) return 'Condition trop profonde';
    if ('all' in c) { for (const x of c.all) { const e = check(x, d + 1); if (e) return e; } return null; }
    if ('any' in c) { for (const x of c.any) { const e = check(x, d + 1); if (e) return e; } return null; }
    if ('not' in c) return check(c.not, d + 1);
    if (typeof c.fact !== 'string' || c.fact.split('.').some((k) => !k || FORBIDDEN.has(k))) return 'Chemin de fait invalide';
    return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains', 'exists'].includes(c.op) ? null : 'Opérateur invalide';
  };
  return check(r.when, 0);
}

const fill = (tpl: string, facts: Record<string, unknown>) =>
  tpl.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_, p: string) => { const v = getFact(facts, p); return v === undefined ? '?' : String(v); });

/** InfGlo Decision Engine : évalue les règles, renvoie les décisions triées (gravité puis priorité). */
export class DecisionEngine {
  private rules = new Map<string, Rule>();
  constructor(rules: Rule[] = []) { rules.forEach((r) => this.addRule(r)); }

  addRule(r: Rule): void {
    const err = validateRule(r); if (err) throw new Error(`Règle « ${r.id} » refusée : ${err}`);
    this.rules.set(r.id, r);
  }
  removeRule(id: string): boolean { return this.rules.delete(id); }
  listRules(): Rule[] { return [...this.rules.values()]; }

  decide(facts: Record<string, unknown>): Decision[] {
    const out: Decision[] = [];
    for (const r of this.rules.values()) {
      if (r.enabled === false) continue;
      let hit = false;
      try { hit = evaluate(r.when, facts); } catch { hit = false; }
      if (hit) out.push({ ruleId: r.id, title: r.title, severity: r.severity, recommendation: fill(r.recommendation, facts), action: r.action, priority: r.priority ?? 0 });
    }
    return out.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] || b.priority - a.priority || a.ruleId.localeCompare(b.ruleId));
  }
}

export interface RiskFactor { name: string; value: number; weight: number; max: number }
/** Score de risque 0–100 : moyenne pondérée de facteurs normalisés (value/max, bornés à [0,1]). */
export function riskScore(factors: RiskFactor[]): { score: number; level: Severity; top: string[] } {
  const tw = factors.reduce((s, f) => s + Math.max(0, f.weight), 0);
  if (!tw) return { score: 0, level: 'info', top: [] };
  const norm = factors.map((f) => ({ n: f.name, c: (Math.max(0, f.weight) * Math.min(1, Math.max(0, f.max ? f.value / f.max : 0))) / tw }));
  const score = Math.round(norm.reduce((s, x) => s + x.c, 0) * 100);
  const level: Severity = score >= 80 ? 'critical' : score >= 60 ? 'high' : score >= 40 ? 'medium' : score >= 20 ? 'low' : 'info';
  return { score, level, top: norm.sort((a, b) => b.c - a.c).filter((x) => x.c > 0).slice(0, 3).map((x) => x.n) };
}
