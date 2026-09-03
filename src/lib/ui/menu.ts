/**
 * Lightweight dropdown menus.
 *
 * Markup contract (no framework, works with server-rendered lists):
 *
 *   <div data-menu class="relative">
 *     <button data-menu-button aria-haspopup="true" aria-expanded="false" aria-controls="…">…</button>
 *     <div data-menu-panel id="…" class="hidden absolute …">…</div>
 *   </div>
 *
 * Visibility is the `hidden` *class*, not the attribute, so a panel can opt
 * out of being a dropdown at a breakpoint (`sm:flex`) and render inline
 * instead — the seller catalog does exactly that on desktop.
 *
 * Behaviour is delegated from `document`, so any number of menus (including
 * ones added after init) share a single pair of listeners: opening one closes
 * the others, an outside click or Escape closes everything, and activating an
 * item inside a panel closes its menu.
 */

const OPEN_ATTR = 'data-menu-open';

let delegated = false;

function openMenu(menu: HTMLElement): void {
    const button = menu.querySelector<HTMLElement>('[data-menu-button]');
    const panel = menu.querySelector<HTMLElement>('[data-menu-panel]');
    menu.setAttribute(OPEN_ATTR, '');
    button?.setAttribute('aria-expanded', 'true');
    panel?.classList.remove('hidden');
}

function closeMenu(menu: HTMLElement, restoreFocus = false): void {
    const button = menu.querySelector<HTMLElement>('[data-menu-button]');
    const panel = menu.querySelector<HTMLElement>('[data-menu-panel]');
    menu.removeAttribute(OPEN_ATTR);
    button?.setAttribute('aria-expanded', 'false');
    panel?.classList.add('hidden');
    if (restoreFocus) button?.focus();
}

export function closeAllMenus(except?: HTMLElement | null, restoreFocus = false): void {
    document.querySelectorAll<HTMLElement>(`[data-menu][${OPEN_ATTR}]`).forEach(menu => {
        if (menu !== except) closeMenu(menu, restoreFocus);
    });
}

export function initMenus(): void {
    if (delegated) return;
    delegated = true;

    document.addEventListener('click', event => {
        const target = event.target as Element | null;
        const button = target?.closest<HTMLElement>('[data-menu-button]');

        if (button) {
            const menu = button.closest<HTMLElement>('[data-menu]');
            if (!menu) return;
            const wasOpen = menu.hasAttribute(OPEN_ATTR);
            closeAllMenus();
            if (!wasOpen) openMenu(menu);
            return;
        }

        // Clicking an item inside a panel closes it, but lets the item's own
        // handler (link navigation, delete dialog, …) run as usual.
        closeAllMenus();
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeAllMenus(null, true);
    });
}
