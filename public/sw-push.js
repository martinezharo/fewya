/* global self */
// Web-push handlers, imported into the Workbox-generated service worker via
// `workbox.importScripts` (see astro.config.mjs). Vanilla SW code — no bundling.

self.addEventListener('push', (event) => {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch {
        payload = { title: 'Fewya', body: event.data ? event.data.text() : '' };
    }

    const title = payload.title || 'Fewya';
    const options = {
        body: payload.body || '',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: { url: payload.url || '/' },
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = (event.notification.data && event.notification.data.url) || '/';

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            // Focus an existing tab if one is already open, else open a new one.
            for (const client of windowClients) {
                if ('focus' in client) {
                    client.focus();
                    if ('navigate' in client) {
                        try {
                            client.navigate(targetUrl);
                        } catch {
                            /* navigation across origins can throw; ignore */
                        }
                    }
                    return undefined;
                }
            }
            if (self.clients.openWindow) {
                return self.clients.openWindow(targetUrl);
            }
            return undefined;
        }),
    );
});
