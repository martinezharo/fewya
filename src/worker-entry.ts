import astroServer from '@astrojs/cloudflare/entrypoints/server';
import { syncAllTracking } from './lib/shipping/syncTracking';
import { runAutoConfirm } from './lib/orders/autoConfirm';
import { runNotificationScan } from './lib/notifications/scan';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const entry: any = {
    ...astroServer,
    // M6: cron runs every 4 hours (see wrangler.jsonc triggers).
    // We invoke the sync logic DIRECTLY here instead of fetching our own public
    // URL: a Worker fetching its own hostname loops back / fails instantly (the
    // request never leaves the isolate), which silently broke the cron before.
    async scheduled(_controller: ScheduledController, _env: Record<string, string>, ctx: ExecutionContext) {
        const run = async () => {
            // Sync tracking first so shipment_tracking holds the latest carrier
            // statuses before the notification scan reads them; auto-confirm is
            // independent and can run alongside.
            const trackingThenNotify = (async () => {
                await syncAllTracking();
                await runNotificationScan();
            })();
            const results = await Promise.allSettled([trackingThenNotify, runAutoConfirm()]);
            for (const r of results) {
                if (r.status === 'rejected') {
                    console.error(JSON.stringify({
                        event: 'cron.task_failed',
                        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
                    }));
                }
            }
        };
        ctx.waitUntil(run());
    },
};

export default entry;
