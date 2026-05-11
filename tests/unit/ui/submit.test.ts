import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runSubmit } from '../../../src/lib/ui/submit';

const TOAST_ROOT = 'fewya-toast-root';

function makeButton(): HTMLButtonElement {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    return btn;
}

describe('runSubmit', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        delete (window as unknown as Record<string, unknown>).__fewyaProgressBound;
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('marca el botón ocupado durante la acción y lo libera al final', async () => {
        const btn = makeButton();
        const promise = runSubmit({
            button: btn,
            action: async () => new Response('{}', { status: 200 }),
            successMsg: 'Listo',
        });
        // micro-tick: el setBusy es síncrono al inicio
        expect(btn.hasAttribute('data-busy')).toBe(true);
        await vi.runAllTimersAsync();
        await promise;
        expect(btn.hasAttribute('data-busy')).toBe(false);
    });

    it('muestra toast de éxito en 200', async () => {
        const btn = makeButton();
        await runSubmit({
            button: btn,
            action: async () => new Response('{}', { status: 200 }),
            successMsg: 'Guardado',
        });
        const li = document.querySelector(`#${TOAST_ROOT} li`);
        expect(li?.getAttribute('role')).toBe('status');
        expect(li?.textContent).toContain('Guardado');
    });

    it('muestra toast de error con mensaje del servidor en non-OK', async () => {
        await runSubmit({
            action: async () =>
                new Response(JSON.stringify({ error: 'No autorizado' }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' },
                }),
            errorFallback: 'Error',
        });
        const li = document.querySelector(`#${TOAST_ROOT} li`);
        expect(li?.getAttribute('role')).toBe('alert');
        expect(li?.textContent).toContain('No autorizado');
    });

    it('cae al fallback en errores sin mensaje', async () => {
        await runSubmit({
            action: async () => new Response('', { status: 500 }),
            errorFallback: 'Algo falló',
        });
        const li = document.querySelector(`#${TOAST_ROOT} li`);
        expect(li?.textContent).toContain('Algo falló');
    });

    it('captura excepciones de red y muestra toast', async () => {
        await runSubmit({
            action: async () => {
                throw new Error('boom');
            },
        });
        const li = document.querySelector(`#${TOAST_ROOT} li`);
        expect(li?.getAttribute('role')).toBe('alert');
    });

    it('devuelve { ok: true } en éxito y { ok: false } en error', async () => {
        const okResult = await runSubmit({
            action: async () => new Response('{}', { status: 200 }),
            silentSuccess: true,
        });
        expect(okResult.ok).toBe(true);

        const failResult = await runSubmit({
            action: async () => new Response('{}', { status: 500 }),
        });
        expect(failResult.ok).toBe(false);
    });
});
