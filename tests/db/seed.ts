import { IDS, type Db } from './harness';

/**
 * Two shops with different owners, two unrelated buyers, and one paid order per
 * shop.
 *
 * That is the smallest world in which "seller B must not see this" is a real
 * question rather than an empty set. Everything is inserted as `service_role`,
 * which is how the server writes: the tests then read it back as the people who
 * must and must not be able to.
 */
export async function seed(db: Db): Promise<void> {
    const sql = (text: string, params: unknown[] = []) =>
        db.as('service_role', null, text, params);

    await sql(
        `INSERT INTO auth.users (id, email) VALUES ($1,$2),($3,$4),($5,$6),($7,$8)`,
        [
            IDS.sellerA, 'seller-a@test.local',
            IDS.sellerB, 'seller-b@test.local',
            IDS.buyer1, 'buyer-1@test.local',
            IDS.buyer2, 'buyer-2@test.local',
        ],
    );

    // The profiles rows already exist: the schema's `on_auth_user_created`
    // trigger created them from the inserts above, which is what a real sign-up
    // does. Only the seller flag is left to set.
    await sql(`UPDATE public.profiles SET is_seller = true WHERE id = ANY($1)`, [
        [IDS.sellerA, IDS.sellerB],
    ]);

    await sql(
        `INSERT INTO public.shops (id, owner_id, name, slug) VALUES ($1,$2,'Shop A','shop-a'),($3,$4,'Shop B','shop-b')`,
        [IDS.shopA, IDS.sellerA, IDS.shopB, IDS.sellerB],
    );

    // Stripe account ids and payout flags: commercially sensitive, and the
    // reason `shop_payment_accounts` is worth a test of its own.
    await sql(
        `INSERT INTO public.shop_payment_accounts (shop_id, stripe_account_id, payouts_enabled)
         VALUES ($1,'acct_SHOP_A_SECRET',true),($2,'acct_SHOP_B_SECRET',true)`,
        [IDS.shopA, IDS.shopB],
    );

    await sql(
        `INSERT INTO public.products (id, shop_id, title, category, slug)
         VALUES ($1,$2,'Product A','cat','product-a'),($3,$4,'Product B','cat','product-b')`,
        [IDS.productA, IDS.shopA, IDS.productB, IDS.shopB],
    );

    // Each product already has a default variant: the schema's
    // `on_product_created` trigger made one. Adopting it rather than inserting
    // a second keeps the fixture the shape a real product has.
    await sql(
        `UPDATE public.product_variants SET id = $1, variant_name = 'default', price = 10.00, stock = 5
          WHERE product_id = $2`,
        [IDS.variantA, IDS.productA],
    );
    await sql(
        `UPDATE public.product_variants SET id = $1, variant_name = 'default', price = 20.00, stock = 5
          WHERE product_id = $2`,
        [IDS.variantB, IDS.productB],
    );

    // buyer1 bought from shop A; buyer2 bought from shop B.
    await sql(
        `INSERT INTO public.orders (id, public_id, buyer_id, shop_id, total_amount, payment_status)
         VALUES ($1,'ORD-A',$2,$3,10.00,'paid'),($4,'ORD-B',$5,$6,20.00,'paid')`,
        [IDS.orderA, IDS.buyer1, IDS.shopA, IDS.orderB, IDS.buyer2, IDS.shopB],
    );

    await sql(
        `INSERT INTO public.order_items (order_id, variant_id, quantity, price_at_purchase)
         VALUES ($1,$2,1,10.00),($3,$4,1,20.00)`,
        [IDS.orderA, IDS.variantA, IDS.orderB, IDS.variantB],
    );

    await sql(
        `INSERT INTO public.shipments (order_id, tracking_number, carrier_name)
         VALUES ($1,'TRACK-A','inpost'),($2,'TRACK-B','correos')`,
        [IDS.orderA, IDS.orderB],
    );

    await sql(
        `INSERT INTO public.refunds (order_id, amount, processed_by) VALUES ($1,5.00,$2),($3,5.00,$4)`,
        [IDS.orderA, IDS.sellerA, IDS.orderB, IDS.sellerB],
    );

    await sql(
        `INSERT INTO public.order_incidents (order_id, description) VALUES ($1,'Damaged A'),($2,'Damaged B')`,
        [IDS.orderA, IDS.orderB],
    );

    await sql(
        `INSERT INTO public.wishlist (profile_id, product_id) VALUES ($1,$2),($3,$4)`,
        [IDS.buyer1, IDS.productB, IDS.buyer2, IDS.productA],
    );

    await sql(
        `INSERT INTO public.reviews (product_id, profile_id, rating, comment)
         VALUES ($1,$2,5,'Great'),($3,$4,4,'Good')`,
        [IDS.productA, IDS.buyer1, IDS.productB, IDS.buyer2],
    );

    await sql(
        `INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth)
         VALUES ($1,'https://push.test/a','k','a'),($2,'https://push.test/b','k','a')`,
        [IDS.buyer1, IDS.buyer2],
    );
}
