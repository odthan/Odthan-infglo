// Composants visuels InfGlo — 100 % serveur (SVG + CSS, aucun JavaScript client). Palette : bleu foncé, noir, blanc.
import type { Forecast } from '@/lib/infglo';

export const C = { black: '#050A18', panel: '#0A1633', panel2: '#0D1F4A', blue: '#1D4ED8', blueSoft: '#60A5FA', line: '#1E3A8A' };
const SEV: Record<string, { bg: string; fg: string; label: string }> = {
  critical: { bg: '#7F1D1D', fg: '#FECACA', label: 'Critique' }, high: { bg: '#9A3412', fg: '#FED7AA', label: 'Élevée' },
  medium: { bg: '#1E3A8A', fg: '#BFDBFE', label: 'Moyenne' }, low: { bg: '#1F2937', fg: '#D1D5DB', label: 'Faible' }, info: { bg: '#1F2937', fg: '#D1D5DB', label: 'Info' },
};

export function InfGloStyles() {
  return <style>{`
    @keyframes ig-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
    @keyframes ig-pulse{0%,100%{opacity:1}50%{opacity:.35}}
    @keyframes ig-draw{from{stroke-dashoffset:var(--len)}to{stroke-dashoffset:0}}
    .ig-in{animation:ig-in .5s ease both}.ig-pulse{animation:ig-pulse 1.6s ease-in-out infinite}.ig-draw{stroke-dasharray:var(--len);animation:ig-draw 1.2s ease forwards}
    @media (prefers-reduced-motion:reduce){.ig-in,.ig-pulse,.ig-draw{animation:none}}
  `}</style>;
}

export function SeverityBadge({ s }: { s: string }) {
  const v = SEV[s] ?? SEV.info;
  return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: v.bg, color: v.fg }}>{s === 'critical' && <i className="ig-pulse inline-block h-1.5 w-1.5 rounded-full bg-red-300" />}{v.label}</span>;
}

export function Kpi({ label, value, hint, delay = 0 }: { label: string; value: string | number; hint?: string; delay?: number }) {
  return <div className="ig-in rounded-2xl border p-4" style={{ background: C.panel, borderColor: C.line, animationDelay: `${delay}ms` }}>
    <p className="text-xs uppercase tracking-wider text-blue-300">{label}</p><p className="mt-1 text-3xl font-bold text-white">{value}</p>{hint && <p className="mt-1 text-xs text-blue-200/70">{hint}</p>}
  </div>;
}

/** Jauge circulaire du score de risque (0–100). */
export function RiskRing({ score }: { score: number }) {
  const r = 52, circ = 2 * Math.PI * r, off = circ * (1 - Math.min(100, Math.max(0, score)) / 100);
  const col = score >= 60 ? '#F87171' : score >= 40 ? '#FBBF24' : C.blueSoft;
  return <svg viewBox="0 0 140 140" className="h-36 w-36" role="img" aria-label={`Score de risque ${score} sur 100`}>
    <circle cx="70" cy="70" r={r} fill="none" stroke={C.line} strokeWidth="12" />
    <circle cx="70" cy="70" r={r} fill="none" stroke={col} strokeWidth="12" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={off} transform="rotate(-90 70 70)" />
    <text x="70" y="68" textAnchor="middle" fill="#fff" fontSize="30" fontWeight="700">{score}</text><text x="70" y="88" textAnchor="middle" fill="#93C5FD" fontSize="11">/ 100</text>
  </svg>;
}

/** Courbe + prévision (pointillés) + bande de confiance. */
export function Spark({ values, fc }: { values: number[]; fc: Forecast | null }) {
  const W = 300, H = 90, P = 6;
  const pts = fc ? fc.points : []; const all = [...values, ...pts.flatMap((p) => [p.value, p.lower, p.upper])];
  if (values.length < 2) return <p className="py-6 text-center text-xs text-blue-200/60">Pas encore assez de données (au moins 2 mesures).</p>;
  const min = Math.min(...all), max = Math.max(...all), span = max - min || 1, n = values.length + pts.length - 1 || 1;
  const x = (i: number) => P + (i / n) * (W - 2 * P), y = (v: number) => H - P - ((v - min) / span) * (H - 2 * P);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  const fline = pts.length ? `M${x(last).toFixed(1)},${y(values[last]).toFixed(1)} ` + pts.map((p, i) => `L${x(last + 1 + i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ') : '';
  const band = pts.length ? pts.map((p, i) => `${i ? 'L' : 'M'}${x(last + 1 + i).toFixed(1)},${y(p.upper).toFixed(1)}`).join(' ') + ' ' + [...pts].reverse().map((p, i) => `L${x(last + pts.length - i).toFixed(1)},${y(p.lower).toFixed(1)}`).join(' ') + ' Z' : '';
  return <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" role="img" aria-label="Évolution et prévision" preserveAspectRatio="none">
    {band && <path d={band} fill={C.blue} opacity=".18" />}
    <path d={line} fill="none" stroke={C.blueSoft} strokeWidth="2" strokeLinejoin="round" className="ig-draw" style={{ ['--len' as string]: 1200 }} />
    {fline && <path d={fline} fill="none" stroke="#fff" strokeWidth="1.5" strokeDasharray="4 4" opacity=".8" />}
    <circle cx={x(last)} cy={y(values[last])} r="3.5" fill="#fff" />
  </svg>;
}

export const ARROW: Record<string, string> = { up: '▲ hausse', down: '▼ baisse', flat: '● stable' };
