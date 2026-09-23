/** Microsoft Teams incoming-webhook adapter for staff teams (D-143 "Teams adapter available"). */
export const TEAMS_WEBHOOK = Symbol('TEAMS_WEBHOOK');

export interface TeamsWebhook {
  /** `secretRef` names the webhook URL in Secrets Manager (never stored in the database). */
  post(secretRef: string, text: string): Promise<void>;
}
