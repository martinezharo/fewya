interface BusyOptions {
    label?: string;
}

const ORIGINAL_LABEL_ATTR = 'data-busy-original-label';
const BUSY_LABEL_APPLIED_ATTR = 'data-busy-label-applied';

function ensureSpinnerSpan(btn: HTMLElement): void {
    if (btn.querySelector('[data-busy-spinner]')) return;
    const spinner = document.createElement('span');
    spinner.setAttribute('data-busy-spinner', '');
    spinner.setAttribute('aria-hidden', 'true');
    btn.insertBefore(spinner, btn.firstChild);
}

export function setBusy(
    btn: HTMLButtonElement | HTMLAnchorElement | null | undefined,
    busy: boolean,
    opts: BusyOptions = {}
): void {
    if (!btn) return;

    if (busy) {
        ensureSpinnerSpan(btn);
        if (btn instanceof HTMLButtonElement) {
            btn.disabled = true;
        } else {
            btn.setAttribute('aria-disabled', 'true');
        }
        btn.setAttribute('data-busy', '');
        btn.setAttribute('aria-busy', 'true');
        if (opts.label && !btn.hasAttribute(BUSY_LABEL_APPLIED_ATTR)) {
            const current = btn.getAttribute('aria-label');
            if (current !== null) {
                btn.setAttribute(ORIGINAL_LABEL_ATTR, current);
            }
            btn.setAttribute('aria-label', opts.label);
            btn.setAttribute(BUSY_LABEL_APPLIED_ATTR, '');
        }
    } else {
        if (btn instanceof HTMLButtonElement) {
            btn.disabled = false;
        } else {
            btn.removeAttribute('aria-disabled');
        }
        btn.removeAttribute('data-busy');
        btn.removeAttribute('aria-busy');
        if (btn.hasAttribute(BUSY_LABEL_APPLIED_ATTR)) {
            const original = btn.getAttribute(ORIGINAL_LABEL_ATTR);
            if (original !== null) {
                btn.setAttribute('aria-label', original);
                btn.removeAttribute(ORIGINAL_LABEL_ATTR);
            } else {
                btn.removeAttribute('aria-label');
            }
            btn.removeAttribute(BUSY_LABEL_APPLIED_ATTR);
        }
    }
}

export function isBusy(btn: HTMLElement | null | undefined): boolean {
    return !!btn?.hasAttribute('data-busy');
}
