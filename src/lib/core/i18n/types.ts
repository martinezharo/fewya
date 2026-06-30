export interface Strings {
    // Meta / SEO
    siteTitle: string;
    siteDescription: string;

    // Header
    logoText: string;
    searchPlaceholder: string;

    // Hero Banner — Web (unregistered)
    heroTitle: string;
    heroSubtitle: string;
    heroCta: string;

    // Hero Banner — PWA (unregistered)
    pwaSignupMessage: string;
    pwaSignupCta: string;

    // Hero Banner — Mobile
    heroTitleMobile: string;
    heroSubtitleMobile: string;
    heroTitleMobileLoggedIn: string;
    heroSubtitleMobileLoggedIn: string;
    heroInstallApp: string;
    heroMobileTagline: string;

    // App Install Instructions
    installIosTitle: string;
    installIosHint: string;
    installIosStep1: string;
    installIosStep2: string;
    installIosStep3: string;
    installGenericMessage: string;
    installClose: string;

    // Navigation
    navHome: string;
    navBackToBuyers: string;
    navWishlist: string;
    navProfile: string;
    navCart: string;
    navSell: string;
    navPrimaryAria: string;
    navMobileAria: string;

    // Product Card
    addToWishlist: string;
    addToCart: string;
    noRatings: string;

    // General
    currency: string;
    freeShipping: string;
    freeLabel: string;
    apiOrderCannotBeCancelled: string;
    sellerOrderRefundUnexpectedError: string;
    sellerIncidentNoticeForSeller: string;
    sellerOrderNoActions: string;

    // Product Page
    productShipping: string;
    productVariantsTitle: string;
    productInStock: string;
    productOutOfStock: string;
    productAddToCart: string;
    productCategory: string;
    productBrand: string;
    productDescription: string;
    productReviews: string;
    productNoReviews: string;
    productShare: string;
    productBack: string;
    productContactEmail: string;
    productContactWhatsapp: string;
    productClose: string;
    productAnonymous: string;
    productImage: string;
    productPrevImage: string;
    productNextImage: string;
    productQtyDecrease: string;
    productQtyIncrease: string;
    productContact: string;

    // Shop Page
    shopAbout: string;
    shopLocation: string;
    shopProducts: string;
    shopProductsCount: string;
    shopNoDescription: string;

    // Auth / Login
    heroGoogleSignIn: string;
    loginPageTitle: string;
    loginPageDescription: string;
    loginSubtitle: string;
    loginGoogleCta: string;
    loginTermsHint: string;
    loginTermsHintTerms: string;
    loginTermsHintAnd: string;
    loginTermsHintPrivacy: string;
    loginBackToHome: string;

    // Profile Page
    profilePageTitle: string;
    profileAnonymous: string;
    profileSignOut: string;

    // Wishlist
    wishlistPageTitle: string;
    wishlistEmpty: string;
    wishlistEmptySub: string;
    wishlistExploreCta: string;
    removeFromWishlist: string;
    loginToWishlist: string;

    // Search
    searchRecent: string;
    searchClear: string;
    searchClearRecent: string;
    searchNoResults: string;
    searchTryDifferentTerms: string;
    searchFilters: string;
    searchSort: string;
    searchApply: string;
    searchClearFilters: string;
    searchPriceRange: string;
    searchPriceMin: string;
    searchPriceMax: string;
    searchPriceMinPlaceholder: string;
    searchPriceMaxPlaceholder: string;
    searchShowOos: string;
    searchSortRelevance: string;
    searchSortAlpha: string;
    searchSortPrice: string;
    searchSortDate: string;
    searchPageTitlePrefix: string;

    // Cart
    cartPageTitle: string;
    cartEmpty: string;
    cartEmptySub: string;
    cartExploreCta: string;
    cartShipping: string;
    cartTotal: string;
    cartCheckout: string;
    cartShippingIncluded: string;
    cartLoginRequired: string;
    cartRemove: string;
    cartProductSingular: string;
    cartProductPlural: string;
    cartCheckoutError: string;
    cartCheckoutRedirecting: string;

    // Delivery selection
    deliveryTitle: string;
    deliveryHome: string;
    deliveryHomeDesc: string;
    deliveryPickup: string;
    deliveryPickupDesc: string;
    deliveryHomeUnavailable: string;
    deliveryHomeUnavailableMulti: string;
    deliveryPickupUnavailable: string;
    deliveryPickupUnavailableMulti: string;
    deliveryNoOptions: string;
    deliverySelectPickup: string;
    deliverySearching: string;
    deliveryNoResults: string;
    deliverySearchError: string;
    deliveryLoadingAddress: string;
    deliveryPostalCodePlaceholder: string;
    deliverySearch: string;
    deliveryOpeningHours: string;
    deliveryDistance: string;
    deliverySelected: string;
    deliveryContinue: string;
    deliveryBack: string;
    deliveryChange: string;
    deliveryConfirmSelection: string;
    deliveryClose: string;
    cartSuccessPageTitle: string;
    cartSuccessLoading: string;
    cartSuccessTitle: string;
    cartSuccessSubtitle: string;
    cartSuccessOrderNumber: string;
    cartSuccessOrdersCta: string;
    cartSuccessContinueCta: string;
    cartSuccessErrorTitle: string;
    cartSuccessErrorSubtitle: string;
    cartCancelPageTitle: string;
    cartCancelTitle: string;
    cartCancelSubtitle: string;
    cartCancelReturnCta: string;

    // Me / Profile Dashboard
    mePageTitle: string;
    meLastPurchases: string;
    meViewAllOrders: string;
    meMyOrders: string;
    meMyData: string;
    meSettings: string;
    meSupport: string;
    meItemsCount: string;

    // Support
    supportPageTitle: string;
    supportHeading: string;
    supportSubtitle: string;
    supportIntro: string;
    supportEmailLabel: string;
    supportResponseNote: string;
    supportEmail: string;

    // Me / My details
    meDataPageTitle: string;
    meDataName: string;
    meDataEmail: string;
    meDataPhone: string;
    meDataPhonePlaceholder: string;
    meDataAddress: string;
    meDataAddressPlaceholder: string;
    meDataSave: string;
    meDataSaving: string;
    meDataSaveSuccess: string;
    meDataSaveAndReturnSuccess: string;
    meDataSaveError: string;
    meDataAvatarNote: string;
    meDataAvatarUpload: string;
    meDataAvatarChange: string;
    meDataAvatarRemove: string;
    meDataAvatarUploading: string;
    meDataAvatarSaved: string;
    meDataAvatarError: string;
    meDataCheckoutNoticeTitle: string;
    meDataCheckoutNoticeSubtitle: string;
    meDataIncompleteNoticeTitle: string;
    meDataIncompleteNoticeSubtitle: string;
    meDataEmailOptInLabel: string;

    // Form validation errors
    validationRequired: string;
    validationNameMinLength: string;
    validationNameMaxLength: string;
    validationLastNameMinLength: string;
    validationLastNameMaxLength: string;
    validationPhoneFormat: string;
    validationPhonePrefixMissing: string;
    validationStreetMinLength: string;
    validationStreetMaxLength: string;
    validationNumberMaxLength: string;
    validationFloorMaxLength: string;
    validationPostalCodeFormat: string;
    validationPostalCodeFormatEs: string;
    validationCityMinLength: string;
    validationCityMaxLength: string;
    validationProvinceRequiredEs: string;
    validationNameFormat: string;
    validationCityFormat: string;

    // Orders page
    ordersPageTitle: string;
    ordersHeading: string;
    ordersEmpty: string;
    ordersEmptySub: string;
    ordersExploreCta: string;
    ordersItemsSingular: string;
    ordersItemsPlural: string;
    ordersItemsUnit: string;
    ordersTotal: string;
    ordersOrder: string;
    ordersSubtotal: string;
    ordersFreeShipping: string;

    // Shipping / Sendcloud
    shippingCreateShipment: string;
    shippingCreatingShipment: string;
    shippingShipmentCreated: string;
    shippingShipmentError: string;
    shippingViewLabel: string;
    shippingTrackPackage: string;
    shippingTrackingNumber: string;
    shippingCarrier: string;
    shippingService: string;
    shippingSelectCarrier: string;
    shippingNoRates: string;
    shippingRatesError: string;
    shippingLabelReady: string;
    shippingShipped: string;
    shippingDelivered: string;
    shippingPending: string;
    shippingFailed: string;
    shippingCancelled: string;

    // Orders / states
    orderStatusPending: string;
    orderStatusPaid: string;
    orderStatusProcessing: string;
    orderStatusShipped: string;
    orderStatusDelivered: string;
    orderStatusConfirmed: string;
    orderStatusIncident: string;
    orderStatusDeliveryFailed: string;
    orderStatusCancelled: string;
    orderStatusRefunded: string;

    // Seller Orders filters
    sellerOrdersFilterStatusLabel: string;
    sellerOrdersFilterStatusAll: string;
    sellerOrdersFilterShowPending: string;
    sellerOrdersFilterShowPendingHint: string;

    // Fund holding / buyer actions
    orderConfirmDelivery: string;
    orderConfirmDeliverySuccess: string;
    orderConfirmDeliveryError: string;
    orderReportIncident: string;
    orderReportIncidentSuccess: string;
    orderReportIncidentError: string;
    orderFundsHeld: string;
    orderFundsHeldTooltip: string;
    orderFundsReleased: string;
    orderAutoConfirmHint: string;
    orderIncidentReported: string;
    orderCancellationReason: string;
    orderHideBtn: string;
    orderHideModalTitle: string;
    orderHideModalBody: string;
    orderHideConfirm: string;
    orderHideDismiss: string;
    orderHideSuccess: string;
    orderHideError: string;
    orderHideNotAllowed: string;

    // Seller order management
    sellerOrderManage: string;
    sellerOrderCreateLabel: string;
    sellerOrderMockLabelHint: string;
    sellerOrderCancelOrder: string;
    sellerOrderCancelConfirm: string;
    sellerOrderCancelReasonLabel: string;
    sellerOrderCancelReasonPlaceholder: string;
    sellerOrderCancelReasonRequired: string;
    sellerOrderRefundSuccess: string;
    sellerOrderRefundError: string;
    sellerOrderLabelSuccess: string;
    sellerOrderLabelError: string;
    sellerOrderViewLabel: string;

    // Label cost modal (seller)
    sellerLabelCostModalTitle: string;
    sellerLabelCostLoading: string;
    sellerLabelCostRefreshing: string;
    sellerLabelCostError: string;
    sellerLabelCostUnavailable: string;
    sellerLabelCostCarrierLine: string;
    sellerLabelCostPickupPointLine: string;
    sellerLabelCostGrossLabel: string;
    sellerLabelCostSubsidyLabel: string;
    sellerLabelCostNetLabel: string;
    sellerLabelCostBuyerPaid: string;
    sellerLabelCostConfirm: string;
    sellerLabelCostCancel: string;

    // Seller order payout breakdown
    sellerPayoutProducts: string;
    sellerPayoutShippingCharged: string;
    sellerPayoutLabelCost: string;
    sellerPayoutNet: string;

    // Variant fallbacks
    variantDefaultName: string;
    variantFallbackName: string;

    // Fallback content
    fallbackShopName: string;
    fallbackProductName: string;

    // Settings Page
    settingsPageTitle: string;
    settingsTitle: string;
    settingsAppearanceSection: string;
    settingsThemeLabel: string;
    settingsThemeSystem: string;
    settingsThemeLight: string;
    settingsThemeDark: string;
    settingsAccountSection: string;
    settingsSignOut: string;
    settingsLegalSection: string;
    settingsPrivacyPolicy: string;
    settingsTermsOfService: string;

    // Settings — language
    settingsLanguageSection: string;
    settingsLanguageLabel: string;
    settingsLanguageHint: string;

    // Legal Pages
    privacyPolicyPageTitle: string;
    termsOfServicePageTitle: string;

    // Seller Settings
    sellerSettingsPageTitle: string;
    sellerSettingsTitle: string;
    sellerSettingsShippingSection: string;
    sellerSettingsShippingSubtitle: string;
    sellerSettingsDefaultWeightLabel: string;
    sellerSettingsDefaultDimensionsLabel: string;
    sellerSettingsDefaultLengthLabel: string;
    sellerSettingsDefaultWidthLabel: string;
    sellerSettingsDefaultHeightLabel: string;
    sellerSettingsDefaultShippingLabel: string;
    sellerSettingsCarriersSection: string;
    sellerSettingsCarriersSubtitle: string;
    sellerSettingsCarrierInpostLabel: string;
    sellerSettingsCarrierInpostDesc: string;
    sellerSettingsCarrierCorreosLabel: string;
    sellerSettingsCarrierCorreosDesc: string;
    sellerSettingsCarriersAtLeastOne: string;
    sellerSettingsSave: string;
    sellerSettingsSaving: string;
    sellerSettingsSaveSuccess: string;
    sellerSettingsSaveError: string;
    sellerSettingsDeleteShop: string;
    sellerSettingsDeleteShopConfirm: string;
    sellerSettingsDeleteShopSuccess: string;
    sellerSettingsDeleteShopError: string;

    // Seller Shipping
    sellerShippingPageTitle: string;
    sellerShippingTitle: string;
    sellerShippingSubtitle: string;

    // Seller sidebar / nav
    sellerNavDashboard: string;
    sellerNavOrders: string;
    sellerNavCatalog: string;
    sellerNavShop: string;
    sellerNavReviews: string;
    sellerNavClaims: string;
    sellerNavShipping: string;
    sellerNavSettings: string;
    sellerNavDetails: string;
    sellerNavDetailsIncomplete: string;
    sellerNavStripe: string;
    sellerNavStripeWarning: string;
    sellerNavStripeOpening: string;
    sellerSidebarLabel: string;
    sellerSidebarCollapseLabel: string;
    sellerSidebarExpandLabel: string;
    sellerSidebarCloseLabel: string;
    sellerSidebarOpenLabel: string;
    sellerSidebarViewShop: string;
    sellerBrandName: string;

    // Reviews
    reviewAddBtn: string;
    reviewEditBtn: string;
    reviewModalTitleAdd: string;
    reviewModalTitleEdit: string;
    reviewRatingLabel: string;
    reviewCommentLabel: string;
    reviewCommentPlaceholder: string;
    reviewSubmit: string;
    reviewSubmitting: string;
    reviewSubmitError: string;
    reviewSubmitSuccess: string;
    reviewRatingRequired: string;
    reviewCounter: string;

    // Incident reporting
    incidentDescriptionLabel: string;
    incidentDescriptionPlaceholder: string;
    incidentDescriptionError: string;
    incidentPhotosLabel: string;
    incidentPhotosHint: string;
    incidentPhotoTypeLabel: string;
    incidentPhotoTypeShippingLabel: string;
    incidentPhotoTypePackagingLabel: string;
    incidentPhotoTypeDefectLabel: string;
    incidentSubmit: string;
    incidentSubmitting: string;
    incidentCancel: string;
    incidentMinPhotosError: string;
    incidentMaxPhotosError: string;
    incidentUploadError: string;
    incidentUploading: string;
    incidentRemovePhoto: string;
    incidentViewDetails: string;
    incidentPanelTitle: string;
    incidentPanelEmpty: string;
    incidentPanelEmptySub: string;
    incidentPanelOrderLabel: string;
    incidentPanelCustomerLabel: string;
    incidentPanelDateLabel: string;
    incidentPanelDescriptionLabel: string;
    incidentPanelPhotosLabel: string;
    incidentReturnPolicyNotice: string;
    incidentReturnPolicyNoticeSuffix: string;
    incidentBadgeLabel: string;
    incidentUnderReviewNotice: string;
    incidentCancelBtn: string;
    incidentCancelModalTitle: string;
    incidentCancelModalWarning: string;
    incidentCancelConfirm: string;
    incidentCancelDismiss: string;
    incidentCancelledToast: string;
    incidentCancelError: string;
    orderPayoutDestinationUnavailable: string;

    // Seller incident refund
    sellerIncidentRefundBtn: string;
    sellerIncidentRefundConfirmTitle: string;
    sellerIncidentRefundConfirmBody: string;
    sellerIncidentRefundConfirmCta: string;
    sellerIncidentRefundDismiss: string;
    sellerIncidentRefundSuccess: string;
    sellerIncidentRefundError: string;
    sellerIncidentRefundInvalidStatus: string;
    sellerIncidentRefundInvalidPartial: string;

    // Delivery failed (lost or returned package)
    deliveryFailedSellerTitle: string;
    deliveryFailedSellerNotice: string;
    deliveryFailedBuyerTitle: string;
    deliveryFailedBuyerNotice: string;
    deliveryFailedRefundSuccess: string;
    deliveryFailedRefundError: string;
    deliveryFailedRefundInvalidStatus: string;

    // Refund types
    refundTypeFullTitle: string;
    refundTypeFullDesc: string;
    refundTypeProductTitle: string;
    refundTypeProductDesc: string;
    refundTypePartialTitle: string;
    refundTypePartialDesc: string;
    refundPartialInputLabel: string;
    refundPartialMaxHint: string;
    refundSummaryLabel: string;

    // Refunded order panels
    orderRefundedBadge: string;
    orderRefundedBuyerTitle: string;
    orderRefundedBuyerNotice: string;
    orderRefundedSellerTitle: string;
    orderRefundedSellerNotice: string;
    orderRefundedAmountLabel: string;
    orderRefundedRetainedLabel: string;

    // Auto reviews
    autoReviewComment: string;
    autoReviewBadge: string;

    // Seller order confirm delivery
    sellerOrderConfirmDelivery: string;
    sellerOrderConfirmDeliveryHint: string;
    sellerOrderConfirmDeliverySuccess: string;
    sellerOrderConfirmDeliveryError: string;
    sellerOrderDeliveredWaiting: string;

    // Seller reviews panel
    sellerReviewsPanelTitle: string;
    sellerReviewsPanelSubtitle: string;
    sellerReviewsEmpty: string;
    sellerReviewsEmptySub: string;
    sellerReviewsTotal: string;
    sellerReviewsTotalSingular: string;
    sellerReviewsAvgLabel: string;
    sellerReviewsReplyLabel: string;
    sellerReviewsReplyPlaceholder: string;
    sellerReviewsReplyBtn: string;
    sellerReviewsReplySubmit: string;
    sellerReviewsReplyEdit: string;
    sellerReviewsReplySaving: string;
    sellerReviewsReplyCancel: string;
    sellerReviewsReplyError: string;

    // Auth / API / errors
    authGoogleLoginError: string;
    authMissingSupabaseEnv: string;
    authMissingStripeEnv: string;
    apiUnauthorized: string;
    apiForbidden: string;
    apiInvalidBody: string;
    apiInternalError: string;
    apiFileInvalid: string;
    apiPathForbidden: string;
    apiProductNotFound: string;
    apiTooManyRequests: string;
    apiCartEmpty: string;
    apiInvalidProductData: string;
    apiOrderCreateError: string;
    apiOrderItemsSaveError: string;
    apiProfileIncomplete: string;
    apiCheckoutOutOfStock: string;
    apiCheckoutProductUnavailable: string;
    apiCheckoutSellerNotReady: string;
    apiCheckoutCarrierUnavailable: string;
    apiCheckoutSessionError: string;
    apiCheckoutConfirmationError: string;
    apiCheckoutSessionPending: string;
    apiCheckoutStockReservationFailed: string;
    apiCartStockExceeded: string;

    // Product page
    productStockWarning: string;
    apiShopNotFound: string;
    apiStripeConnectError: string;
    apiStripeDashboardUnavailable: string;

    // Seller Onboarding
    sellerOnboardingTitle: string;
    sellerOnboardingStep1Title: string;
    sellerOnboardingStep2Title: string;
    sellerOnboardingStep3Title: string;
    sellerOnboardingStep2Subtitle: string;
    sellerOnboardingStep3Subtitle: string;
    sellerOnboardingShopNameLabel: string;
    sellerOnboardingShopNamePlaceholder: string;
    sellerOnboardingShopSlugLabel: string;
    sellerOnboardingShopSlugPlaceholder: string;
    sellerOnboardingShopSlugNote: string;
    sellerOnboardingDescriptionLabel: string;
    sellerOnboardingDescriptionPlaceholder: string;
    sellerOnboardingAccentColorLabel: string;
    sellerOnboardingContactEmailLabel: string;
    sellerOnboardingContactEmailPlaceholder: string;
    sellerOnboardingWhatsappLabel: string;
    sellerOnboardingWhatsappPlaceholder: string;
    sellerOnboardingLocationLabel: string;
    sellerOnboardingLocationPlaceholder: string;
    sellerOnboardingNext: string;
    sellerOnboardingPrev: string;
    sellerOnboardingCreate: string;
    sellerOnboardingCreating: string;
    sellerOnboardingUrlInUse: string;
    sellerOnboardingGenericError: string;
    sellerOnboardingStep4Title: string;
    sellerOnboardingStep4Subtitle: string;
    sellerOnboardingStep4Description: string;
    sellerOnboardingStripeConnectCta: string;
    sellerOnboardingStripeConnecting: string;
    sellerOnboardingStripeError: string;
    sellerOnboardingStripeStatusReady: string;
    sellerOnboardingStripeStatusPending: string;
    sellerOnboardingSkipStripe: string;

    // Seller Shop Images
    sellerShopBannerLabel: string;
    sellerShopBannerChange: string;
    sellerShopBannerRemove: string;
    sellerShopBannerHint: string;
    sellerShopProfileImgLabel: string;
    sellerShopProfileImgHint: string;
    sellerShopProfileImgUpload: string;
    sellerShopProfileImgChange: string;
    sellerShopImageUploading: string;
    sellerShopImageRemove: string;
    sellerShopImageSaved: string;

    // Seller Shop Edit
    sellerShopEditTitle: string;
    sellerShopEditViewPublic: string;
    sellerShopEditSave: string;
    sellerShopEditSaving: string;
    sellerShopEditSuccess: string;
    sellerShopEditError: string;
    sellerStripeSectionTitle: string;
    sellerStripeSectionSubtitle: string;
    sellerStripeStatusReady: string;
    sellerStripeStatusPending: string;
    sellerStripeStatusNotConnected: string;
    sellerStripeConnectCta: string;
    sellerStripeContinueCta: string;
    sellerStripeDashboardCta: string;
    sellerStripeConnecting: string;
    sellerStripeError: string;
    sellerStripeReturnReady: string;
    sellerStripeReturnPending: string;
    sellerStripeWarningBanner: string;
    sellerStripeWarningCta: string;
    sellerDetailsWarningBanner: string;
    sellerDetailsWarningCta: string;
    sellerDetailsPageTitle: string;
    sellerDetailsHeading: string;
    sellerDetailsSubtitle: string;
    sellerDetailsIncompleteNoticeTitle: string;
    sellerDetailsIncompleteNoticeSubtitle: string;
    sellerDashboardStripeReady: string;
    sellerDashboardStripePendingTitle: string;
    sellerDashboardStripePendingSubtitle: string;
    sellerDashboardStripeCta: string;
    sellerOrdersPageTitle: string;
    sellerOrdersHeading: string;
    sellerOrdersIntro: string;
    sellerOrdersEmpty: string;
    sellerOrdersEmptySub: string;
    sellerOrdersSummarySales: string;
    sellerOrdersSummaryOrders: string;
    sellerOrdersSummaryItems: string;
    sellerOrdersProductsLabel: string;
    sellerOrdersCustomerLabel: string;
    sellerOrdersSubtotalLabel: string;
    sellerOrdersItemsSoldLabel: string;

    // Seller Catalog
    sellerCatalogPageTitle: string;
    sellerCatalogTitle: string;
    sellerCatalogNewProduct: string;
    sellerCatalogSearchPlaceholder: string;
    sellerCatalogTotalProducts: string;
    sellerCatalogActiveProducts: string;
    sellerCatalogEmptyTitle: string;
    sellerCatalogEmptySubtitle: string;
    sellerCatalogViewPublic: string;
    sellerCatalogEdit: string;
    sellerCatalogDelete: string;
    sellerCatalogConfirmDelete: string;
    sellerCatalogActive: string;
    sellerCatalogInactive: string;
    sellerCatalogToggleActive: string;
    sellerCatalogVariants: string;
    sellerCatalogVariant: string;
    sellerCatalogPriceFrom: string;
    sellerCatalogStock: string;
    sellerCatalogNoImage: string;

    // Seller Product Form
    sellerProductNewTitle: string;
    sellerProductEditTitle: string;
    sellerProductBackToCatalog: string;
    sellerProductBasicInfo: string;
    sellerProductTitleLabel: string;
    sellerProductTitlePlaceholder: string;
    sellerProductSlugLabel: string;
    sellerProductSlugPlaceholder: string;
    sellerProductSlugNote: string;
    sellerProductDescriptionLabel: string;
    sellerProductDescriptionPlaceholder: string;
    sellerProductCategoryLabel: string;
    sellerProductCategoryPlaceholder: string;
    sellerProductBrandLabel: string;
    sellerProductBrandPlaceholder: string;
    sellerProductImagesLabel: string;
    sellerProductImagesHint: string;
    sellerProductImagesDragDrop: string;
    sellerProductImageUploading: string;
    sellerProductImageRemove: string;
    sellerProductVariantsLabel: string;
    sellerProductVariantsHint: string;
    sellerProductVariantNameLabel: string;
    sellerProductVariantNamePlaceholder: string;
    sellerProductVariantPriceLabel: string;
    sellerProductVariantPricePlaceholder: string;
    sellerProductVariantStockLabel: string;
    sellerProductVariantStockPlaceholder: string;
    sellerProductVariantDefault: string;
    sellerProductVariantDefaultNote: string;
    sellerProductVariantImage: string;
    sellerProductVariantRemove: string;
    sellerProductAddVariant: string;
    sellerProductVariantWeightLabel: string;
    sellerProductVariantWeightPlaceholder: string;
    sellerProductVariantLengthLabel: string;
    sellerProductVariantLengthPlaceholder: string;
    sellerProductVariantWidthLabel: string;
    sellerProductVariantWidthPlaceholder: string;
    sellerProductVariantHeightLabel: string;
    sellerProductVariantHeightPlaceholder: string;
    sellerProductVariantShippingLabel: string;
    sellerProductVariantShippingPlaceholder: string;
    sellerProductVariantShippingTitle: string;
    sellerProductVariantUseDefaults: string;
    sellerProductVariantApplyToRest: string;
    sellerProductShippingDefaultsHint: string;
    sellerProductSpecsLabel: string;
    sellerProductSpecsHint: string;
    sellerProductSpecsKeyPlaceholder: string;
    sellerProductSpecsValuePlaceholder: string;
    sellerProductAddSpec: string;
    sellerProductActiveLabel: string;
    sellerProductActiveNote: string;
    sellerProductSave: string;
    sellerProductSaving: string;
    sellerProductSaveError: string;
    sellerProductSaveSuccess: string;
    sellerProductDeleteSuccess: string;
    sellerProductDeleteError: string;
    sellerProductDeleteHasOrders: string;
    sellerProductTitleRequired: string;
    sellerProductCategoryRequired: string;
    sellerProductVariantPriceRequired: string;
    sellerProductNoVariantsError: string;
    sellerProductSlugInUse: string;
    sellerProductIncompleteError: string;
    sellerProductMissingName: string;
    sellerProductMissingDescription: string;
    sellerProductMissingCategory: string;
    sellerProductMissingSlug: string;
    sellerProductMissingPhotos: string;
    sellerProductMissingVariants: string;
    sellerProductMissingVariantData: string;
    sellerProductPricingPriceBelowMin: string;
    sellerProductPricingShippingExceedsLabel: string;
    sellerProductPricingMarginTooLow: string;
    sellerProductPricingLabelUnavailable: string;
    sellerProductPricingVariantFallbackName: string;
    sellerCatalogIncompleteWarning: string;
    sellerCatalogIncompleteTooltip: string;

    // Seller Product Form — redesigned sections
    sellerProductSectionBasicTitle: string;
    sellerProductSectionBasicSubtitle: string;
    sellerProductSectionImagesTitle: string;
    sellerProductSectionImagesSubtitle: string;
    sellerProductSectionVariantsTitle: string;
    sellerProductSectionVariantsSubtitle: string;
    sellerProductSectionSpecsTitle: string;
    sellerProductSectionSpecsSubtitle: string;
    sellerProductSectionStatusTitle: string;
    sellerProductSectionStatusSubtitle: string;
    sellerProductVariantPricing: string;
    sellerProductVariantSizeWeight: string;
    sellerProductVariantSizeWeightHint: string;
    sellerProductVariantBaseShipping: string;
    sellerProductVariantBaseShippingHint: string;
    sellerProductVariantFreeShipping: string;
    sellerProductVariantFreeShippingActive: string;
    sellerProductVariantCollapse: string;
    sellerProductVariantExpand: string;
    sellerProductVariantQuickFill: string;
    sellerProductShippingLiveTitle: string;
    sellerProductShippingLiveSubtitle: string;
    sellerProductShippingLiveAwaiting: string;
    sellerProductShippingLiveBillable: string;
    sellerProductShippingLiveLoading: string;
    sellerProductShippingLiveError: string;
    sellerProductShippingLiveUnavailable: string;
    sellerProductFormDraftBadge: string;
    sellerProductFormLiveBadge: string;
    sellerProductFormReadyBadge: string;
    sellerProductFormIncompleteBadge: string;
    sellerProductFormSaveAndExit: string;
    sellerProductFormProgress: string;
    sellerProductSpecsEmpty: string;
    sellerProductVariantsCount: string;
    sellerProductVariantsCountSingle: string;
    sellerProductVariantPlaceholderName: string;

    // Seller Product Form — header summary + variants accordion + advanced options
    sellerProductHeaderSummaryReady: string;
    sellerProductHeaderSummaryPendingSingle: string;
    sellerProductHeaderSummaryPendingPlural: string;
    sellerProductAdvancedSection: string;
    sellerProductAdvancedHint: string;
    sellerProductVariantSummaryMissing: string;
    sellerProductVariantSummaryShipping: string;
    sellerProductVariantSummaryFree: string;
    sellerProductVariantSummaryStock: string;
    sellerProductShippingEstimateLine: string;
    sellerProductShippingEstimateLineSimple: string;
    sellerProductShippingEstimateNone: string;
    sellerProductShippingDesde: string;
    sellerProductShippingVatIncluded: string;
    sellerProductShippingShowQuotes: string;
    sellerProductShippingHideQuotes: string;
    sellerProductActiveInline: string;

    // Seller Product Form — centralized shipping + per-variant modal
    sellerProductCentralShippingTitle: string;
    sellerProductCentralShippingSubtitle: string;
    sellerProductCentralUseDefaults: string;
    sellerProductShippingNoDefaultsTitle: string;
    sellerProductShippingNoDefaultsBody: string;
    sellerProductShippingGoToSettings: string;
    sellerProductVariantCustomizeShipping: string;
    sellerProductVariantEditShipping: string;
    sellerProductVariantUsesCommonShipping: string;
    sellerProductVariantUsesCustomShipping: string;
    sellerProductVariantResetShipping: string;
    sellerProductShippingModalTitle: string;
    sellerProductShippingModalFor: string;
    sellerProductShippingModalCancel: string;
    sellerProductShippingModalApply: string;
    sellerProductShippingModalReset: string;
    sellerProductShippingModalClose: string;

    // Loading / feedback genericos
    toastSuccessGeneric: string;
    toastErrorGeneric: string;
    toastErrorNetwork: string;
    toastDismiss: string;
    loadingProducts: string;
    loadingOrders: string;
    loadingShop: string;
    loadingGeneric: string;
    imageLoadFailed: string;
    spinnerLabel: string;
    progressBarLabel: string;

    // Toasts especificos
    cartAddedToast: string;
    cartStockExceededToast: string;
    wishlistAddedToast: string;
    wishlistRemovedToast: string;
    orderConfirmedToast: string;
    incidentReportedToast: string;
    labelGeneratedToast: string;
    productSavedToast: string;
    shopSavedToast: string;
    settingsSavedToast: string;
    profileSavedToast: string;
    languageSavedToast: string;

    // Seller Landing (/sell)
    sellerLandingMetaTitle: string;
    sellerLandingMetaDescription: string;
    sellerLandingBadge: string;
    sellerLandingHeroTitle: string;
    sellerLandingHeroSubtitle: string;
    sellerLandingHeroReassurance: string;
    sellerLandingCtaLogin: string;
    sellerLandingCtaSetup: string;

    // Hero storefront preview (decorative)
    sellerLandingPreviewBrand: string;
    sellerLandingPreviewUrl: string;
    sellerLandingPreviewProduct1: string;
    sellerLandingPreviewProduct2: string;
    sellerLandingPreviewInStock: string;

    // Section: keep 100%
    sellerLandingMoneyKicker: string;
    sellerLandingMoneyAmount: string;
    sellerLandingMoneyTitle: string;
    sellerLandingMoneyBody: string;

    // Section: your brand
    sellerLandingBrandKicker: string;
    sellerLandingBrandTitle: string;
    sellerLandingBrandBody: string;
    sellerLandingBrandLogoTitle: string;
    sellerLandingBrandLogoBody: string;
    sellerLandingBrandBannerTitle: string;
    sellerLandingBrandBannerBody: string;
    sellerLandingBrandUrlTitle: string;
    sellerLandingBrandUrlBody: string;
    sellerLandingBrandColorTitle: string;
    sellerLandingBrandColorBody: string;
    sellerLandingBrandSpecsTitle: string;
    sellerLandingBrandSpecsBody: string;

    // Section: selling without hassle
    sellerLandingEaseKicker: string;
    sellerLandingEaseTitle: string;
    sellerLandingEaseBody: string;
    sellerLandingEaseVariantsTitle: string;
    sellerLandingEaseVariantsBody: string;
    sellerLandingEaseShippingTitle: string;
    sellerLandingEaseShippingBody: string;
    sellerLandingEaseInfoTitle: string;
    sellerLandingEaseInfoBody: string;
    sellerLandingEaseClaimsTitle: string;
    sellerLandingEaseClaimsBody: string;

    // Section: how it works
    sellerLandingStepsKicker: string;
    sellerLandingStepsTitle: string;
    sellerLandingStep1Title: string;
    sellerLandingStep1Body: string;
    sellerLandingStep2Title: string;
    sellerLandingStep2Body: string;
    sellerLandingStep3Title: string;
    sellerLandingStep3Body: string;

    // Final CTA
    sellerLandingFinalTitle: string;
    sellerLandingFinalBody: string;

    // Categories
    categoryRopa: string;
    categoryAccesorios: string;
    categoryHogar: string;
    categoryTecnologia: string;
    categoryDeportes: string;
    categoryBelleza: string;
    categoryAlimentos: string;
    categoryJuguetes: string;
    categoryLibros: string;
    categoryArtesania: string;
    categoryOtros: string;

    // ── Notifications ───────────────────────────────────────────
    notifPromptTitle: string;
    notifPromptBody: string;
    notifPromptEnable: string;
    notifPromptDismiss: string;
    notifSettingsSection: string;
    notifSettingsTitle: string;
    notifSettingsHelp: string;
    notifSettingsEnable: string;
    notifSettingsDisable: string;
    notifSettingsEnabled: string;
    notifSettingsUnsupported: string;
    notifSettingsBlocked: string;
    notifToastEnabled: string;
    notifToastDisabled: string;
    notifToastError: string;

    emailFooter: string;
    emailViewOrderCta: string;

    notifBuyerReadyToSendPushTitle: string;
    notifBuyerReadyToSendPushBody: string;
    notifBuyerReadyToSendSubject: string;
    notifBuyerReadyToSendHeading: string;
    notifBuyerReadyToSendText: string;
    notifTrackCta: string;

    notifBuyerPickupReadyPushTitle: string;
    notifBuyerPickupReadyPushBody: string;
    notifBuyerPickupReadySubject: string;
    notifBuyerPickupReadyHeading: string;
    notifBuyerPickupReadyText: string;

    notifBuyerPickupReminderPushTitle: string;
    notifBuyerPickupReminderPushBody: string;
    notifBuyerPickupReminderSubject: string;
    notifBuyerPickupReminderHeading: string;
    notifBuyerPickupReminderText: string;

    notifBuyerOutForDeliveryPushTitle: string;
    notifBuyerOutForDeliveryPushBody: string;
    notifBuyerOutForDeliverySubject: string;
    notifBuyerOutForDeliveryHeading: string;
    notifBuyerOutForDeliveryText: string;

    notifSellerNewSalePushTitle: string;
    notifSellerNewSalePushBody: string;
    notifSellerNewSaleSubject: string;
    notifSellerNewSaleHeading: string;
    notifSellerNewSaleText: string;
    notifManageOrderCta: string;

    notifSellerLabelReminderPushTitle: string;
    notifSellerLabelReminderPushBody: string;
    notifSellerLabelReminderSubject: string;
    notifSellerLabelReminderHeading: string;
    notifSellerLabelReminderText: string;

    notifSellerShipReminderPushTitle: string;
    notifSellerShipReminderPushBody: string;
    notifSellerShipReminderSubject: string;
    notifSellerShipReminderHeading: string;
    notifSellerShipReminderText: string;
}
