import { getClientT } from '../core/i18n';
import { getCarrierSubsidy } from '../cart/checkout';

export interface RemoteEstimate {
    key: string;
    label: string;
    sublabel: string;
    price: number | null;
    currency: string;
    serviceName: string | null;
}

export interface ShippingDefaults {
    weight_kg?: number | null;
    length_cm?: number | null;
    width_cm?: number | null;
    height_cm?: number | null;
    shipping_cost?: number | null;
}

const DEBOUNCE_MS = 600;
const shippingTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
const shippingRequestIds = new WeakMap<HTMLElement, number>();

export function fmtCurrency(value: number, currency = 'EUR'): string {
    return value.toLocaleString('es-ES', { style: 'currency', currency });
}

export function fmtWeight(value: number): string {
    if (value >= 1) return `${value.toFixed(2)} kg`;
    return `${Math.round(value * 1000)} g`;
}

export function readNum(el: HTMLInputElement | null): number {
    if (!el) return NaN;
    const v = parseFloat(el.value);
    return Number.isNaN(v) ? NaN : v;
}

function setShippingSummary(scope: HTMLElement, text: string, html?: string) {
    const el = scope.querySelector('.shipping-summary') as HTMLElement | null;
    if (!el) return;
    if (html !== undefined) el.innerHTML = html;
    else el.textContent = text;
}

export function setShippingState(
    scope: HTMLElement,
    state: 'empty' | 'loading' | 'error' | 'ready',
    payload?: { estimates?: RemoteEstimate[]; billable?: number; errorMsg?: string },
) {
    const t = getClientT();
    const quotesEl = scope.querySelector('.shipping-quotes') as HTMLElement;
    const loadingEl = scope.querySelector('.shipping-loading') as HTMLElement;
    const errorEl = scope.querySelector('.shipping-error') as HTMLElement;
    const billableEl = scope.querySelector('.shipping-billable') as HTMLElement | null;
    const cta = scope.querySelector('.shipping-quotes-cta') as HTMLElement | null;
    const ctaShow = scope.querySelector('.shipping-quotes-cta-show') as HTMLElement | null;
    const ctaHide = scope.querySelector('.shipping-quotes-cta-hide') as HTMLElement | null;

    loadingEl.classList.add('hidden');
    loadingEl.classList.remove('flex');
    errorEl.classList.add('hidden');
    billableEl?.classList.add('hidden');
    cta?.classList.add('hidden');
    cta?.classList.remove('inline-flex');

    if (state === 'empty') {
        setShippingSummary(scope, t.sellerProductShippingLiveAwaiting);
        quotesEl.classList.add('hidden');
        quotesEl.innerHTML = '';
        ctaShow?.classList.remove('hidden');
        ctaHide?.classList.add('hidden');
        return;
    }
    if (state === 'loading') {
        setShippingSummary(scope, t.sellerProductShippingLiveLoading);
        loadingEl.classList.remove('hidden');
        loadingEl.classList.add('flex');
        return;
    }
    if (state === 'error') {
        setShippingSummary(scope, t.sellerProductShippingLiveError);
        errorEl.textContent = payload?.errorMsg || t.sellerProductShippingLiveError;
        errorEl.classList.remove('hidden');
        return;
    }

    const estimates = payload?.estimates ?? [];
    const billable = payload?.billable ?? 0;
    const availablePrices = estimates.filter(e => e.price != null).map(e => e.price!);

    if (billable > 0 && billableEl) {
        billableEl.textContent = fmtWeight(billable);
        billableEl.classList.remove('hidden');
    }

    if (availablePrices.length > 0) {
        const cheapest = estimates.filter(e => e.price != null).reduce((a, b) => a.price! < b.price! ? a : b);
        const subsidizedMin = Math.max(0, cheapest.price! - getCarrierSubsidy(cheapest.key));
        const weightPart = billable > 0 ? ` · ${fmtWeight(billable)}` : '';
        const summaryHtml = `${t.sellerProductShippingDesde} <s class="text-text-tertiary">${fmtCurrency(cheapest.price!)}</s> <span class="font-semibold text-text-primary">${fmtCurrency(subsidizedMin)}</span> · <span class="text-text-tertiary">${t.sellerProductShippingVatIncluded}</span>${weightPart}`;
        setShippingSummary(scope, '', summaryHtml);
        cta?.classList.remove('hidden');
        cta?.classList.add('inline-flex');
    } else {
        setShippingSummary(scope, t.sellerProductShippingEstimateNone);
    }

    quotesEl.innerHTML = estimates.map((e) => {
        const t = getClientT();
        const available = e.price != null;
        const dotClass = available ? 'bg-green-500' : 'bg-amber-500';
        const valueHtml = available
            ? `<div class="text-right">
                   <div class="flex items-baseline gap-1.5">
                       <s class="text-xs text-text-tertiary tabular-nums">${fmtCurrency(e.price!, e.currency)}</s>
                       <span class="text-sm font-semibold text-text-primary tabular-nums">${fmtCurrency(Math.max(0, e.price! - getCarrierSubsidy(e.key)), e.currency)}</span>
                   </div>
                   <p class="text-[10px] text-text-tertiary">${t.sellerProductShippingVatIncluded}</p>
               </div>`
            : `<span class="text-[11px] font-medium text-amber-700 dark:text-amber-400">${t.sellerProductShippingLiveUnavailable}</span>`;
        return `
            <div class="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-surface border border-border">
                <span class="inline-block w-1.5 h-1.5 rounded-full ${dotClass} shrink-0"></span>
                <div class="min-w-0 flex-1">
                    <p class="text-xs font-medium text-text-primary truncate">${e.label}</p>
                    <p class="text-[10px] text-text-tertiary truncate">${e.serviceName || e.sublabel}</p>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">${valueHtml}</div>
            </div>`;
    }).join('');
}

