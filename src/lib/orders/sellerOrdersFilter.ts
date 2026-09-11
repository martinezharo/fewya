import { ORDER_STATUS } from './orderStatus';

export const ALL_ORDER_STATUSES = 'all';

export function isSellerOrderVisible(
    status: string,
    selectedStatus: string,
    showPending: boolean,
): boolean {
    const matchesSelectedStatus = selectedStatus === ALL_ORDER_STATUSES || status === selectedStatus;
    const matchesPendingVisibility = showPending || status !== ORDER_STATUS.PENDING;

    return matchesSelectedStatus && matchesPendingVisibility;
}
