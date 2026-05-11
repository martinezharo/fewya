const ROOT_ID = 'fewya-progress';

interface ProgressState {
    raf: number | null;
    fadeTimeout: number | null;
    cleanupTimeout: number | null;
    active: boolean;
}

const state: ProgressState = {
    raf: null,
    fadeTimeout: null,
    cleanupTimeout: null,
    active: false,
};

function prefersReducedMotion(): boolean {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function ensureBar(): HTMLDivElement {
    let bar = document.getElementById(ROOT_ID) as HTMLDivElement | null;
    if (!bar) {
        bar = document.createElement('div');
        bar.id = ROOT_ID;
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-hidden', 'true');
        document.body.appendChild(bar);
    }
    return bar;
}

function clearTimers(): void {
    if (state.raf !== null) {
        cancelAnimationFrame(state.raf);
        state.raf = null;
    }
    if (state.fadeTimeout !== null) {
        clearTimeout(state.fadeTimeout);
        state.fadeTimeout = null;
    }
    if (state.cleanupTimeout !== null) {
        clearTimeout(state.cleanupTimeout);
        state.cleanupTimeout = null;
    }
}

function setScale(bar: HTMLDivElement, scale: number): void {
    bar.style.transform = `scaleX(${scale})`;
}

function start(): void {
    if (typeof document === 'undefined') return;
    const bar = ensureBar();
    clearTimers();
    state.active = true;
    bar.removeAttribute('data-progress-done');
    bar.style.opacity = '1';
    setScale(bar, 0);

    if (prefersReducedMotion()) {
        setScale(bar, 0.8);
        return;
    }

    let progress = 0;
    let last = performance.now();

    const tick = (now: number) => {
        if (!state.active) return;
        const dt = (now - last) / 1000;
        last = now;
        const remaining = 0.9 - progress;
        progress += remaining * dt * 0.6;
        setScale(bar, Math.min(progress, 0.9));
        if (progress < 0.9) {
            state.raf = requestAnimationFrame(tick);
        }
    };

    state.raf = requestAnimationFrame((t) => {
        last = t;
        setScale(bar, 0.15);
        progress = 0.15;
        state.raf = requestAnimationFrame(tick);
    });
}

function finish(success: boolean): void {
    if (typeof document === 'undefined') return;
    const bar = ensureBar();
    clearTimers();
    state.active = false;
    setScale(bar, 1);
    if (!success) {
        bar.style.opacity = '0.4';
    }
    state.fadeTimeout = window.setTimeout(() => {
        bar.setAttribute('data-progress-done', '');
        state.cleanupTimeout = window.setTimeout(() => {
            bar.removeAttribute('data-progress-done');
            bar.style.opacity = '1';
            setScale(bar, 0);
        }, 250);
    }, 150);
}

export function mountProgressBar(): void {
    if (typeof document === 'undefined') return;
    ensureBar();

    if ((window as unknown as { __fewyaProgressBound?: boolean }).__fewyaProgressBound) return;
    (window as unknown as { __fewyaProgressBound?: boolean }).__fewyaProgressBound = true;

    document.addEventListener('astro:before-preparation', () => start());
    document.addEventListener('astro:after-swap', () => finish(true));
    document.addEventListener('astro:page-load', () => {
        if (state.active) finish(true);
    });
}

export const progress = {
    start,
    done: () => finish(true),
    fail: () => finish(false),
};