export async function fetchShippingPreview(
    scope: HTMLElement,
    weight: number,
    length: number | null,
    width: number | null,
    height: number | null,
) {
    const reqId = (shippingRequestIds.get(scope) ?? 0) + 1;
    shippingRequestIds.set(scope, reqId);

    try {
        const res = await fetch('/api/sendcloud/preview-quote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ weight_kg: weight, length_cm: length, width_cm: width, height_cm: height }),
        });
        if (shippingRequestIds.get(scope) !== reqId) return;

        const data = await res.json() as { estimates?: RemoteEstimate[]; billableWeightKg?: number; error?: string };
        if (!res.ok) {
            setShippingState(scope, 'error', { errorMsg: getClientT().sellerProductShippingLiveError });
            return;
        }
        setShippingState(scope, 'ready', {
            estimates: data.estimates ?? [],
            billable: data.billableWeightKg ?? weight,
        });
    } catch {
        if (shippingRequestIds.get(scope) !== reqId) return;
        setShippingState(scope, 'error');
    }
}

export function renderPreviewForScope(scope: HTMLElement, weight: number, length: number, width: number, height: number) {
    const existing = shippingTimers.get(scope);
    if (existing) clearTimeout(existing);

    if (!Number.isFinite(weight) || weight <= 0) {
        shippingRequestIds.set(scope, (shippingRequestIds.get(scope) ?? 0) + 1);
        setShippingState(scope, 'empty');
        return;
    }

    setShippingState(scope, 'loading');
    const timer = setTimeout(() => {
        void fetchShippingPreview(
            scope,
            weight,
            Number.isFinite(length) ? length : null,
            Number.isFinite(width) ? width : null,
            Number.isFinite(height) ? height : null,
        );
    }, DEBOUNCE_MS);
    shippingTimers.set(scope, timer);
}

export function toggleQuotesVisibility(scope: HTMLElement) {
    const quotes = scope.querySelector('.shipping-quotes') as HTMLElement;
    const ctaShow = scope.querySelector('.shipping-quotes-cta-show') as HTMLElement | null;
    const ctaHide = scope.querySelector('.shipping-quotes-cta-hide') as HTMLElement | null;
    if (!quotes.innerHTML.trim()) return;
    const isHidden = quotes.classList.contains('hidden');
    if (isHidden) {
        quotes.classList.remove('hidden');
        ctaShow?.classList.add('hidden');
        ctaHide?.classList.remove('hidden');
    } else {
        quotes.classList.add('hidden');
        ctaShow?.classList.remove('hidden');
        ctaHide?.classList.add('hidden');
    }
}

