export type SecurityEventName =
    | 'security.webhook.invalid_signature'
    | 'security.webhook.replay_attempt'
    | 'security.webhook.stale_timestamp'
    | 'security.upload.invalid_magic_bytes'
    | 'security.upload.path_traversal'
    | 'security.transfer.failed'
    | 'security.csrf.origin_mismatch'
    | 'security.rate_limit.exceeded'
    | 'security.cron.unauthorized';

export function securityLog(event: SecurityEventName, context: Record<string, unknown> = {}): void {
    console.warn(JSON.stringify({ event, ...context, ts: new Date().toISOString() }));
}
