import { checkPerm } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { loadDashboard } from '@/lib/infglo/server';
import { ARROW, C, InfGloStyles, Kpi, RiskRing, SeverityBadge, Spark } from '@/components/infglo/InfGloUI';
import { Forbidden } from '@/components/admin-ui';
import { decideAction, dismissInsight, runNow, sendFeedback } from './actions';

export const metadata = { title: 'InfGlo' };
export const dynamic = 'force-dynamic';

const btn = 'min-h-10 rounded-lg px-3 text-sm font-semibold transition active:scale-95';

export default async function InfGloPage({ searchParams }: { searchParams: Promise<{ m?: string; e?: string }> }) {
  const a = await checkPerm('users.manage'); if (!a) return <Forbidden />;
  const sp = await searchParams;
  let d: Awaited<ReturnType<typeof loadDashboard>> | null = null; let failed = false;
  try { d = await loadDashboard(await createAdminClient()); } catch { failed = true; }

  const risk = d?.run?.risk ?? 0;
  const modules = Object.entries(d?.run?.summary?.health?.modules ?? {});
  const critical = (d?.insights ?? []).filter((i) => i.severity === 'critical' || i.severity === 'high').length;
  return (
    <div className="-mx-1 rounded-3xl p-4 text-white sm:p-6" style={{ background: `linear-gradient(160deg, ${C.black} 0%, ${C.panel} 100%)` }}>
      <InfGloStyles />
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-extrabold tracking-tight">Inf<span style={{ color: C.blueSoft }}>Glo</span></h1>
          <p className="text-xs text-blue-200/70">Infinite Vision · Global Ambition — {d?.run ? `dernière analyse : ${new Date(d.run.at).toLocaleString('fr-FR')}` : 'aucune analyse encore exécutée'}</p></div>
        <form action={runNow}><button className={`${btn} text-white`} style={{ background: C.blue }}>Lancer l’analyse</button></form>
      </header>

      {sp.m && <p role="status" className="mb-4 rounded-xl border border-blue-500/40 bg-blue-500/10 p-3 text-sm">{sp.m}</p>}
      {(sp.e || failed) && <p role="alert" className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm">{sp.e ?? 'Données InfGlo indisponibles : exécutez la migration 007_infglo.sql.'}</p>}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="ig-in col-span-2 flex items-center justify-center rounded-2xl border p-2 md:col-span-1" style={{ background: C.panel, borderColor: C.line }}><RiskRing score={risk} /></div>
        <Kpi label="Alertes ouvertes" value={d?.insights.length ?? 0} hint="insights à traiter" delay={80} />
        <Kpi label="Priorité haute" value={critical} hint="élevée ou critique" delay={160} />
        <Kpi label="Modules" value={`${modules.filter(([, m]) => m.status === 'ok').length}/${modules.length || '–'}`} hint="en bonne santé" delay={240} />
      </section>

      {(d?.pendingActions.length ?? 0) > 0 && (
        <section className="mt-6"><h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-blue-300">Actions à valider</h2>
          <ul className="space-y-2">{d!.pendingActions.map((p) => (
            <li key={p.id} className="ig-in rounded-2xl border p-4" style={{ background: C.panel2, borderColor: C.blue }}>
              <p className="font-semibold">{p.insight_title ?? 'Insight'}</p><p className="text-xs text-blue-200/70">Action proposée : {p.action}</p>
              <div className="mt-3 flex gap-2">
                <form action={decideAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="approve" value="1" /><button className={`${btn} text-white`} style={{ background: C.blue }}>Approuver</button></form>
                <form action={decideAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="approve" value="0" /><button className={`${btn} border border-blue-400/40 text-blue-100`}>Refuser</button></form>
              </div></li>))}</ul></section>)}

      <section className="mt-6"><h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-blue-300">Tendances & prévisions (7 jours)</h2>
        <div className="grid gap-3 md:grid-cols-2">{(d?.series ?? []).map((s, i) => (
          <article key={s.name} className="ig-in rounded-2xl border p-4" style={{ background: C.panel, borderColor: C.line, animationDelay: `${i * 70}ms` }}>
            <div className="flex items-baseline justify-between"><h3 className="text-sm font-semibold">{s.label}</h3><span className="text-xs text-blue-300">{ARROW[s.trend]}</span></div>
            <p className="text-2xl font-bold">{s.last === null ? '–' : Math.round(s.last * 10) / 10}</p><Spark values={s.values} fc={s.forecast} />
            {s.forecast && <p className="text-xs text-blue-200/70">Dans 7 jours : ≈ {Math.round(s.forecast.points[6].value)} (intervalle {Math.round(s.forecast.points[6].lower)}–{Math.round(s.forecast.points[6].upper)})</p>}
          </article>))}</div></section>

      <section className="mt-6"><h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-blue-300">Insights & recommandations</h2>
        {(d?.insights.length ?? 0) === 0 ? <p className="rounded-2xl border p-4 text-sm text-blue-200/70" style={{ borderColor: C.line }}>Aucun insight ouvert. Tout est calme.</p> :
          <ul className="space-y-3">{d!.insights.map((i) => (
            <li key={i.id} className="ig-in rounded-2xl border p-4" style={{ background: C.panel, borderColor: C.line }}>
              <div className="flex flex-wrap items-center gap-2"><SeverityBadge s={i.severity} /><span className="text-xs text-blue-300">{i.kind === 'anomaly' ? 'Anomalie' : i.kind === 'alert' ? 'Alerte' : 'Recommandation'}</span>
                <span className="ml-auto text-xs text-blue-200/60">{new Date(i.created_at).toLocaleString('fr-FR')}</span></div>
              <p className="mt-2 font-semibold">{i.title}</p><p className="text-sm text-blue-100/80">{i.detail}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <form action={sendFeedback}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="useful" value="1" /><button className={`${btn} border border-blue-400/40 text-blue-100`}>👍 Utile</button></form>
                <form action={sendFeedback}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="useful" value="0" /><button className={`${btn} border border-blue-400/40 text-blue-100`}>👎 Pas utile</button></form>
                <form action={dismissInsight}><input type="hidden" name="id" value={i.id} /><button className={`${btn} text-blue-200/80 underline`}>Écarter</button></form>
              </div></li>))}</ul>}</section>

      {modules.length > 0 && <section className="mt-6"><h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-blue-300">Santé des modules</h2>
        <ul className="grid grid-cols-2 gap-2 md:grid-cols-3">{modules.map(([n, m]) => (
          <li key={n} className="rounded-xl border p-3 text-sm" style={{ background: C.panel, borderColor: C.line }}>
            <p className="flex items-center gap-2 font-semibold"><i className={`inline-block h-2 w-2 rounded-full ${m.status === 'ok' ? 'bg-emerald-400' : 'ig-pulse bg-amber-400'}`} />{n.replace('infglo.', '')}</p>
            <p className="text-xs text-blue-200/60">v{m.version}{m.errors ? ` · ${m.errors} erreur(s)` : ''}</p></li>))}</ul></section>}
    </div>
  );
}
