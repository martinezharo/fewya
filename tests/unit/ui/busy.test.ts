import { describe, it, expect, beforeEach } from 'vitest';
import { setBusy, isBusy } from '../../../src/lib/ui/busy';

function makeButton(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = 'Save';
    document.body.appendChild(btn);
    return btn;
}

describe('setBusy', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('marca el botón como ocupado', () => {
        const btn = makeButton();
        setBusy(btn, true);
        expect(btn.disabled).toBe(true);
        expect(btn.hasAttribute('data-busy')).toBe(true);
        expect(btn.getAttribute('aria-busy')).toBe('true');
        expect(btn.querySelector('[data-busy-spinner]')).not.toBeNull();
    });

    it('restaura el botón al desactivar busy', () => {
        const btn = makeButton();
        setBusy(btn, true);
        setBusy(btn, false);
        expect(btn.disabled).toBe(false);
        expect(btn.hasAttribute('data-busy')).toBe(false);
        expect(btn.hasAttribute('aria-busy')).toBe(false);
    });

    it('preserva y restaura aria-label cuando se pasa label', () => {
        const btn = makeButton();
        btn.setAttribute('aria-label', 'Guardar cambios');
        setBusy(btn, true, { label: 'Guardando…' });
        expect(btn.getAttribute('aria-label')).toBe('Guardando…');
        setBusy(btn, false);
        expect(btn.getAttribute('aria-label')).toBe('Guardar cambios');
    });

    it('no rompe si no hay aria-label previo', () => {
        const btn = makeButton();
        setBusy(btn, true, { label: 'Cargando' });
        expect(btn.getAttribute('aria-label')).toBe('Cargando');
        setBusy(btn, false);
        expect(btn.getAttribute('aria-label')).toBeNull();
    });

    it('es idempotente al llamar dos veces seguidas', () => {
        const btn = makeButton();
        setBusy(btn, true);
        setBusy(btn, true);
        const spinners = btn.querySelectorAll('[data-busy-spinner]');
        expect(spinners.length).toBe(1);
    });

    it('isBusy devuelve true solo cuando el botón está ocupado', () => {
        const btn = makeButton();
        expect(isBusy(btn)).toBe(false);
        setBusy(btn, true);
        expect(isBusy(btn)).toBe(true);
        setBusy(btn, false);
        expect(isBusy(btn)).toBe(false);
    });

    it('no falla con botón nulo', () => {
        expect(() => setBusy(null, true)).not.toThrow();
        expect(() => setBusy(undefined, false)).not.toThrow();
    });
});
