/**
 * Normalizers for JSON request bodies.
 *
 * Every optional text field a form owns has three states, and the three must
 * stay distinguishable all the way to Convex: the key is absent when the field
 * was not part of the request, `null` when the user cleared it, and a string
 * otherwise. Routes used to inline that distinction per field and assumed the
 * value was a string, so a cleared field crashed on `null.trim()` and surfaced
 * as an opaque 500.
 *
 * These throw `InvalidFieldError` instead of returning a sentinel so a route
 * can normalize a whole payload in one `try` and answer 400 once.
 */

/** A body field that is missing, of the wrong type, or empty where required. */
export class InvalidFieldError extends Error {
    constructor(readonly field: string) {
        super(`invalid_${field}`);
        this.name = 'InvalidFieldError';
    }
}

/**
 * Absent stays absent, a cleared or blank value becomes `null`, and anything
 * else must be a string, which is trimmed.
 *
 * `maxLength` caps what the field may store. Anything a caller can write to
 * the database should carry one: an unbounded field is a way to fill the
 * deployment from an ordinary authenticated session.
 */
export function optionalText(field: string, value: unknown, maxLength?: number): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== 'string') throw new InvalidFieldError(field);
    const trimmed = value.trim();
    if (maxLength !== undefined && trimmed.length > maxLength) throw new InvalidFieldError(field);
    return trimmed || null;
}

/** A field that must be present and carry a non-blank string. */
export function requiredText(field: string, value: unknown, maxLength?: number): string {
    const trimmed = optionalText(field, value, maxLength);
    if (!trimmed) throw new InvalidFieldError(field);
    return trimmed;
}

/**
 * A number that is safe to store.
 *
 * Only a number or a numeric string is accepted: `Number()` happily turns
 * `true` into 1 and `[]` into 0, which would quietly become a variant's price.
 * NaN and Infinity pass both `typeof x === 'number'` and Convex's `v.number()`,
 * so they are rejected explicitly rather than written to the database.
 */
export function optionalNumber(field: string, value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'number' && typeof value !== 'string') throw new InvalidFieldError(field);
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) throw new InvalidFieldError(field);
    return parsed;
}

/** A number that must be present and finite. */
export function requiredNumber(field: string, value: unknown): number {
    const parsed = optionalNumber(field, value);
    if (parsed === null) throw new InvalidFieldError(field);
    return parsed;
}

/**
 * A JSON object — a request body, or one entry of it.
 *
 * `typeof [] === 'object'`, so an array slips through the obvious check and
 * arrives as a body whose every named field reads `undefined`. That looks like
 * "nothing to change" rather than the malformed request it is.
 */
export function requireObject(field: string, value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new InvalidFieldError(field);
    }
    return value as Record<string, unknown>;
}

/** An array of strings, or `undefined` when the key is absent. */
export function optionalStringArray(field: string, value: unknown): string[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
        throw new InvalidFieldError(field);
    }
    return value as string[];
}