export function applyShippingDefaults(panel: HTMLElement, defaults: ShippingDefaults) {
    const weightInput = panel.querySelector<HTMLInputElement>('[data-field="weight"]');
    const lengthInput = panel.querySelector<HTMLInputElement>('[data-field="length"]');
    const widthInput = panel.querySelector<HTMLInputElement>('[data-field="width"]');
    const heightInput = panel.querySelector<HTMLInputElement>('[data-field="height"]');
    const costInput = panel.querySelector<HTMLInputElement>('[data-field="shipping-cost"]');
    const freeCheckbox = panel.querySelector<HTMLInputElement>('[data-field="free-shipping"]');
    const inputWrap = panel.querySelector<HTMLElement>('[data-shipping-input-wrap]');
    const freeDisplay = panel.querySelector<HTMLElement>('[data-shipping-free-display]');
    const costContainer = panel.querySelector<HTMLElement>('[data-shipping-cost-container]');

    if (defaults.weight_kg != null && weightInput) weightInput.value = String(defaults.weight_kg);
    if (defaults.length_cm != null && lengthInput) lengthInput.value = String(defaults.length_cm);
    if (defaults.width_cm != null && widthInput) widthInput.value = String(defaults.width_cm);
    if (defaults.height_cm != null && heightInput) heightInput.value = String(defaults.height_cm);

    if (defaults.shipping_cost != null && costInput) {
        costInput.value = String(defaults.shipping_cost);
        const isFree = defaults.shipping_cost === 0;
        if (freeCheckbox) freeCheckbox.checked = isFree;
        inputWrap?.classList.toggle('hidden', isFree);
        freeDisplay?.classList.toggle('hidden', !isFree);
        if (costContainer) costContainer.dataset.free = String(isFree);
    }
}

export function initShippingEditor(panel: HTMLElement, opts?: { onChange?: () => void }) {
    const dimInputs = Array.from(panel.querySelectorAll<HTMLInputElement>(
        '[data-field="weight"], [data-field="length"], [data-field="width"], [data-field="height"]',
    ));
    const costInput = panel.querySelector<HTMLInputElement>('[data-field="shipping-cost"]');
    const freeCheckbox = panel.querySelector<HTMLInputElement>('[data-field="free-shipping"]');
    const inputWrap = panel.querySelector<HTMLElement>('[data-shipping-input-wrap]');
    const freeDisplay = panel.querySelector<HTMLElement>('[data-shipping-free-display]');
    const costContainer = panel.querySelector<HTMLElement>('[data-shipping-cost-container]');
    const liveScope = panel.querySelector<HTMLElement>('.shipping-live');

    dimInputs.forEach(el => {
        el.addEventListener('input', () => {
            if (liveScope) {
                const weight = readNum(panel.querySelector<HTMLInputElement>('[data-field="weight"]'));
                const length = readNum(panel.querySelector<HTMLInputElement>('[data-field="length"]'));
                const width = readNum(panel.querySelector<HTMLInputElement>('[data-field="width"]'));
                const height = readNum(panel.querySelector<HTMLInputElement>('[data-field="height"]'));
                renderPreviewForScope(liveScope, weight, length, width, height);
            }
            opts?.onChange?.();
        });
    });

    costInput?.addEventListener('input', () => opts?.onChange?.());

    freeCheckbox?.addEventListener('change', () => {
        if (freeCheckbox.checked) {
            if (costInput && costInput.value !== '0') costInput.dataset.prevValue = costInput.value;
            if (costInput) costInput.value = '0';
            inputWrap?.classList.add('hidden');
            freeDisplay?.classList.remove('hidden');
            if (costContainer) costContainer.dataset.free = 'true';
        } else {
            if (costInput) costInput.value = costInput.dataset.prevValue ?? '';
            inputWrap?.classList.remove('hidden');
            freeDisplay?.classList.add('hidden');
            if (costContainer) costContainer.dataset.free = 'false';
            costInput?.focus();
        }
        opts?.onChange?.();
    });

    liveScope?.addEventListener('click', (e: MouseEvent) => {
        if ((e.target as HTMLElement).closest('.shipping-toggle')) {
            toggleQuotesVisibility(liveScope);
        }
    });
}
