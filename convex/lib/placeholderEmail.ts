/**
 * The stand-in address stored for an identity that arrives without an email.
 *
 * `profiles.email` is a required column inherited from the Supabase schema, so
 * a profile has to hold *something* even when the identity provider sends no
 * address. What it must never hold is something indistinguishable from a real
 * inbox: a synthetic address that looks real is sent order notifications that
 * hard-bounce, is handed to Stripe as the receipt address, is passed to the
 * carrier as the recipient, and is shown to the seller as the customer's
 * contact — all silently.
 *
 * So the stand-in is minted in one place and recognized in one place. Every
 * boundary that would use the address for something real reads it through
 * `realEmail`, which answers `null` for a placeholder; callers already handle
 * "this buyer has no email" and skip the send.
 *
 * `.invalid` is reserved by RFC 2606 precisely so it can never resolve.
 *
 * Kept free of Convex imports so the Worker can import it too, and so the rule
 * can be unit tested without a Convex runtime.
 */

const PLACEHOLDER_PREFIX = 'clerk-';
const PLACEHOLDER_DOMAIN = '@invalid.local';

/** The address stored for an identity whose provider sent no email claim. */
export function placeholderEmail(subject: string): string {
    return `${PLACEHOLDER_PREFIX}${subject}${PLACEHOLDER_DOMAIN}`;
}

/**
 * Whether a stored address is a stand-in rather than something a person reads.
 *
 * The domain alone decides it: the imported Supabase rows used a different
 * prefix for the same purpose, and both are equally undeliverable.
 */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
    return typeof email === 'string' && email.trim().toLowerCase().endsWith(PLACEHOLDER_DOMAIN);
}

/**
 * The address if it can actually receive mail, `null` otherwise.
 *
 * Use this at every boundary that sends, charges, ships or displays. Storage
 * and account lookup keep using the raw column.
 */
export function realEmail(email: string | null | undefined): string | null {
    if (!email || isPlaceholderEmail(email)) return null;
    const trimmed = email.trim();
    return trimmed.length > 0 ? trimmed : null;
}
