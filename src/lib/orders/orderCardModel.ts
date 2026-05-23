import { strings } from '../core/i18n';
import { ORDER_STATUS, ORDER_STATUSES, orderStatusLabels, type OrderStatus } from './orderStatus';
import { FUND_HOLD_MS } from './timing';

export const ORDER_STATUS_BADGE_CLASSES: Record<OrderStatus, string> = {
    pending: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
    paid: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
    processing: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
    shipped: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400',
    delivered: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
    confirmed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
    incident: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
    delivery_failed: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400',
    cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
    refunded: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400',
};

const STATUS_SET = new Set<string>(ORDER_STATUSES);

export function normalizeOrderStatus(raw: string | null | undefined): OrderStatus {
    const lower = raw?.toLowerCase() ?? ORDER_STATUS.PENDING;
    return STATUS_SET.has(lower) ? (lower as OrderStatus) : ORDER_STATUS.PENDING;
}

export function getStatusLabel(status: OrderStatus): string {
    return orderStatusLabels[status];
}

export function getStatusBadgeClass(status: OrderStatus): string {
    return ORDER_STATUS_BADGE_CLASSES[status];
}

export const ORDER_DATE_FORMATTER = new Intl.DateTimeFormat('es-ES', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
});

export const EUR_FORMATTER = new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
});

export function formatOrderDate(date: Date): string {
    return ORDER_DATE_FORMATTER.format(date);
}

export function formatEur(amount: number): string {
    return EUR_FORMATTER.format(amount);
}

export interface SellerDeliveryFlags {
    canSellerConfirm: boolean;
    isRecentlyDelivered: boolean;
}

export function getSellerDeliveryFlags(
    status: OrderStatus,
    deliveredAt: Date | null | undefined,
    now: number = Date.now()
): SellerDeliveryFlags {
    if (status !== ORDER_STATUS.DELIVERED || !deliveredAt) {
        return { canSellerConfirm: false, isRecentlyDelivered: false };
    }
    const elapsed = now - deliveredAt.getTime();
    const ready = elapsed >= FUND_HOLD_MS;
    return { canSellerConfirm: ready, isRecentlyDelivered: !ready };
}

export interface RefundedAmounts {
    showRefunded: boolean;
    refundedAmountFormatted: string;
    shippingRetainedFormatted: string;
}

export function getRefundedAmounts(
    status: OrderStatus,
    refundedAmount: number | null | undefined,
    shippingRetained: number | null | undefined
): RefundedAmounts {
    const showRefunded = status === ORDER_STATUS.REFUNDED && (refundedAmount ?? 0) > 0;
    return {
        showRefunded,
        refundedAmountFormatted: showRefunded ? formatEur(refundedAmount ?? 0) : '',
        shippingRetainedFormatted:
            showRefunded && (shippingRetained ?? 0) > 0 ? formatEur(shippingRetained ?? 0) : '',
    };
}

export function formatShippingCell(shipping: number): string {
    return shipping > 0 ? formatEur(shipping) : strings.freeLabel;
}
