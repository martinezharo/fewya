import { describe, it, expect } from 'vitest';
import {
    workingDaysBetween,
    workingDaysSince,
    calendarDaysSince,
} from '../../src/lib/notifications/workingDays';

describe('workingDaysBetween', () => {
    it('cuenta días laborables de lunes a viernes', () => {
        // 2024-06-03 (lun) → 2024-06-07 (vie) = 4 días laborables transcurridos
        const mon = new Date('2024-06-03T09:00:00Z');
        const fri = new Date('2024-06-07T09:00:00Z');
        expect(workingDaysBetween(mon, fri)).toBe(4);
    });

    it('excluye fines de semana', () => {
        // viernes → lunes siguiente = solo 1 día laborable (el lunes)
        const fri = new Date('2024-06-07T09:00:00Z');
        const mon = new Date('2024-06-10T09:00:00Z');
        expect(workingDaysBetween(fri, mon)).toBe(1);
    });

    it('un fin de semana completo cuenta 0 días laborables', () => {
        const sat = new Date('2024-06-08T09:00:00Z');
        const sun = new Date('2024-06-09T20:00:00Z');
        expect(workingDaysBetween(sat, sun)).toBe(0);
    });

    it('devuelve 0 si "to" es anterior o igual a "from"', () => {
        const a = new Date('2024-06-07T09:00:00Z');
        expect(workingDaysBetween(a, a)).toBe(0);
        expect(workingDaysBetween(a, new Date('2024-06-06T09:00:00Z'))).toBe(0);
    });

    it('cuenta 3 días laborables cruzando un fin de semana', () => {
        // jueves → martes siguiente: vie, lun, mar = 3 laborables (sáb/dom excluidos)
        const thu = new Date('2024-06-06T09:00:00Z');
        const tue = new Date('2024-06-11T09:00:00Z');
        expect(workingDaysBetween(thu, tue)).toBe(3);
    });
});

describe('workingDaysSince', () => {
    it('mide días laborables desde una fecha hasta "now"', () => {
        const from = '2024-06-03T09:00:00Z'; // lunes
        const now = new Date('2024-06-07T09:00:00Z'); // viernes
        expect(workingDaysSince(from, now)).toBe(4);
    });
});

describe('calendarDaysSince', () => {
    it('cuenta días naturales completos', () => {
        const from = '2024-06-01T09:00:00Z';
        const now = new Date('2024-06-04T10:00:00Z');
        expect(calendarDaysSince(from, now)).toBe(3);
    });

    it('incluye fines de semana en el conteo natural', () => {
        const from = '2024-06-07T09:00:00Z'; // viernes
        const now = new Date('2024-06-10T09:00:00Z'); // lunes
        expect(calendarDaysSince(from, now)).toBe(3);
    });
});
