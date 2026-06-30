import type { Strings } from './types';

export type CategoryValue = 'ropa' | 'accesorios' | 'hogar' | 'tecnologia' | 'deportes' | 'belleza' | 'alimentos' | 'juguetes' | 'libros' | 'artesania' | 'otros';

const CATEGORY_VALUES: readonly CategoryValue[] = [
    'ropa',
    'accesorios',
    'hogar',
    'tecnologia',
    'deportes',
    'belleza',
    'alimentos',
    'juguetes',
    'libros',
    'artesania',
    'otros',
];

export interface CategoryOption {
    value: CategoryValue;
    label: string;
}

const CATEGORY_LABELS: Record<CategoryValue, keyof Strings> = {
    ropa: 'categoryRopa',
    accesorios: 'categoryAccesorios',
    hogar: 'categoryHogar',
    tecnologia: 'categoryTecnologia',
    deportes: 'categoryDeportes',
    belleza: 'categoryBelleza',
    alimentos: 'categoryAlimentos',
    juguetes: 'categoryJuguetes',
    libros: 'categoryLibros',
    artesania: 'categoryArtesania',
    otros: 'categoryOtros',
};

export function getCategories(t: Strings): readonly CategoryOption[] {
    return CATEGORY_VALUES.map(value => ({
        value,
        label: t[CATEGORY_LABELS[value]],
    }));
}

export function getCategoryLabel(t: Strings, value: string | null | undefined): string {
    if (!value) return value ?? '';
    return getCategories(t).find(c => c.value === value)?.label ?? value;
}
