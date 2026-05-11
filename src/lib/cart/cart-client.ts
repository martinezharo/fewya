import { cart } from './cart';
import { toast } from '../ui/toast';
import { strings } from '../core/i18n';

function mountCartDelegation() {
    const w = window as Window & { __fewyaCartDelegated?: boolean };
    if (w.__fewyaCartDelegated) return;
    w.__fewyaCartDelegated = true;

    document.addEventListener('click', (e) => {
        const btn = (e.target as Element).closest<HTMLButtonElement>('[data-add-to-cart]');
        if (!btn) return;

        e.preventDefault();

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
        const shippingCost = parseFloat(btn.dataset.cartShipping ?? '0');
        const qty = parseInt(btn.dataset.cartQty ?? '1', 10);

        if (!variantId || stock <= 0) return;

        const existing = cart.get().find(i => i.variantId === variantId);
        const currentQty = existing?.quantity ?? 0;
        const totalAfterAdd = currentQty + qty;

        if (totalAfterAdd > stock) {
            const maxAdd = Math.max(0, stock - currentQty);
            if (maxAdd === 0 && existing) {
                cart.remove(variantId);
            } else if (maxAdd > 0) {
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
                    shippingCost,
                }, maxAdd);
            }
            window.dispatchEvent(new CustomEvent('cart-stock-error', {
                detail: { variantId, title: existing ? null : title }
            }));
            toast.error(strings.cartStockExceededToast);
        } else {
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
                shippingCost,
            }, qty);
            toast.success(strings.cartAddedToast, { id: 'cart-added' });
        }

        // Visual feedback: brief disabled + check icon
        const original = btn.innerHTML;
        btn.innerHTML = '<span class="flex items-center justify-center gap-1.5" aria-hidden="true">✓</span>';
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
        setTimeout(() => {
            btn.innerHTML = original;
            btn.disabled = false;
            btn.removeAttribute('aria-busy');
        }, 800);
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
    mountCartDelegation();
    initCartBadges();
});

if (document.readyState !== 'loading') {
    mountCartDelegation();
    initCartBadges();
} else {
    document.addEventListener('DOMContentLoaded', () => {
        mountCartDelegation();
        initCartBadges();
    });
}
