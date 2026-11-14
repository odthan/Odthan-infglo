/**
 * InfGlo NLP — analyse locale, rapide et sans coût (FR / Créole haïtien / EN) :
 * langue, urgence, sentiment, thèmes, mots-clés. Sert au tri des messages et demandes ; l'IA générative (generative.ts) complète pour les résumés.
 */
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const set = (s: string) => new Set(s.split(/\s+/).filter(Boolean).map(norm));

const STOP = {
  fr: set('le la les des un une et est pour dans que qui pas je nous vous bonjour merci avec sur ce cette mon ma mes votre vos du au aux ne'),
  en: set('the and is are for with you your this that have please hello thanks from our can would'),
  ht: set('mwen nou yo nan pou ak se sa ki pa gen te ap kote tanpri mesi bonjou kijan li konn'),
} as const;
export type Lang = 'fr' | 'en' | 'ht' | 'unknown';

export function tokenize(text: string): string[] { return norm(text).split(/[^a-z0-9]+/).filter((t) => t.length > 1); }

export function detectLang(text: string): Lang {
  const t = tokenize(text); let best: Lang = 'unknown', top = 1;
  (Object.keys(STOP) as Array<'fr' | 'en' | 'ht'>).forEach((l) => { const n = t.filter((w) => STOP[l].has(w)).length; if (n > top) { top = n; best = l; } });
  return best;
}

const URGENT = set('urgent urgence immediat immediatement rapidement vite asap bloque bloquee panne critique ijan rapid bloke immediately emergency');
const POS = set('merci excellent parfait super satisfait bravo genial mesi bon thanks great perfect good happy');
const NEG = set('probleme erreur bug panne mauvais retard decu arnaque nul inacceptable pwoblem move reta problem error bad late');
const NEGATORS = set('pas ne jamais pa not no never');
const TOPICS: Record<string, Set<string>> = {
  construction: set('construction carrelage maison chantier plan devis renovation batiment kay konstriksyon'),
  numerique: set('site web application logiciel informatique app developpement digital sit'),
  paiement: set('paiement payer facture prix paypal carte remboursement peman lajan pay payment invoice'),
  compte: set('compte mot passe connexion login inscription kont password account'),
  support: set('probleme erreur bug bloque aide assistance help support pwoblem'),
};

export interface TextAnalysis { lang: Lang; urgency: 'high' | 'normal'; urgencyScore: number; sentiment: number; topics: string[]; keywords: string[] }

export function analyzeText(text: string, maxKeywords = 5): TextAnalysis {
  const raw = text.slice(0, 5000); const t = tokenize(raw);
  const urgentHits = t.filter((w) => URGENT.has(w)).length; const excl = Math.min(2, (raw.match(/!/g) ?? []).length);
  const urgencyScore = 2 * urgentHits + excl;
  let pos = 0, neg = 0;
  t.forEach((w, i) => { const flip = i > 0 && NEGATORS.has(t[i - 1]); if (POS.has(w)) flip ? neg++ : pos++; else if (NEG.has(w)) flip ? pos++ : neg++; });
  const topics = Object.entries(TOPICS).map(([k, v]) => [k, t.filter((w) => v.has(w)).length] as const).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const all = new Set([...STOP.fr, ...STOP.en, ...STOP.ht]); const freq = new Map<string, number>();
  t.filter((w) => w.length >= 4 && !all.has(w) && !/^\d+$/.test(w)).forEach((w) => freq.set(w, (freq.get(w) ?? 0) + 1));
  const keywords = [...freq].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, maxKeywords).map(([w]) => w);
  return { lang: detectLang(raw), urgency: urgencyScore >= 3 ? 'high' : 'normal', urgencyScore, sentiment: pos + neg ? (pos - neg) / (pos + neg) : 0, topics, keywords };
}
