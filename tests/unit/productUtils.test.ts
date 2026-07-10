import { describe, it, expect, vi } from 'vitest';
import { enrichProductsWithRatings } from '../../src/lib/products/productUtils';
import type { Product } from '../../src/lib/core/types';

function makeProduct(id: string): Product {
    return { id } as Product;
}

function makeClient(reviewsData: Array<{ product_id: string; rating: number }> | null) {
    const inMock = vi.fn().mockResolvedValue({ data: reviewsData });
    const selectMock = vi.fn().mockReturnValue({ in: inMock });
    const fromMock = vi.fn().mockReturnValue({ select: selectMock });
    return { from: fromMock, _mocks: { fromMock, selectMock, inMock } } as any;
}

describe('enrichProductsWithRatings', () => {
    it('returns the same (empty) array without querying when there are no products', async () => {
        const client = makeClient(null);
        const result = await enrichProductsWithRatings([], client);
        expect(result).toEqual([]);
        expect(client._mocks.fromMock).not.toHaveBeenCalled();
    });

    it('queries reviews for exactly the given product ids', async () => {
        const client = makeClient([]);
        const products = [makeProduct('p1'), makeProduct('p2')];
        await enrichProductsWithRatings(products, client);

        expect(client._mocks.fromMock).toHaveBeenCalledWith('reviews');
        expect(client._mocks.selectMock).toHaveBeenCalledWith('product_id, rating');
        expect(client._mocks.inMock).toHaveBeenCalledWith('product_id', ['p1', 'p2']);
    });

    it('returns products untouched when there is no reviews data', async () => {
        const client = makeClient(null);
        const products = [makeProduct('p1')];
        const result = await enrichProductsWithRatings(products, client);
        expect(result[0].review_avg).toBeUndefined();
        expect(result[0].review_count).toBeUndefined();
    });

    it('returns products untouched when reviews data is an empty array', async () => {
        const client = makeClient([]);
        const products = [makeProduct('p1')];
        const result = await enrichProductsWithRatings(products, client);
        expect(result[0].review_avg).toBeUndefined();
        expect(result[0].review_count).toBeUndefined();
    });

    it('aggregates average rating and count per product', async () => {
        const client = makeClient([
            { product_id: 'p1', rating: 5 },
            { product_id: 'p1', rating: 3 },
            { product_id: 'p2', rating: 4 },
        ]);
        const products = [makeProduct('p1'), makeProduct('p2')];
        const result = await enrichProductsWithRatings(products, client);

        expect(result[0].review_avg).toBe(4); // (5+3)/2
        expect(result[0].review_count).toBe(2);
        expect(result[1].review_avg).toBe(4);
        expect(result[1].review_count).toBe(1);
    });

    it('leaves products without any matching review unmodified', async () => {
        const client = makeClient([{ product_id: 'p1', rating: 5 }]);
        const products = [makeProduct('p1'), makeProduct('p2')];
        const result = await enrichProductsWithRatings(products, client);

        expect(result[1].review_avg).toBeUndefined();
        expect(result[1].review_count).toBeUndefined();
    });

    it('mutates and returns the same array instance passed in', async () => {
        const client = makeClient([{ product_id: 'p1', rating: 5 }]);
        const products = [makeProduct('p1')];
        const result = await enrichProductsWithRatings(products, client);
        expect(result).toBe(products);
    });
});
