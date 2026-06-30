import { getClientT } from '../core/i18n';
import { setBusy } from './busy';
import { toast } from './toast';
import { progress } from './progress-bar';
import { setStatus } from './live-status';

export class SubmitError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SubmitError';
    }
}

export interface RunSubmitOptions<T> {
    button?: HTMLButtonElement | null;
    action: () => Promise<Response | T>;
    busyLabel?: string;
    successMsg?: string;
    errorFallback?: string;
    silentSuccess?: boolean;
    parseError?: (res: Response) => Promise<string | null>;
}

export interface RunSubmitResult<T> {
    ok: boolean;
    value: T | null;
    error: string | null;
}

async function defaultParseError(res: Response): Promise<string | null> {
    try {
        const data = await res.clone().json() as { error?: string; message?: string };
        return data.error ?? data.message ?? null;
    } catch {
        try {
            const text = await res.clone().text();
            return text || null;
        } catch {
            return null;
        }
    }
}

export async function runSubmit<T = unknown>(
    opts: RunSubmitOptions<T>
): Promise<RunSubmitResult<T>> {
    const t = getClientT();
    const {
        button,
        action,
        busyLabel = t.loadingGeneric,
        successMsg,
        errorFallback = t.toastErrorGeneric,
        silentSuccess = false,
        parseError = defaultParseError,
    } = opts;

    if (button) setBusy(button, true, { label: busyLabel });
    setStatus(busyLabel);
    progress.start();

    try {
        const result = await action();
        if (result instanceof Response) {
            if (!result.ok) {
                const msg = (await parseError(result)) ?? errorFallback;
                toast.error(msg);
                progress.fail();
                return { ok: false, value: null, error: msg };
            }
            if (!silentSuccess && successMsg) toast.success(successMsg);
            progress.done();
            return { ok: true, value: result as unknown as T, error: null };
        }
        if (!silentSuccess && successMsg) toast.success(successMsg);
        progress.done();
        return { ok: true, value: result, error: null };
    } catch (err) {
        const msg = err instanceof SubmitError ? err.message : t.toastErrorNetwork;
        toast.error(msg);
        progress.fail();
        return { ok: false, value: null, error: msg };
    } finally {
        if (button) setBusy(button, false);
    }
}
