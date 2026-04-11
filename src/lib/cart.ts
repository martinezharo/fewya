export interface CartItem {
    productId: string;
    variantId: string;
    quantity: number;
    // Denormalized data for display without API calls
    title: string;
    image: string;
    price: number;
    stock: number;
    variantName: string | null;
    shopId: string;
    shopName: string;
    shopSlug: string;
    productSlug: string;
}

const CART_KEY = 'shopenn_cart';

function getCart(): CartItem[] {
    try {
        const raw = localStorage.getItem(CART_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function saveCart(items: CartItem[]): void {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent('cart-updated', { detail: { count: getCartCount(items) } }));
}

function getCartCount(items?: CartItem[]): number {
    const cart = items ?? getCart();
    return cart.reduce((sum, item) => sum + item.quantity, 0);
}

function addToCart(item: Omit<CartItem, 'quantity'>, quantity = 1): void {
    const cart = getCart();
    const existing = cart.find(i => i.variantId === item.variantId);
    if (existing) {
        existing.quantity += quantity;
    } else {
        cart.push({ ...item, quantity });
    }
    saveCart(cart);
}

function updateQuantity(variantId: string, quantity: number): void {
    const cart = getCart();
    const idx = cart.findIndex(i => i.variantId === variantId);
    if (idx === -1) return;
    if (quantity <= 0) {
        cart.splice(idx, 1);
    } else {
        cart[idx].quantity = quantity;
    }
    saveCart(cart);
}

function removeFromCart(variantId: string): void {
    const cart = getCart().filter(i => i.variantId !== variantId);
    saveCart(cart);
}

function clearCart(): void {
    localStorage.removeItem(CART_KEY);
    window.dispatchEvent(new CustomEvent('cart-updated', { detail: { count: 0 } }));
}

function getCartGroupedByShop(): Map<string, { shopName: string; shopSlug: string; items: CartItem[] }> {
    const cart = getCart();
    const grouped = new Map<string, { shopName: string; shopSlug: string; items: CartItem[] }>();
    for (const item of cart) {
        if (!grouped.has(item.shopId)) {
            grouped.set(item.shopId, { shopName: item.shopName, shopSlug: item.shopSlug, items: [] });
        }
        grouped.get(item.shopId)!.items.push(item);
    }
    return grouped;
}

export const cart = {
    get: getCart,
    save: saveCart,
    count: getCartCount,
    add: addToCart,
    updateQuantity,
    remove: removeFromCart,
    clear: clearCart,
    groupedByShop: getCartGroupedByShop,
};
