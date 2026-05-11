/** Handles wishlist toggle for all buttons with .wishlist-btn */
import { toggleLocalWishlist, syncLocalWishlistFromCookie, getLocalWishlistIds } from './wishlist-local';
import { toast } from '../ui/toast';
import { strings } from '../core/i18n';

const HEART_SVG = `<svg width="SIZE" height="SIZE" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`;
const HEART_FILLED_SVG = `<svg width="SIZE" height="SIZE" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" fill="currentColor"/></svg>`;

function getHeartSvg(filled: boolean, size: number): string {
    const templateArr = (filled ? HEART_FILLED_SVG : HEART_SVG).split('SIZE');
    return templateArr.join(String(size));
}

function mountWishlistDelegation() {
    const w = window as Window & { __fewyaWishlistDelegated?: boolean };
    if (w.__fewyaWishlistDelegated) return;
    w.__fewyaWishlistDelegated = true;

    document.addEventListener('click', async (e) => {
        const btn = (e.target as Element).closest<HTMLButtonElement>('.wishlist-btn');
        if (!btn) return;

        e.preventDefault();
        e.stopPropagation();

        const productId = btn.dataset.productId;
        if (!productId) return;

        const wasWished = btn.dataset.wished === 'true';
        const size = parseInt(btn.dataset.iconSize || '18');

        // Optimistic update
        const nowWished = !wasWished;
        applyWishState(btn, nowWished, size);

        try {
            const res = await fetch('/api/wishlist/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ productId }),
            });

            if (res.ok) {
                const payload = await res.json() as { wishlisted?: boolean; removedFromLocal?: boolean };
                const wishlisted = payload.wishlisted === true;

                if (payload.removedFromLocal) {
                    const localIds = getLocalWishlistIds();
                    if (localIds.includes(productId)) {
                        toggleLocalWishlist(productId);
                    }
                }

                applyWishState(btn, wishlisted, size);
                window.dispatchEvent(new CustomEvent('wishlist-updated', { detail: { wishlisted } }));
                toast.success(
                    wishlisted ? strings.wishlistAddedToast : strings.wishlistRemovedToast,
                    { id: 'wishlist-toggle' }
                );
                return;
            }

            if (res.status === 401) {
                // Not authenticated — use localStorage fallback
                const localWished = toggleLocalWishlist(productId);
                applyWishState(btn, localWished, size);
                window.dispatchEvent(new CustomEvent('wishlist-updated', { detail: { wishlisted: localWished } }));
                toast.success(
                    localWished ? strings.wishlistAddedToast : strings.wishlistRemovedToast,
                    { id: 'wishlist-toggle' }
                );
                return;
            }

            // Any other error: revert
            applyWishState(btn, wasWished, size);
            toast.error(strings.toastErrorGeneric);
        } catch {
            // Network failure: revert and notify
            applyWishState(btn, wasWished, size);
            toast.error(strings.toastErrorNetwork);
        }
    });
}

function applyWishState(btn: HTMLButtonElement, wished: boolean, size: number) {
    btn.dataset.wished = wished ? 'true' : 'false';
    btn.innerHTML = getHeartSvg(wished, size);

    if (wished) {
        btn.classList.remove('text-text-secondary');
        btn.classList.add('text-wishlist');
    } else {
        btn.classList.remove('text-wishlist');
        btn.classList.add('text-text-secondary');
    }
}

// Sync cookie -> localStorage on first load (in case user closed tab and reopened)
syncLocalWishlistFromCookie();

// Mount delegation once — works for all buttons including those in server islands
mountWishlistDelegation();
document.addEventListener('astro:page-load', mountWishlistDelegation);
