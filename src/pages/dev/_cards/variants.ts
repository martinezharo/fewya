export interface CardVariant {
    key: string;
    name: string;
    note: string;
}

/** The designs on show in /dev/catalog-cards, in comparison order. */
export const CARD_VARIANTS: CardVariant[] = [
    {
        key: 'current',
        name: 'Actual (la de la PR)',
        note: 'Foto, título a 2 líneas, precio + stock, pill de estado y menú. Cinco cosas por tarjeta: es la que se ve cargada.',
    },
    {
        key: 'a',
        name: 'A · Galería',
        note: 'Sin marco: mandan las fotos. Debajo solo nombre y precio. El estado se lee en la foto (pausado = atenuada) y solo aparece chip si algo va mal.',
    },
    {
        key: 'b',
        name: 'B · Ficha',
        note: 'Mantiene la tarjeta, pero el cuerpo son dos líneas exactas: nombre y una sola línea de meta (precio · stock). El estado es un punto en la foto.',
    },
    {
        key: 'c',
        name: 'C · Overlay',
        note: 'La tarjeta es la foto: nombre y precio sobre un degradado. Todas las celdas son cuadradas, así que la rejilla queda perfecta.',
    },
];
