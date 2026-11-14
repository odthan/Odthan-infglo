/** Lecture des données du tableau de bord (SERVEUR, client service_role, après vérification de permission). */
import { forecast, type Forecast } from './predict';
import { trend, type Trend } from './stats';
import type { Db } from './supabase-repo';

export const DASH_METRICS = ['requests.open', 'requests.created_per_day', 'messages.created_per_day', 'users.created_per_day', 'infglo.risk_score'] as const;
export const METRIC_LABELS: Record<string, string> = {
  'requests.open': 'Demandes ouvertes', 'requests.created_per_day': 'Demandes / jour', 'messages.created_per_day': 'Messages / jour',
  'users.created_per_day': 'Inscriptions / jour', 'infglo.risk_score': 'Score de risque',
};

export interface InsightRow { id: string; kind: string; severity: string; title: string; detail: string; status: string; created_at: string; data: Record<string, unknown> | null }
export interface ActionRow { id: string; insight_id: string; action: string; status: string; result: string | null; created_at: string }
export interface SeriesView { name: string; label: string; values: number[]; last: number | null; trend: Trend; forecast: Forecast | null }
export interface Dashboard {
  run: { at: string; risk: number; summary: { health?: { status?: string; modules?: Record<string, { status: string; version: string; errors: number; detail?: string }> } } } | null;
  insights: InsightRow[]; pendingActions: (ActionRow & { insight_title?: string })[]; series: SeriesView[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function loadDashboard(db: Db): Promise<Dashboard> {
  const [runQ, insQ, actQ] = await Promise.all([
    db.from('infglo_runs').select('at,risk,summary').order('at', { ascending: false }).limit(1),
    db.from('infglo_insights').select('id,kind,severity,title,detail,status,created_at,data').in('status', ['open', 'escalated']).order('created_at', { ascending: false }).limit(30),
    db.from('infglo_actions').select('id,insight_id,action,status,result,created_at').eq('status', 'pending').order('created_at', { ascending: false }).limit(20),
  ]);
  const insights = ((insQ.data ?? []) as InsightRow[]);
  const titles = new Map(insights.map((i) => [i.id, i.title]));
  const series: SeriesView[] = await Promise.all(DASH_METRICS.map(async (name) => {
    const { data } = await db.from('infglo_metrics').select('value').eq('name', name).order('at', { ascending: false }).limit(30);
    const values = ((data ?? []) as { value: number }[]).map((r) => r.value).reverse();
    return { name, label: METRIC_LABELS[name] ?? name, values, last: values.length ? values[values.length - 1] : null, trend: trend(values), forecast: forecast(values, 7) };
  }));
  return { run: ((runQ.data ?? [])[0] as Dashboard['run']) ?? null, insights, pendingActions: ((actQ.data ?? []) as ActionRow[]).map((a) => ({ ...a, insight_title: titles.get(a.insight_id) })), series };
}
