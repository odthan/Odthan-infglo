import { analyzeText } from './nlp';

export interface Badge { label: string; tone: 'alert' | 'warn' | 'good' | 'neutral' }
const LANG = { fr: 'Français', ht: 'Créole', en: 'Anglais', unknown: '' } as const;

/** Pastilles d'aide au tri issues de l'analyse locale d'un texte (urgence, thème, langue, ton). */
export function textBadges(text: string): Badge[] {
  const a = analyzeText(text); const out: Badge[] = [];
  if (a.urgency === 'high') out.push({ label: 'Urgent', tone: 'alert' });
  if (a.topics[0]) out.push({ label: a.topics[0].charAt(0).toUpperCase() + a.topics[0].slice(1), tone: 'neutral' });
  if (LANG[a.lang]) out.push({ label: LANG[a.lang], tone: 'neutral' });
  if (a.sentiment <= -0.5) out.push({ label: 'Ton négatif', tone: 'warn' }); else if (a.sentiment >= 0.5) out.push({ label: 'Ton positif', tone: 'good' });
  return out;
}
