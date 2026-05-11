import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountProgressBar, progress } from '../../../src/lib/ui/progress-bar';

const BAR_ID = 'fewya-progress';

describe('progress-bar', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        // reset internal flag
        delete (window as unknown as Record<string, unknown>).__fewyaProgressBound;
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('mountProgressBar crea la barra una sola vez', () => {
        mountProgressBar();
        mountProgressBar();
        const bars = document.querySelectorAll(`#${BAR_ID}`);
        expect(bars.length).toBe(1);
    });

    it('la barra tiene role="progressbar"', () => {
        mountProgressBar();
        const bar = document.getElementById(BAR_ID);
        expect(bar?.getAttribute('role')).toBe('progressbar');
    });

    it('progress.start inicia transform de la barra', () => {
        mountProgressBar();
        progress.start();
        const bar = document.getElementById(BAR_ID) as HTMLDivElement;
        expect(bar.style.opacity).toBe('1');
        expect(bar.hasAttribute('data-progress-done')).toBe(false);
    });

    it('progress.done marca data-progress-done tras el fade', () => {
        mountProgressBar();
        progress.start();
        progress.done();
        const bar = document.getElementById(BAR_ID) as HTMLDivElement;
        expect(bar.style.transform).toContain('scaleX(1)');
        vi.advanceTimersByTime(200);
        expect(bar.hasAttribute('data-progress-done')).toBe(true);
    });

    it('progress.fail reduce opacidad', () => {
        mountProgressBar();
        progress.start();
        progress.fail();
        const bar = document.getElementById(BAR_ID) as HTMLDivElement;
        expect(bar.style.opacity).toBe('0.4');
    });
});
