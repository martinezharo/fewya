import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { toast, dismiss, mountToastRoot } from '../../../src/lib/ui/toast';

const ROOT_ID = 'fewya-toast-root';

describe('toast', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('crea el root en el primer uso', () => {
        toast.success('Hola');
        expect(document.getElementById(ROOT_ID)).not.toBeNull();
    });

    it('mountToastRoot es idempotente', () => {
        mountToastRoot();
        mountToastRoot();
        const roots = document.querySelectorAll(`#${ROOT_ID}`);
        expect(roots.length).toBe(1);
    });

    it('toast.error usa role="alert"', () => {
        toast.error('Falló');
        const li = document.querySelector(`#${ROOT_ID} li`);
        expect(li?.getAttribute('role')).toBe('alert');
        expect((li as HTMLElement)?.dataset.toastKind).toBe('error');
    });

    it('toast.success usa role="status"', () => {
        toast.success('Ok');
        const li = document.querySelector(`#${ROOT_ID} li`);
        expect(li?.getAttribute('role')).toBe('status');
        expect((li as HTMLElement)?.dataset.toastKind).toBe('success');
    });

    it('auto-dismiss tras la duración', () => {
        toast.success('Bye', { duration: 1000 });
        expect(document.querySelectorAll(`#${ROOT_ID} li`).length).toBe(1);
        vi.advanceTimersByTime(1000);
        // se marca como leaving y luego se elimina tras 220ms
        vi.advanceTimersByTime(300);
        expect(document.querySelectorAll(`#${ROOT_ID} li`).length).toBe(0);
    });

    it('toasts con mismo id se reemplazan', () => {
        toast.info('A', { id: 'same' });
        toast.info('B', { id: 'same' });
        const items = document.querySelectorAll(`#${ROOT_ID} li`);
        expect(items.length).toBe(1);
        expect(items[0].textContent).toContain('B');
    });

    it('dismiss() sin id limpia todos', () => {
        toast.success('1');
        toast.error('2');
        toast.info('3');
        expect(document.querySelectorAll(`#${ROOT_ID} li`).length).toBe(3);
        dismiss();
        expect(document.querySelectorAll(`#${ROOT_ID} li`).length).toBe(0);
    });

    it('dismiss(id) elimina solo ese', () => {
        toast.success('keep');
        const removeId = toast.error('remove');
        dismiss(removeId);
        vi.advanceTimersByTime(300);
        const items = document.querySelectorAll(`#${ROOT_ID} li`);
        expect(items.length).toBe(1);
        expect(items[0].textContent).toContain('keep');
    });

    it('el root tiene aria-live polite', () => {
        toast.info('Hi');
        const root = document.getElementById(ROOT_ID);
        expect(root?.getAttribute('aria-live')).toBe('polite');
    });
});
