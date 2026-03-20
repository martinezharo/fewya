export interface PurchaseItem {
    id: string;
    imageUrl: string;
    productName: string;
}

export interface PurchaseShopOrder {
    shopId: string;
    shopName: string;
    items: PurchaseItem[];
    date: Date;
    orderId: string;
}

// Mock data representing last 5 unique shop orders (even if bought together)
export const MOCK_LAST_PURCHASES: PurchaseShopOrder[] = [
    {
        orderId: 'ORD-001',
        shopId: 'shop-1',
        shopName: 'Artesanía Paco',
        date: new Date('2026-03-15'),
        items: [
            { id: 'p1', imageUrl: 'https://images.unsplash.com/photo-1544816155-12df9643f363?w=500&h=500&fit=crop', productName: 'Jarron cerámico' }
        ]
    },
    {
        orderId: 'ORD-002',
        shopId: 'shop-2',
        shopName: 'La huerta de María',
        date: new Date('2026-03-14'),
        items: [
            { id: 'p2', imageUrl: 'https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=500&h=500&fit=crop', productName: 'Tomates' },
            { id: 'p3', imageUrl: 'https://images.unsplash.com/photo-1518977676601-b53f82aba655?w=500&h=500&fit=crop', productName: 'Patatas' }
        ]
    },
    {
        orderId: 'ORD-003',
        shopId: 'shop-1',
        shopName: 'Artesanía Paco',
        date: new Date('2026-03-10'),
        items: [
            { id: 'p4', imageUrl: 'https://images.unsplash.com/photo-1610701596007-11502861dcfa?w=500&h=500&fit=crop', productName: 'Plato decorativo' }
        ]
    },
    {
        orderId: 'ORD-004',
        shopId: 'shop-3',
        shopName: 'Electrónica Retro',
        date: new Date('2026-03-08'),
        items: [
            { id: 'p5', imageUrl: 'https://images.unsplash.com/photo-1550009158-9ebf69173e03?w=500&h=500&fit=crop', productName: 'Cable audio' },
            { id: 'p6', imageUrl: 'https://images.unsplash.com/photo-1608223652643-fc408711bd71?w=500&h=500&fit=crop', productName: 'Adaptador' },
            { id: 'p7', imageUrl: 'https://images.unsplash.com/photo-1522273400909-fd1a8f77637e?w=500&h=500&fit=crop', productName: 'Cascos' }
        ]
    },
    {
        orderId: 'ORD-005',
        shopId: 'shop-4',
        shopName: 'Librería Central',
        date: new Date('2026-03-01'),
        items: [
            { id: 'p8', imageUrl: 'https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=500&h=500&fit=crop', productName: 'Libro de recetas' }
        ]
    }
];
