/**
 * Optimizes external image URLs for smaller download size.
 * Adjusts query params for known image hosts without breaking functionality.
 */
export function optimizeImageUrl(url: string, width = 400): string {
    if (!url) return url;

    try {
        const parsed = new URL(url);

        // Unsplash: request exact width and quality
        if (parsed.hostname === 'images.unsplash.com') {
            parsed.searchParams.set('w', String(width));
            parsed.searchParams.set('q', '80');
            parsed.searchParams.set('fit', 'crop');
            parsed.searchParams.set('auto', 'format');
            return parsed.toString();
        }

        // Amazon: replace large dimensions with target size
        if (parsed.hostname === 'm.media-amazon.com') {
            return url.replace(/_AC_UF\d+,\d+_QL\d+_/, `_AC_UF${width},${width}_QL80_`);
        }

        // Supabase Storage: append width param if image-transform is enabled
        if (parsed.hostname.includes('.supabase.co') && parsed.pathname.includes('/storage/v1/object/public/')) {
            parsed.searchParams.set('width', String(width));
            return parsed.toString();
        }

        // Google Cloud Storage / Carrefour (no resize available, leave as-is)
        return url;
    } catch {
        return url;
    }
}
