import type { ActionDef } from './automation';
import type { InfGloRepository } from './repository';

/**
 * Actions de base. Elles n'écrivent que dans les tables InfGlo et dans `notifications` (alerte interne au personnel, relayée en Push par
 * le webhook existant) : aucune donnée client n'est modifiée.
 */
export function buildDefaultActions(repo: InfGloRepository): ActionDef[] {
  const escalate = (roles: string[]) => async ({ dbId, insight }: { dbId: string; insight: { title: string; detail: string } }) => {
    await repo.setInsightStatus(dbId, 'escalated');
    const n = await repo.notifyRoles(roles, { title: `InfGlo : ${insight.title}`, body: insight.detail, link: '/admin/infglo' });
    return `Insight escaladé · ${n} notification(s) envoyée(s)`;
  };
  return [
    { id: 'notify.admin', requiresApproval: false, run: escalate(['SUPER_ADMIN', 'ADMIN']) },
    { id: 'notify.support', requiresApproval: false, run: escalate(['SUPPORT', 'MANAGER', 'ADMIN']) },
    { id: 'security.review', requiresApproval: true, run: escalate(['SUPER_ADMIN', 'ADMIN']) },
  ];
}
