/**
 * Working-day helpers for reminders.
 *
 * "Working days" here means Monday–Friday only. We deliberately do NOT account
 * for public holidays (no Spanish holiday calendar is wired in); reminders are
 * day-scale nudges where being off by a holiday is acceptable. "Regular days"
 * (calendar days) are computed with plain Date math by the caller.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isWeekend(date: Date): boolean {
    const day = date.getUTCDay(); // 0 = Sunday, 6 = Saturday
    return day === 0 || day === 6;
}

/**
 * Counts full working days (Mon–Fri) elapsed between `from` and `to`.
 * Iterates day boundaries from the day AFTER `from`; a day counts if it is a
 * weekday and its end is at/before `to`.
 */
export function workingDaysBetween(from: Date, to: Date): number {
    if (to <= from) return 0;

    let count = 0;
    // Start counting from the next midnight (UTC) after `from`.
    const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    cursor.setUTCDate(cursor.getUTCDate() + 1);

    while (cursor.getTime() <= to.getTime()) {
        if (!isWeekend(cursor)) count += 1;
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return count;
}

/** Working days (Mon–Fri) elapsed since `from` until now. */
export function workingDaysSince(from: Date | string, now: Date = new Date()): number {
    const fromDate = typeof from === 'string' ? new Date(from) : from;
    return workingDaysBetween(fromDate, now);
}

/** Calendar days elapsed since `from` until now. */
export function calendarDaysSince(from: Date | string, now: Date = new Date()): number {
    const fromDate = typeof from === 'string' ? new Date(from) : from;
    return Math.floor((now.getTime() - fromDate.getTime()) / MS_PER_DAY);
}
