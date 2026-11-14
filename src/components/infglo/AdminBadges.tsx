// Pastilles InfGlo pour les pages d'administration (thème clair existant) — composant serveur.
import type { Badge } from '@/lib/infglo';

const TONE: Record<Badge['tone'], string> = { alert: 'bg-brand text-white', warn: 'bg-amber-100 text-amber-900', good: 'bg-green-100 text-green-900', neutral: 'bg-neutral-100 text-neutral-700' };
export function BadgeRow({ badges }: { badges: Badge[] }) {
  if (!badges.length) return null;
  return <p className="mt-2 flex flex-wrap gap-1.5" aria-label="Analyse InfGlo">{badges.map((b) => <span key={b.label} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[b.tone]}`}>{b.label}</span>)}</p>;
}
