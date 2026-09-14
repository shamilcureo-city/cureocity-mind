/** Enable only after the additive preparation migration has been verified. */
export function isMindSessionPreparationEnabled(): boolean {
  return process.env.MIND_SESSION_PREPARATION_ENABLED === 'true';
}
