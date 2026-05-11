const ROOT_ID = 'fewya-live-status';

function ensureRoot(): HTMLDivElement {
    let root = document.getElementById(ROOT_ID) as HTMLDivElement | null;
    if (!root) {
        root = document.createElement('div');
        root.id = ROOT_ID;
        root.setAttribute('aria-live', 'polite');
        root.setAttribute('aria-atomic', 'true');
        root.className = 'sr-only';
        root.style.position = 'absolute';
        root.style.width = '1px';
        root.style.height = '1px';
        root.style.padding = '0';
        root.style.margin = '-1px';
        root.style.overflow = 'hidden';
        root.style.clip = 'rect(0,0,0,0)';
        root.style.whiteSpace = 'nowrap';
        root.style.border = '0';
        document.body.appendChild(root);
    }
    return root;
}

export function mountLiveStatus(): void {
    if (typeof document === 'undefined') return;
    ensureRoot();
}

export function setStatus(msg: string): void {
    if (typeof document === 'undefined') return;
    const root = ensureRoot();
    root.textContent = '';
    window.setTimeout(() => {
        root.textContent = msg;
    }, 50);
}

export function clearStatus(): void {
    if (typeof document === 'undefined') return;
    const root = document.getElementById(ROOT_ID);
    if (root) root.textContent = '';
}
