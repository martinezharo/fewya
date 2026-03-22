export const strings = {
    // Meta / SEO
    siteTitle: 'EWYA — Marketplace de pequeños negocios',
    siteDescription: 'Descubre productos únicos de vendedores independientes. Compra directamente, sin intermediarios.',

    // Header
    logoText: 'ewya',
    searchPlaceholder: 'Buscar productos...',

    // Hero Banner — Web (unregistered)
    heroTitle: 'Compra a vendedores profesionales',
    heroSubtitle: 'Productos únicos de vendedores independientes. Sin intermediarios, sin complicaciones.',
    heroCta: 'Explorar productos',

    // Hero Banner — PWA (unregistered)
    pwaSignupMessage: 'Regístrate para guardar favoritos y hacer seguimiento de tus pedidos.',
    pwaSignupCta: 'Crear cuenta',

    // Navigation
    navHome: 'Inicio',
    navWishlist: 'Favoritos',
    navProfile: 'Yo',
    navCart: 'Carrito',
    navSell: 'Vender',
    navPrimaryAria: 'Navegacion principal',
    navMobileAria: 'Navegacion movil',

    // Product Card
    addToWishlist: 'Añadir a favoritos',
    addToCart: 'Añadir',
    noRatings: 'Sin reseñas',

    // General
    currency: '€',

    // Product Page
    productShipping: '+3,49€ envío',
    productVariantsTitle: 'Variante',
    productInStock: 'En Stock',
    productOutOfStock: 'Agotado',
    productAddToCart: 'Añadir al carrito',
    productCategory: 'Categoría',
    productBrand: 'Marca',
    productDescription: 'Descripción',
    productReviews: 'Reseñas',
    productNoReviews: 'Aún no hay reseñas',
    productReport: 'Reportar producto',
    productShare: 'Compartir',
    productBack: 'Volver',
    productContactEmail: 'Email',
    productContactWhatsapp: 'WhatsApp',
    productClose: 'Cerrar',
    productAnonymous: 'Anónimo',
    productImage: 'Imagen',
    productQtyDecrease: 'Reducir cantidad',
    productQtyIncrease: 'Aumentar cantidad',
    productContact: 'Contactar',

    // Shop Page
    shopAbout: 'Acerca de la tienda',
    shopLocation: 'Ubicación',
    shopProducts: 'Todos los productos',
    shopProductsCount: 'productos',
    shopNoDescription: 'Sin descripción disponible.',

    // Auth
    heroGoogleSignIn: 'Continuar con Google',

    // Profile Page
    profilePageTitle: 'Mi perfil — EWYA',
    profileAnonymous: 'Usuario',
    profileSignOut: 'Cerrar sesión',

    // Wishlist
    wishlistPageTitle: 'Mis favoritos — EWYA',
    wishlistEmpty: 'Aún no tienes favoritos',
    wishlistEmptySub: 'Explora productos y guarda los que más te gusten.',
    wishlistExploreCta: 'Explorar productos',
    removeFromWishlist: 'Quitar de favoritos',
    loginToWishlist: 'Inicia sesión para guardar favoritos',

    // Search
    searchRecent: 'Búsquedas recientes',
    searchClear: 'Borrar',
    searchClearRecent: 'Borrar recientes',
    searchNoResults: 'No se encontraron resultados para',
    searchTryDifferentTerms: 'Intenta con otros terminos o ajusta los filtros.',
    searchFilters: 'Filtros',
    searchSort: 'Ordenar por',
    searchApply: 'Aplicar',
    searchClearFilters: 'Limpiar',
    searchPriceRange: 'Rango de precio',
    searchPriceMin: 'Min',
    searchPriceMax: 'Max',
    searchPriceMinPlaceholder: '0',
    searchPriceMaxPlaceholder: '500',
    searchShowOos: 'Mostrar stock agotado',
    searchSortRelevance: 'Relevancia',
    searchSortAlpha: 'Alfabético',
    searchSortPrice: 'Precio',
    searchSortDate: 'Fecha',
    searchPageTitlePrefix: 'Buscar',

    // Cart
    cartPageTitle: 'Mi carrito — EWYA',
    cartEmpty: 'Tu carrito está vacío',
    cartEmptySub: 'Añade productos de las tiendas que más te gusten.',
    cartExploreCta: 'Explorar productos',
    cartShipping: 'Envío',
    cartShippingPrice: '2,99€',
    cartCheckout: 'Tramitar pedido',
    cartTotal: 'Total',
    cartOrderSuccess: 'Pedido realizado con éxito',
    cartLoginRequired: 'Inicia sesión para tramitar tu pedido',
    cartRemove: 'Eliminar del carrito',
    cartCheckoutError: 'Error al procesar el pedido',
    cartProductSingular: 'producto',
    cartProductPlural: 'productos',
    cartShippingIncluded: 'Envio incluido',

    // Me / Profile Dashboard
    mePageTitle: 'Mi cuenta — EWYA',
    meLastPurchases: 'Últimas compras',
    meViewAllOrders: 'Ver todos',
    meMyOrders: 'Mis pedidos',
    meMyData: 'Mis datos',
    meSettings: 'Ajustes',
    meItemsCount: '+{count}',

    // Me / Mis datos
    meDataPageTitle: 'Mis datos',
    meDataName: 'Nombre',
    meDataEmail: 'Correo electrónico',
    meDataPhone: 'Teléfono',
    meDataPhonePlaceholder: '+34 600 000 000',
    meDataAddress: 'Dirección de envío',
    meDataAddressPlaceholder: 'Calle, número, piso, ciudad, código postal…',
    meDataSave: 'Guardar cambios',
    meDataSaving: 'Guardando…',
    meDataSaveSuccess: 'Cambios guardados correctamente',
    meDataSaveError: 'No se pudieron guardar los cambios',
    meDataAvatarNote: 'Foto de perfil',

    // Orders / states
    orderStatusPending: 'Pendiente',
    orderStatusPaid: 'Pagado',
    orderStatusProcessing: 'Procesando',
    orderStatusShipped: 'Enviado',
    orderStatusDelivered: 'Entregado',
    orderStatusCancelled: 'Cancelado',

    // Variant fallbacks
    variantDefaultName: 'Estandar',
    variantFallbackName: 'Variante {index}',

    // Fallback content
    fallbackShopName: 'Tienda',
    fallbackProductName: 'Producto',

    // Auth / API / errors
    authGoogleLoginError: 'Error al iniciar sesion con Google',
    authMissingSupabaseEnv: 'Variables de entorno SUPABASE_URL o SUPABASE_KEY no encontradas en Cloudflare',
    apiUnauthorized: 'No autenticado',
    apiInvalidBody: 'Cuerpo invalido',
    apiCartEmpty: 'El carrito esta vacio',
    apiInvalidProductData: 'Datos de producto invalidos',
    apiOrderCreateError: 'Error al crear el pedido',
    apiOrderItemsSaveError: 'Error al guardar los productos del pedido',
} as const;
