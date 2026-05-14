import { strings } from '../core/i18n';

const ALERT_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;

function mountQtySelector() {
    document.querySelectorAll('[data-qty-selector]').forEach(selector => {
        const minus = selector.querySelector<HTMLButtonElement>('[data-qty-minus]');
        const plus = selector.querySelector<HTMLButtonElement>('[data-qty-plus]');
        const value = selector.querySelector('[data-qty-value]');
        const addBtn = document.querySelector<HTMLButtonElement>('[data-add-to-cart]');
        const stock = parseInt(addBtn?.dataset.cartStock ?? '0', 10);
        let qty = Math.min(1, stock);

        const updateUI = () => {
            if (value) value.textContent = String(qty);
            if (addBtn) addBtn.dataset.cartQty = String(qty);
            if (plus) plus.disabled = qty >= stock || stock <= 0;
            if (minus) minus.disabled = qty <= 1 || stock <= 0;
            if (addBtn) addBtn.disabled = stock <= 0 || qty < 1;
        };

        plus?.addEventListener('click', () => { if (qty < stock) { qty++; updateUI(); } });
        minus?.addEventListener('click', () => { if (qty > 1) { qty--; updateUI(); } });

        updateUI();
    });
}

function updateStockWarning(wrapper: HTMLElement | null, stock: number) {
    if (!wrapper) return;
    if (stock > 0 && stock <= 5) {
        let badge = wrapper.querySelector<HTMLElement>('[data-stock-warning]');
        if (!badge) {
            wrapper.innerHTML = `<p class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800 font-semibold text-xs self-start" data-stock-warning>${ALERT_SVG}<span data-stock-warning-text></span></p>`;
            badge = wrapper.querySelector('[data-stock-warning]');
        }
        const text = badge?.querySelector<HTMLElement>('[data-stock-warning-text]');
        if (text) text.textContent = strings.productStockWarning.replace(/\{stock\}/, String(stock));
    } else {
        wrapper.innerHTML = '';
    }
}

function mountVariantChangeHandler() {
    document.querySelectorAll<HTMLElement>('[data-variant-btn]').forEach(btn => {
        btn.addEventListener('click', () => {
            const addBtn = document.querySelector<HTMLButtonElement>('[data-add-to-cart]');
            if (!addBtn) return;

            const stock = parseInt(btn.dataset.variantStock ?? '0', 10);
            const variantShipping = parseFloat(btn.dataset.variantShipping ?? '0') || 0;

            if (btn.dataset.variantId) addBtn.dataset.cartVariantId = btn.dataset.variantId;
            addBtn.dataset.cartPrice = btn.dataset.variantPrice ?? '0';
            addBtn.dataset.cartStock = String(stock);
            addBtn.dataset.cartShipping = String(variantShipping);

            const variantImage = btn.dataset.variantImage ?? '';
            if (variantImage) addBtn.dataset.cartImage = variantImage;

            const variantNameEl = btn.querySelector('[data-variant-name]');
            if (variantNameEl) addBtn.dataset.cartVariantName = variantNameEl.textContent?.trim() ?? '';

            const shippingEl = document.querySelector('[data-product-shipping]');
            if (shippingEl) {
                shippingEl.textContent = variantShipping === 0
                    ? 'Envío gratis'
                    : `+${variantShipping.toFixed(2).replace('.', ',')}€ envío`;
            }

            updateStockWarning(
                document.querySelector<HTMLElement>('[data-stock-warning-wrapper]'),
                stock,
            );

            // Sync qty selector to new stock
            const qtySelector = document.querySelector('[data-qty-selector]');
            const qtyValue = qtySelector?.querySelector('[data-qty-value]');
            const minus = qtySelector?.querySelector<HTMLButtonElement>('[data-qty-minus]');
            const plus = qtySelector?.querySelector<HTMLButtonElement>('[data-qty-plus]');

            let qty = Math.min(parseInt(qtyValue?.textContent ?? '1', 10), stock);
            qty = Math.max(1, qty);

            if (qtyValue) qtyValue.textContent = String(qty);
            addBtn.dataset.cartQty = String(qty);
            if (plus) plus.disabled = qty >= stock || stock <= 0;
            if (minus) minus.disabled = qty <= 1 || stock <= 0;
            addBtn.disabled = stock <= 0 || qty < 1;
        });
    });
}

export function mountProductPage() {
    mountQtySelector();
    mountVariantChangeHandler();
}
