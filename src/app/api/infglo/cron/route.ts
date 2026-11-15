import { timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/server';
import { SupabaseRepository, runCycle } from '@/lib/infglo/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET; if (!secret) return false;
  const got = Buffer.from(req.headers.get('authorization') ?? ''); const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Tâche planifiée Vercel Cron (en-tête Authorization: Bearer CRON_SECRET). */
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) return Response.json({ error: 'CRON_SECRET non configuré' }, { status: 503 });
  if (!authorized(req)) return Response.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const db = await createAdminClient();
    const r = await runCycle(new SupabaseRepository(db), { mode: process.env.INFGLO_AUTOMATION === 'live' ? 'live' : 'dry-run', salt: process.env.INFGLO_SALT });
    return Response.json({ ok: true, risk: r.risk, insights: r.insights, saved: r.saved, actions: r.actions });
  } catch (e) {
    console.error('infglo cron', e);
    return Response.json({ error: 'Échec du cycle InfGlo' }, { status: 500 });
  }
}
