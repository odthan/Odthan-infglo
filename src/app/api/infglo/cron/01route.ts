import { checkPerm } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { loadDashboard } from '@/lib/infglo/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** API InfGlo : instantané JSON du tableau de bord (réservé aux administrateurs). */
export async function GET() {
  const a = await checkPerm('users.manage');
  if (!a) return Response.json({ error: 'Accès refusé' }, { status: 403 });
  const db = await createAdminClient();
  return Response.json(await loadDashboard(db), { headers: { 'Cache-Control': 'private, no-store' } });
}
