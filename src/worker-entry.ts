import astroServer from '@astrojs/cloudflare/entrypoints/server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const entry: any = {
    ...astroServer,
    async scheduled(_controller: ScheduledController, env: Record<string, string>, _ctx: ExecutionContext) {
        const base = env['WORKER_BASE_URL'] ?? 'https://fewya.com';
        const headers = { 'X-Cron-Secret': env['CRON_SECRET'] ?? '' };
        await Promise.allSettled([
            fetch(`${base}/api/shipments/sync-tracking`, { method: 'POST', headers }),
            fetch(`${base}/api/orders/auto-confirm`, { method: 'POST', headers }),
        ]);
    },
};

export default entry;
