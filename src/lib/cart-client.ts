import { cart } from './cart';

function initCartButtons() {
    document.querySelectorAll<HTMLButtonElement>('[data-add-to-cart]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const productId = btn.dataset.cartProductId ?? '';
            const variantId = btn.dataset.cartVariantId ?? '';
            const title = btn.dataset.cartTitle ?? '';
            const image = btn.dataset.cartImage ?? '';
            const price = parseFloat(btn.dataset.cartPrice ?? '0');
            const stock = parseInt(btn.dataset.cartStock ?? '0', 10);
            const variantName = btn.dataset.cartVariantName || null;
            const shopId = btn.dataset.cartShopId ?? '';
            const shopName = btn.dataset.cartShopName ?? '';
            const shopSlug = btn.dataset.cartShopSlug ?? '';
            const productSlug = btn.dataset.cartProductSlug ?? '';

            if (!variantId || stock <= 0) return;

            cart.add({
                productId,
                variantId,
                title,
                image,
                price,
                stock,
                variantName,
                shopId,
                shopName,
                shopSlug,
                productSlug,
            });

            // Visual feedback
            const original = btn.innerHTML;
            btn.innerHTML = '<span class="flex items-center justify-center gap-1.5">✓</span>';
            btn.disabled = true;
            setTimeout(() => {
                btn.innerHTML = original;
                btn.disabled = false;
            }, 800);
        });
    });
}

function initCartBadges() {
    const updateBadges = (count: number) => {
        document.querySelectorAll<HTMLElement>('[data-cart-badge]').forEach(badge => {
            if (count === 0) {
                badge.style.display = 'none';
            } else {
                badge.style.display = '';
                badge.textContent = String(count);
            }
        });
    };

    updateBadges(cart.count());

    window.addEventListener('cart-updated', (e: Event) => {
        const { count } = (e as CustomEvent<{ count: number }>).detail;
        updateBadges(count);
    });
}

document.addEventListener('astro:page-load', () => {
    initCartButtons();
    initCartBadges();
});

if (document.readyState !== 'loading') {
    initCartButtons();
    initCartBadges();
} else {
    document.addEventListener('DOMContentLoaded', () => {
        initCartButtons();
        initCartBadges();
    });
}
