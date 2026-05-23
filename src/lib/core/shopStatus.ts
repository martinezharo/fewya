export const SHOP_STATUS = {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
} as const;
export type ShopStatus = (typeof SHOP_STATUS)[keyof typeof SHOP_STATUS];
export const SHOP_STATUSES = Object.values(SHOP_STATUS) as ShopStatus[];
