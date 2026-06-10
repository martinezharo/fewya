/**
 * Client-side PWA push helpers. Vanilla TS used from <script> blocks and the
 * settings toggle / soft prompt. Talks to /api/notifications/* and the active
 * service worker registration.
 */

export type PushState = 'unsupported' | 'denied' | 'granted-subscribed' | 'granted-unsubscribed' | 'default';

export function isPushSupported(): boolean {
    return (
        typeof window !== 'undefined' &&
        'serviceWorker' in navigator &&
        'PushManager' in window &&
        'Notification' in window
    );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const output = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
    return output;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
    if (!isPushSupported()) return null;
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) return existing;
    // serviceWorker.ready never settles when no SW is registered — bound the
    // wait so callers fail visibly instead of hanging the UI forever.
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000));
    return Promise.race([navigator.serviceWorker.ready, timeout]);
}

/** Current permission + subscription state, for rendering the toggle/prompt. */
export async function currentState(): Promise<PushState> {
    if (!isPushSupported()) return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    if (Notification.permission === 'default') return 'default';
    const reg = await getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    return sub ? 'granted-subscribed' : 'granted-unsubscribed';
}

async function fetchVapidKey(): Promise<string | null> {
    try {
        const res = await fetch('/api/notifications/vapid-public-key');
        if (!res.ok) return null;
        const data = (await res.json()) as { publicKey?: string | null };
        return data.publicKey ?? null;
    } catch {
        return null;
    }
}

/**
 * Requests permission (if needed), creates a PushSubscription and persists it
 * server-side. Returns true on success. Throws only on unexpected errors; a
 * denied permission resolves to false.
 */
export async function subscribe(): Promise<boolean> {
    if (!isPushSupported()) return false;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return false;

    const vapidKey = await fetchVapidKey();
    if (!vapidKey) return false;

    const reg = await getRegistration();
    if (!reg) return false;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
        sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
        });
    }

    const json = sub.toJSON();
    const res = await fetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
    });
    return res.ok;
}

/** Removes the local subscription and tells the server to forget it. */
export async function unsubscribe(): Promise<boolean> {
    if (!isPushSupported()) return false;
    const reg = await getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (!sub) return true;

    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    await fetch('/api/notifications/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
    }).catch(() => {});
    return true;
}
