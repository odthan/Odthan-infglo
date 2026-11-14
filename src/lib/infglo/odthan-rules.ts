import type { Rule } from './decision';

/**
 * Règles de départ pour le portail ODTHAN (services, demandes, messages, sécurité).
 * Les « faits » (requests.*, messages.*, auth.*, services.*) seront alimentés en phase 2
 * par des requêtes Supabase côté serveur (RLS/rôles respectés).
 */
export const ODTHAN_DEFAULT_RULES: Rule[] = [
  { id: 'requests.stale', title: 'Demandes en attente trop longtemps', severity: 'high', priority: 10, action: 'notify.admin',
    when: { fact: 'requests.pending_over_48h', op: 'gt', value: 0 },
    recommendation: '{requests.pending_over_48h} demande(s) sans réponse depuis plus de 48 h : traitez-les en priorité.' },
  { id: 'requests.backlog', title: 'File de demandes en forte hausse', severity: 'medium', priority: 5,
    when: { all: [{ fact: 'requests.open_count', op: 'gte', value: 20 }, { fact: 'requests.trend', op: 'eq', value: 'up' }] },
    recommendation: '{requests.open_count} demandes ouvertes et la tendance monte : envisagez de renforcer le support.' },
  { id: 'messages.unanswered', title: 'Messages de contact sans réponse', severity: 'medium', priority: 4, action: 'notify.support',
    when: { fact: 'messages.unanswered_over_24h', op: 'gt', value: 0 },
    recommendation: '{messages.unanswered_over_24h} message(s) de contact attendent une réponse depuis plus de 24 h.' },
  { id: 'security.bruteforce', title: 'Pic de connexions échouées', severity: 'critical', priority: 20, action: 'security.review',
    when: { fact: 'auth.failed_logins_last_hour', op: 'gte', value: 30 },
    recommendation: '{auth.failed_logins_last_hour} échecs de connexion en 1 h : possible attaque par force brute, vérifiez le journal.' },
  { id: 'services.drafts', title: 'Services en brouillon', severity: 'low', priority: 1,
    when: { fact: 'services.draft_count', op: 'gte', value: 3 },
    recommendation: '{services.draft_count} services sont encore en brouillon : publiez-les ou archivez-les.' },
];
