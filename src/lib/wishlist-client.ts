/** Handles wishlist toggle for all buttons with [data-wishlist-btn] or .wishlist-btn */
const HEART_SVG = `<svg width="SIZE" height="SIZE" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`;
const HEART_FILLED_SVG = `<svg width="SIZE" height="SIZE" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" fill="currentColor"/></svg>`;

function getHeartSvg(filled: boolean, size: number): string {
    const templateArr = (filled ? HEART_FILLED_SVG : HEART_SVG).split('SIZE');
    return templateArr.join(String(size));
}

function initWishlistButtons() {
    document.querySelectorAll<HTMLButtonElement>('.wishlist-btn').forEach(btn => {
        if (btn.dataset.wishlistBound) return;
        btn.dataset.wishlistBound = 'true';

        btn.addEventListener('click', async (e) => {
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

                if (!res.ok) {
                    // Revert on error
                    applyWishState(btn, wasWished, size);
                    if (res.status === 401) {
                        window.location.href = '/api/auth/login';
                    }
                    return;
                }

                const payload = await res.json() as { wishlisted?: boolean };
                const wishlisted = payload.wishlisted === true;
                applyWishState(btn, wishlisted, size);
                window.dispatchEvent(new CustomEvent('wishlist-updated', { detail: { wishlisted } }));
            } catch {
                applyWishState(btn, wasWished, size);
            }
        });
    });
}

function applyWishState(btn: HTMLButtonElement, wished: boolean, size: number) {
    btn.dataset.wished = wished ? 'true' : 'false';
    btn.innerHTML = getHeartSvg(wished, size);

    if (wished) {
        btn.classList.remove('text-text-tertiary');
        btn.classList.add('text-wishlist');
    } else {
        btn.classList.remove('text-wishlist');
        btn.classList.add('text-text-tertiary');
    }
}

// Init on page load and on Astro page transitions
document.addEventListener('DOMContentLoaded', initWishlistButtons);
document.addEventListener('astro:page-load', initWishlistButtons);
// Also run immediately in case DOMContentLoaded already fired
if (document.readyState !== 'loading') initWishlistButtons();
