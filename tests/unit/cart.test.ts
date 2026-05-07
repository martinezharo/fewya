import { describe, it, expect, beforeEach } from 'vitest';
import { cart, type CartItem } from '../../src/lib/cart/cart';

const CART_KEY = 'fewya_cart';

function createItem(overrides: Partial<CartItem> = {}): Omit<CartItem, 'quantity'> {
    return {
        productId: 'prod-1',
        variantId: 'var-1',
        title: 'Producto de prueba',
        image: 'https://example.com/img.jpg',
        price: 19.99,
        stock: 10,
        variantName: 'Talla M',
        shopId: 'shop-1',
        shopName: 'Tienda Prueba',
        shopSlug: 'tienda-prueba',
        productSlug: 'producto-prueba',
        shippingCost: 3.5,
        ...overrides,
    };
}

describe('cart', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    describe('get', () => {
        it('devuelve un array vacío cuando no hay carrito', () => {
            expect(cart.get()).toEqual([]);
        });

        it('devuelve los items guardados', () => {
            const items: CartItem[] = [
                { ...createItem(), quantity: 1 },
            ];
            localStorage.setItem(CART_KEY, JSON.stringify(items));
            expect(cart.get()).toEqual(items);
        });

        it('devuelve array vacío si localStorage tiene JSON corrupto', () => {
            localStorage.setItem(CART_KEY, 'not-json');
            expect(cart.get()).toEqual([]);
        });
    });

    describe('count', () => {
        it('devuelve 0 para carrito vacío', () => {
            expect(cart.count()).toBe(0);
        });

        it('suma las cantidades de todos los items', () => {
            const items: CartItem[] = [
                { ...createItem({ variantId: 'var-1' }), quantity: 2 },
                { ...createItem({ variantId: 'var-2' }), quantity: 3 },
            ];
            localStorage.setItem(CART_KEY, JSON.stringify(items));
            expect(cart.count()).toBe(5);
        });
    });

    describe('add', () => {
        it('añade un nuevo item al carrito', () => {
            cart.add(createItem(), 2);
            const result = cart.get();
            expect(result).toHaveLength(1);
            expect(result[0].quantity).toBe(2);
            expect(result[0].variantId).toBe('var-1');
        });

        it('incrementa cantidad si la variante ya existe', () => {
            cart.add(createItem(), 1);
            cart.add(createItem(), 3);
            const result = cart.get();
            expect(result).toHaveLength(1);
            expect(result[0].quantity).toBe(4);
        });

        it('emite evento cart-updated al añadir', () => {
            const listener = vi.fn();
            window.addEventListener('cart-updated', listener);
            cart.add(createItem(), 2);
            expect(listener).toHaveBeenCalledOnce();
            const event = listener.mock.calls[0][0] as CustomEvent;
            expect(event.detail.count).toBe(2);
            window.removeEventListener('cart-updated', listener);
        });
    });

    describe('updateQuantity', () => {
        it('actualiza la cantidad de una variante existente', () => {
            cart.add(createItem(), 1);
            cart.updateQuantity('var-1', 5);
            expect(cart.get()[0].quantity).toBe(5);
        });

        it('elimina el item si la cantidad es 0', () => {
            cart.add(createItem(), 2);
            cart.updateQuantity('var-1', 0);
            expect(cart.get()).toHaveLength(0);
        });

        it('elimina el item si la cantidad es negativa', () => {
            cart.add(createItem(), 2);
            cart.updateQuantity('var-1', -1);
            expect(cart.get()).toHaveLength(0);
        });

        it('no hace nada si la variante no existe', () => {
            cart.add(createItem(), 1);
            cart.updateQuantity('var-inexistente', 5);
            expect(cart.get()).toHaveLength(1);
            expect(cart.get()[0].quantity).toBe(1);
        });
    });

    describe('remove', () => {
        it('elimina un item por variantId', () => {
            cart.add(createItem({ variantId: 'var-1' }), 1);
            cart.add(createItem({ variantId: 'var-2' }), 1);
            cart.remove('var-1');
            expect(cart.get()).toHaveLength(1);
            expect(cart.get()[0].variantId).toBe('var-2');
        });
    });

    describe('clear', () => {
        it('vacia el carrito completamente', () => {
            cart.add(createItem(), 3);
            cart.clear();
            expect(cart.get()).toHaveLength(0);
            expect(localStorage.getItem(CART_KEY)).toBeNull();
        });

        it('emite evento cart-updated con count 0', () => {
            const listener = vi.fn();
            window.addEventListener('cart-updated', listener);
            cart.add(createItem(), 2);
            cart.clear();
            const lastCall = listener.mock.calls[listener.mock.calls.length - 1][0] as CustomEvent;
            expect(lastCall.detail.count).toBe(0);
            window.removeEventListener('cart-updated', listener);
        });
    });

    describe('groupedByShop', () => {
        it('agrupa items por shopId', () => {
            cart.add(createItem({ variantId: 'var-1', shopId: 'shop-a', shopName: 'Tienda A', shopSlug: 'tienda-a' }), 1);
            cart.add(createItem({ variantId: 'var-2', shopId: 'shop-a', shopName: 'Tienda A', shopSlug: 'tienda-a' }), 2);
            cart.add(createItem({ variantId: 'var-3', shopId: 'shop-b', shopName: 'Tienda B', shopSlug: 'tienda-b' }), 1);

            const grouped = cart.groupedByShop();
            expect(grouped.size).toBe(2);
            expect(grouped.get('shop-a')?.items).toHaveLength(2);
            expect(grouped.get('shop-b')?.items).toHaveLength(1);
            expect(grouped.get('shop-a')?.shopName).toBe('Tienda A');
        });

        it('devuelve mapa vacío para carrito vacío', () => {
            expect(cart.groupedByShop().size).toBe(0);
        });
    });
});
