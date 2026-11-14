// Fichier « barrel » côté client/serveur SANS node:crypto (sûr à importer partout).
import { InfGloCore, type CoreOptions } from './core';
import { AnalyticsModule, DecisionModule } from './modules';
import { ODTHAN_DEFAULT_RULES } from './odthan-rules';
import type { Rule } from './decision';

export * from './types';
export * from './stats';
export * from './anomaly';
export * from './predict';
export * from './decision';
export * from './modules';
export * from './nlp';
export * from './badges';
export * from './recommend';
export * from './learning';
export * from './optimizer';
export * from './repository';
export { InfGloCore, matches } from './core';
export { ODTHAN_DEFAULT_RULES } from './odthan-rules';

/** Fabrique légère : noyau + Analytics + Decision. Pour le cycle complet côté serveur, voir `server.ts`. */
export async function createInfGlo(opts: CoreOptions & { rules?: Rule[] } = {}) {
  const core = new InfGloCore(opts);
  const analytics = new AnalyticsModule();
  const decision = new DecisionModule(opts.rules ?? ODTHAN_DEFAULT_RULES);
  core.register(analytics).register(decision);
  await core.start();
  return { core, analytics, decision };
}
