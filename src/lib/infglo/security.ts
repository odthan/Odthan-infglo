/**
 * InfGlo Security — SERVEUR UNIQUEMENT (utilise node:crypto).
 * Audit infalsifiable (chaîne de hachage SHA-256), détection de force brute, limitation de débit, masquage des données personnelles.
 */
import { createHash } from 'node:crypto';
import type { InfGloContext, InfGloEvent, InfGloModule } from './types';

export const GENESIS = '0'.repeat(64);
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
/** Identifiant anonymisé (jamais l'e-mail ou l'IP en clair dans les journaux). */
export const hashId = (raw: string, salt = '') => sha256(salt + raw.trim().toLowerCase()).slice(0, 32);

function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}';
}

export interface AuditEntry { seq: number; at: number; actor: string; action: string; target: string | null; data: Record<string, unknown> | null; prev: string; hash: string }
export const entryHash = (e: Omit<AuditEntry, 'hash'>) => sha256(stable([e.seq, e.at, e.actor, e.action, e.target, e.data, e.prev]));

/** Journal d'audit chaîné : modifier ou supprimer une entrée passée casse la chaîne et se détecte. */
export class AuditChain {
  private entries: AuditEntry[] = []; private lastHash: string; private lastSeq: number;
  constructor(head?: { seq: number; hash: string } | null, private readonly max = 1000) { this.lastHash = head?.hash ?? GENESIS; this.lastSeq = head?.seq ?? 0; }
  append(actor: string, action: string, at: number, target?: string, data?: Record<string, unknown>): AuditEntry {
    const base = { seq: this.lastSeq + 1, at, actor, action, target: target ?? null, data: data ?? null, prev: this.lastHash };
    const e: AuditEntry = { ...base, hash: entryHash(base) };
    this.entries.push(e); this.lastHash = e.hash; this.lastSeq = e.seq;
    if (this.entries.length > this.max) this.entries.shift();
    return e;
  }
  get all(): AuditEntry[] { return [...this.entries]; }
  head() { return { seq: this.lastSeq, hash: this.lastHash }; }
  static verify(entries: AuditEntry[], from?: string): { ok: boolean; brokenAt?: number } {
    let prev = from ?? entries[0]?.prev ?? GENESIS; let seq = entries[0] ? entries[0].seq - 1 : 0;
    for (const e of entries) {
      if (e.prev !== prev || e.seq !== seq + 1 || entryHash({ seq: e.seq, at: e.at, actor: e.actor, action: e.action, target: e.target, data: e.data, prev: e.prev }) !== e.hash) return { ok: false, brokenAt: e.seq };
      prev = e.hash; seq = e.seq;
    }
    return { ok: true };
  }
}

/** Compteur à fenêtre glissante, mémoire bornée. */
export class SlidingWindowCounter {
  private hits = new Map<string, number[]>();
  constructor(private readonly windowMs: number, private readonly maxKeys = 5000) {}
  hit(key: string, at: number): number {
    const arr = (this.hits.get(key) ?? []).filter((t) => at - t < this.windowMs); arr.push(at);
    this.hits.delete(key); this.hits.set(key, arr);
    if (this.hits.size > this.maxKeys) this.hits.delete(this.hits.keys().next().value as string);
    return arr.length;
  }
  count(key: string, at: number): number { return (this.hits.get(key) ?? []).filter((t) => at - t < this.windowMs).length; }
}

/** Seau à jetons (protège les endpoints coûteux, ex. appel IA). */
export class RateLimiter {
  private b = new Map<string, { tokens: number; at: number }>();
  constructor(private readonly capacity: number, private readonly refillPerSec: number, private readonly maxKeys = 5000) {}
  allow(key: string, at: number): boolean {
    const cur = this.b.get(key) ?? { tokens: this.capacity, at };
    const tokens = Math.min(this.capacity, cur.tokens + ((at - cur.at) / 1000) * this.refillPerSec);
    const ok = tokens >= 1; this.b.delete(key); this.b.set(key, { tokens: ok ? tokens - 1 : tokens, at });
    if (this.b.size > this.maxKeys) this.b.delete(this.b.keys().next().value as string);
    return ok;
  }
}

/** Masque e-mails, numéros de carte, téléphones (≥ 8 chiffres, hors dates ISO) et secrets avant journalisation ou envoi à une IA. */
export function redactPII(s: string): string {
  return s
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '[carte]')
    .replace(/\+?\d[\d ().-]{6,}\d/g, (m) => (/^\d{4}-\d{2}-\d{2}$/.test(m) || m.replace(/\D/g, '').length < 8 ? m : '[tel]'))
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[secret]');
}

export interface SecurityOptions { threshold?: number; windowMs?: number; salt?: string; head?: { seq: number; hash: string } | null }

/**
 * Module Security : "auth.login_failed" {key} → alerte critique si ≥ seuil échecs dans la fenêtre pour une même identité ;
 * tout évènement "admin.*" {actor,target?} est inscrit dans la chaîne d'audit.
 */
export class SecurityModule implements InfGloModule {
  readonly name = 'infglo.security'; readonly version = '1.0.0';
  private ctx!: InfGloContext; private readonly counter: SlidingWindowCounter; private alerted = new Map<string, number>();
  readonly audit: AuditChain; private readonly threshold: number; private readonly windowMs: number; private readonly salt: string;
  constructor(o: SecurityOptions = {}) {
    this.threshold = o.threshold ?? 10; this.windowMs = o.windowMs ?? 3_600_000; this.salt = o.salt ?? '';
    this.counter = new SlidingWindowCounter(this.windowMs); this.audit = new AuditChain(o.head);
  }
  init(ctx: InfGloContext) { this.ctx = ctx; }
  handle(e: InfGloEvent) {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    if (e.type === 'auth.login_failed' && typeof p.key === 'string' && p.key) {
      const id = hashId(p.key, this.salt); const n = this.counter.hit(id, e.at);
      if (n >= this.threshold && e.at - (this.alerted.get(id) ?? -Infinity) >= this.windowMs) {
        this.alerted.set(id, e.at);
        this.audit.append('infglo.security', 'security.bruteforce_suspected', e.at, id.slice(0, 8), { attempts: n });
        this.ctx.emitInsight({ kind: 'alert', severity: 'critical', source: e.source, title: 'Tentatives de connexion répétées',
          detail: `${n} échecs de connexion pour une même identité (réf. ${id.slice(0, 8)}) en moins d'une heure.`, data: { ref: id.slice(0, 8), attempts: n, action: 'security.review', ruleId: 'security.bruteforce.identity' } });
      }
    } else if (e.type.startsWith('admin.') && typeof p.actor === 'string') {
      this.audit.append(p.actor, e.type, e.at, typeof p.target === 'string' ? p.target : undefined);
    }
  }
}
