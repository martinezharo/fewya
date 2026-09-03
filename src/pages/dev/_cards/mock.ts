/**
 * Fixtures for the /dev card playground. Images are inline SVG data URIs on
 * purpose: they need no network, survive the app's CSP (`img-src … data:`),
 * and one of them is deliberately landscape so a design that crops badly is
 * obvious at a glance.
 */

function svg(markup: string): string {
    return `data:image/svg+xml;utf8,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600">${markup}</svg>`,
    )}`;
}

const wideRemote = svg(`
  <rect width="1200" height="600" fill="#e5e7eb"/>
  <g fill="#94a3b8" font-family="sans-serif" font-size="40">
    <text x="40" y="90">OCTOPUS CONTROL</text><text x="40" y="330">OCTOPUS CONTROL</text><text x="40" y="560">OCTOPUS CONTROL</text>
    <text x="760" y="90">OCTOPUS</text><text x="760" y="330">OCTOPUS</text><text x="760" y="560">OCTOPUS</text>
  </g>
  <rect x="520" y="20" width="160" height="560" rx="46" fill="#1f2937"/>
  <circle cx="600" cy="130" r="26" fill="#4b5563"/><circle cx="600" cy="240" r="26" fill="#4b5563"/><circle cx="600" cy="350" r="26" fill="#4b5563"/>`);

const wideChromecast = svg(`
  <rect width="1200" height="600" fill="#cbd5e1"/>
  <rect x="500" y="20" width="200" height="560" rx="52" fill="#f8fafc"/>
  <circle cx="556" cy="120" r="34" fill="#e2e8f0"/><circle cx="646" cy="120" r="34" fill="#334155"/>
  <circle cx="556" cy="240" r="34" fill="#e2e8f0"/><circle cx="646" cy="240" r="34" fill="#e2e8f0"/>
  <g fill="#94a3b8" font-family="sans-serif" font-size="38">
    <text x="30" y="100">OPUS</text><text x="30" y="340">TROL</text><text x="800" y="100">US</text><text x="800" y="340">OL</text>
  </g>`);

export interface MockProduct {
    id: string;
    title: string;
    image: string;
    price: number;
    priceFrom?: boolean;
    stock: number;
    isActive: boolean;
    isComplete: boolean;
    category: string;
    variants: number;
}

export const mockProducts: MockProduct[] = [
    {
        id: '1',
        title: 'Mando Samsung BN59-01259B',
        image: wideRemote,
        price: 2.99,
        stock: 5,
        isActive: true,
        isComplete: true,
        category: 'Tecnología',
        variants: 1,
    },
    {
        id: '2',
        title: 'Mando Chromecast con Google TV',
        image: wideChromecast,
        price: 4.75,
        stock: 10,
        isActive: false,
        isComplete: true,
        category: 'Tecnología',
        variants: 1,
    },
    {
        id: '3',
        title: 'Mando Samsung BN59-01358D con teclado QWERTY retroiluminado',
        image: wideRemote,
        price: 3.5,
        priceFrom: true,
        stock: 0,
        isActive: true,
        isComplete: false,
        category: 'Tecnología',
        variants: 2,
    },
    {
        id: '4',
        title: 'Altavoz Bluetooth',
        image: '',
        price: 19.9,
        stock: 3,
        isActive: true,
        isComplete: true,
        category: 'Audio',
        variants: 1,
    },
];

const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });

export function price(product: MockProduct): string {
    return product.priceFrom ? `Desde ${eur.format(product.price)}` : eur.format(product.price);
}
