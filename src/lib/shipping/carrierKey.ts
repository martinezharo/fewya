export type CarrierKey = 'inpost' | 'correos_home' | 'correos_pickup';

export const CARRIER_META: Record<CarrierKey, { label: string; sublabel: string }> = {
    inpost: { label: 'InPost Locker', sublabel: 'Punto de recogida 24/7' },
    correos_home: { label: 'Correos a domicilio', sublabel: 'Entrega en el domicilio' },
    correos_pickup: { label: 'Correos en oficina', sublabel: 'Recogida en oficina' },
};

export function categorize(
    carrierCode: string,
    serviceName: string,
    servicePointInput?: string,
): CarrierKey | null {
    const code = (carrierCode || '').toLowerCase();
    const name = (serviceName || '').toLowerCase();
    const pickupRequired = (servicePointInput || '').toLowerCase() === 'required';

    if (code.includes('inpost')) return 'inpost';

    if (code.includes('correos')) {
        if (
            pickupRequired ||
            name.includes('oficina') ||
            name.includes('office') ||
            name.includes('shop') ||
            name.includes('drop') ||
            name.includes('pickup') ||
            name.includes('recogida')
        ) {
            return 'correos_pickup';
        }
        return 'correos_home';
    }
    return null;
}
