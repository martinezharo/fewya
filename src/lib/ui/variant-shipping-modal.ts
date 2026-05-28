import { initShippingEditor, readNum, renderPreviewForScope } from './shipping-editor';

export interface ShippingValues {
    weight: number;
    length: number;
    width: number;
    height: number;
    shipping: number;
}

interface ModalElements {
    modal: HTMLElement;
    panel: HTMLElement;
    nameEl: HTMLElement;
    weight: HTMLInputElement;
    length: HTMLInputElement;
    width: HTMLInputElement;
    height: HTMLInputElement;
    shippingInput: HTMLInputElement;
    freeShipping: HTMLInputElement;
    shippingInputWrap: HTMLElement;
    freeShippingDisplay: HTMLElement;
    shippingCost: HTMLElement;
    live: HTMLElement;
    closeBtn: HTMLButtonElement;
    cancelBtn: HTMLButtonElement;
    applyBtn: HTMLButtonElement;
    resetBtn: HTMLButtonElement;
}

interface OpenOptions {
    variantName: string;
    initialValues: ShippingValues;
    onApply: (values: ShippingValues) => void;
    onReset: () => void;
}

let cached: ModalElements | null = null;
let wired = false;
let currentOptions: OpenOptions | null = null;

function readElements(): ModalElements | null {
    if (cached) return cached;
    const modal = document.getElementById('variant-shipping-modal');
    const panel = document.querySelector<HTMLElement>('.shipping-editor-panel[data-id-prefix="modal"]');
    if (!modal || !panel) return null;
    cached = {
        modal,
        panel,
        nameEl: document.getElementById('variant-shipping-modal-variant-name') as HTMLElement,
        weight: document.getElementById('modal-weight-input') as HTMLInputElement,
        length: document.getElementById('modal-length-input') as HTMLInputElement,
        width: document.getElementById('modal-width-input') as HTMLInputElement,
        height: document.getElementById('modal-height-input') as HTMLInputElement,
        shippingInput: document.getElementById('modal-shipping-input') as HTMLInputElement,
        freeShipping: document.getElementById('modal-free-shipping') as HTMLInputElement,
        shippingInputWrap: document.getElementById('modal-shipping-input-wrap') as HTMLElement,
        freeShippingDisplay: document.getElementById('modal-free-shipping-display') as HTMLElement,
        shippingCost: document.getElementById('modal-shipping-cost') as HTMLElement,
        live: document.getElementById('modal-shipping-live') as HTMLElement,
        closeBtn: document.getElementById('variant-shipping-modal-close') as HTMLButtonElement,
        cancelBtn: document.getElementById('variant-shipping-modal-cancel') as HTMLButtonElement,
        applyBtn: document.getElementById('variant-shipping-modal-apply') as HTMLButtonElement,
        resetBtn: document.getElementById('variant-shipping-modal-reset') as HTMLButtonElement,
    };
    return cached;
}

function readModalValues(els: ModalElements): ShippingValues {
    return {
        weight: readNum(els.weight),
        length: readNum(els.length),
        width: readNum(els.width),
        height: readNum(els.height),
        shipping: readNum(els.shippingInput),
    };
}

function close(els: ModalElements) {
    els.modal.classList.add('hidden');
    els.modal.classList.remove('flex');
    currentOptions = null;
}

function wire(els: ModalElements) {
    if (wired) return;
    wired = true;

    initShippingEditor(els.panel);

    els.closeBtn.addEventListener('click', () => close(els));
    els.cancelBtn.addEventListener('click', () => close(els));
    els.modal.addEventListener('click', (e: MouseEvent) => {
        if (e.target === els.modal) close(els);
    });

    els.applyBtn.addEventListener('click', () => {
        const cb = currentOptions?.onApply;
        const values = readModalValues(els);
        close(els);
        cb?.(values);
    });

    els.resetBtn.addEventListener('click', () => {
        const cb = currentOptions?.onReset;
        close(els);
        cb?.();
    });
}

export function openVariantShippingModal(opts: OpenOptions) {
    const els = readElements();
    if (!els) return;
    wire(els);
    currentOptions = opts;

    els.nameEl.textContent = opts.variantName;

    const v = opts.initialValues;
    els.weight.value = Number.isFinite(v.weight) ? String(v.weight) : '';
    els.length.value = Number.isFinite(v.length) ? String(v.length) : '';
    els.width.value = Number.isFinite(v.width) ? String(v.width) : '';
    els.height.value = Number.isFinite(v.height) ? String(v.height) : '';
    els.shippingInput.value = Number.isFinite(v.shipping) ? String(v.shipping) : '';

    const isFree = v.shipping === 0;
    els.freeShipping.checked = isFree;
    if (isFree) {
        els.shippingInputWrap.classList.add('hidden');
        els.freeShippingDisplay.classList.remove('hidden');
        els.shippingCost.dataset.free = 'true';
    } else {
        els.shippingInputWrap.classList.remove('hidden');
        els.freeShippingDisplay.classList.add('hidden');
        els.shippingCost.dataset.free = 'false';
    }

    els.modal.classList.remove('hidden');
    els.modal.classList.add('flex');

    renderPreviewForScope(els.live, v.weight, v.length, v.width, v.height);
}
