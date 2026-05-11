import { strings } from '../core/i18n';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastOptions {
    duration?: number;
    id?: string;
}

const ROOT_ID = 'fewya-toast-root';
const DEFAULT_DURATION: Record<ToastKind, number> = {
    success: 3000,
    info: 3500,
    error: 5000,
};

let counter = 0;

function ensureRoot(): HTMLOListElement {
    let root = document.getElementById(ROOT_ID) as HTMLOListElement | null;
    if (!root) {
        root = document.createElement('ol');
        root.id = ROOT_ID;
        root.setAttribute('aria-live', 'polite');
        root.setAttribute('aria-atomic', 'false');
        document.body.appendChild(root);
    }
    const w = window as unknown as { __fewyaToastDelegated?: boolean };
    if (!w.__fewyaToastDelegated) {
        w.__fewyaToastDelegated = true;
        document.addEventListener('click', (e) => {
            const target = e.target as HTMLElement | null;
            if (!target) return;
            const btn = target.closest('[data-toast-dismiss]') as HTMLElement | null;
            if (!btn) return;
            const li = btn.closest('li[id^="fewya-toast-"]') as HTMLElement | null;
            if (li) dismiss(li.id);
        });
    }
    return root;
}

function render(kind: ToastKind, message: string, opts: ToastOptions = {}): string {
    if (typeof document === 'undefined') return '';
    const root = ensureRoot();
    const id = opts.id ?? `fewya-toast-${++counter}`;

    const existing = document.getElementById(id);
    if (existing) existing.remove();

    const li = document.createElement('li');
    li.id = id;
    li.dataset.toastKind = kind;
    li.setAttribute('role', kind === 'error' ? 'alert' : 'status');

    const text = document.createElement('span');
    text.textContent = message;
    li.appendChild(text);

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.setAttribute('data-toast-dismiss', '');
    dismissBtn.setAttribute('aria-label', strings.toastDismiss);
    dismissBtn.textContent = '×';
    li.appendChild(dismissBtn);

    root.appendChild(li);

    const duration = opts.duration ?? DEFAULT_DURATION[kind];
    if (duration > 0) {
        window.setTimeout(() => dismiss(id), duration);
    }

    return id;
}

export function dismiss(id?: string): void {
    if (typeof document === 'undefined') return;
    if (!id) {
        const root = document.getElementById(ROOT_ID);
        if (root) root.innerHTML = '';
        return;
    }
    const li = document.getElementById(id);
    if (!li) return;
    li.setAttribute('data-toast-leaving', '');
    window.setTimeout(() => li.remove(), 220);
}

export function mountToastRoot(): void {
    if (typeof document === 'undefined') return;
    ensureRoot();
}

export const toast = {
    success: (msg: string, opts?: ToastOptions) => render('success', msg, opts),
    error: (msg: string, opts?: ToastOptions) => render('error', msg, opts),
    info: (msg: string, opts?: ToastOptions) => render('info', msg, opts),
    dismiss,
};
