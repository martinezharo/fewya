import { storageIdFromMarker } from './storageMarker';

const SENDCLOUD_HOSTS = ['sendcloud.sc', 'sendcloud.com'];

/** Whether a label reference is safe and usable by the authenticated label route. */
export function isPersistableShipmentLabel(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed) return false;

    const storageId = storageIdFromMarker(trimmed);
    if (storageId !== null) return storageId.trim().length > 0;

    try {
        const { protocol, hostname } = new URL(trimmed);
        return protocol === 'https:'
            && SENDCLOUD_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
    } catch {
        return false;
    }
}
