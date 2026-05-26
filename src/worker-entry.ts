import astroServer from '@astrojs/cloudflare/entrypoints/server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const entry: any = {
    ...astroServer,
    async scheduled(_controller: ScheduledController, env: Record<string, string>, _ctx: ExecutionContext) {
        const base = env['WORKER_BASE_URL'] ?? 'https://fewya.com';
        // Origin must match the host or Astro's checkOrigin CSRF guard rejects the
        // server-to-server POST with 403 before the route handler runs.
        const headers = {
            'X-Cron-Secret': env['CRON_SECRET'] ?? '',
            'Content-Type': 'application/json',
            'Origin': base,
        };
        await Promise.allSettled([
            fetch(`${base}/api/shipments/sync-tracking`, { method: 'POST', headers }),
            fetch(`${base}/api/orders/auto-confirm`, { method: 'POST', headers }),
        ]);
    },
};

export default entry;
