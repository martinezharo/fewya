- Tipado: stripe: any en lib/cart/checkout.ts:78; (item as any).product_variants repetido en auto-confirm.ts:97, refund-incident.ts:96,
  autoReview.ts:15-17; (profile as any)?.phone_prefix en api/cart/checkout.ts:150. Generar tipos con supabase gen types y tipar Stripe.
- i18n: strings hardcoded fuera de lib/core/i18n.ts — '+34' (api/cart/checkout.ts:150), 'Envío gratis'
  ([shopSlug]/[productSlug].astro:59,275), 'Este pedido no puede cancelarse' (api/orders/refund.ts:61).
- Constantes duplicadas: 48*60*60\*1000 en SellerOrderCard.astro:62 + api/orders/seller-confirm.ts:21 + SQL interval '48 hours'
    (02-orders.sql:469). Centralizar.
- Phone prefix: fallback '+34' rompe si Fewya se expande fuera de ES; derivarlo de address_country o exigirlo en isProfileComplete.
- Error de Stripe filtrado: refund-incident.ts:194 devuelve error.message literal al cliente.
- Logging estructurado: console.error('releaseOrderFunds failed', error) (lib/cart/checkout.ts:110) sin orderId/shopId; idem en
    autoReview.ts:43, refund-incident.ts:193. Workers Logs indexa JSON.
- Componentes monstruo: OrderCard.astro 999 LOC, SellerOrderCard.astro 634 LOC. Extraer modelo (lib/orders/orderCardModel.ts) con lógica
    pura, dejar el .astro solo para markup.
- Cobertura tests: sin tests para refund.ts, refund-incident.ts, seller-confirm.ts, auto-confirm.ts, autoReview.ts, releaseOrderFunds.
    Endpoints donde se mueve dinero deben tenerlos.
- SEO / Meta: Layout.astro probablemente sin og:image, twitter:card, JSON-LD Product schema; sitemap.xml y robots.txt ausentes.
- PWA icons: solo SVG en astro.config.mjs:41-50; Safari iOS no los acepta como maskable. Generar PNG 192/512.
- Estado UI cliente-servidor: stock en cart drawer puede estar stale (lib/cart/cart-client.ts) y solo se detecta en checkout.