import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

interface LabelData {
    orderPublicId: string;
    senderName: string;
    senderAddress: string;
    senderCity: string;
    senderPostalCode: string;
    senderCountry: string;
    senderPhone?: string;
    recipientName: string;
    recipientAddress: string;
    recipientCity: string;
    recipientPostalCode: string;
    recipientCountry: string;
    recipientPhone?: string;
    carrierName: string;
    serviceName: string;
    trackingNumber: string;
    isPickupPoint: boolean;
    pickupPointName?: string;
}

function drawWrappedText(
    page: any,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    font: any,
    size: number,
    color = rgb(0, 0, 0)
): number {
    const words = text.split(' ');
    let line = '';
    let currentY = y;

    for (let i = 0; i < words.length; i++) {
        const testLine = line + words[i] + ' ';
        const width = font.widthOfTextAtSize(testLine, size);
        if (width > maxWidth && line.length > 0) {
            page.drawText(line.trim(), { x, y: currentY, size, font, color });
            line = words[i] + ' ';
            currentY -= size + 2;
        } else {
            line = testLine;
        }
    }
    if (line.trim()) {
        page.drawText(line.trim(), { x, y: currentY, size, font, color });
        currentY -= size + 2;
    }
    return currentY;
}

function drawBarcode(page: any, x: number, y: number, width: number, height: number): void {
    let currentX = x;
    const endX = x + width;

    // Seed-like deterministic pattern from tracking number would be nice, but random is fine for mock
    while (currentX < endX) {
        const barWidth = Math.random() > 0.7 ? 3 : Math.random() > 0.5 ? 2 : 1;
        const gap = Math.random() > 0.6 ? 2 : 1;
        if (currentX + barWidth > endX) break;

        page.drawRectangle({
            x: currentX,
            y,
            width: barWidth,
            height,
            color: rgb(0, 0, 0),
        });
        currentX += barWidth + gap;
    }
}

export async function generateMockShippingLabel(data: LabelData): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const width = 288; // 4 inches
    const height = 432; // 6 inches
    const page = doc.addPage([width, height]);

    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

    const margin = 14;
    let y = height - margin;

    // Header banner
    page.drawRectangle({
        x: 0,
        y: height - 40,
        width,
        height: 40,
        color: rgb(0.95, 0.2, 0.2),
    });
    page.drawText('ETIQUETA DE PRUEBA', {
        x: margin,
        y: height - 26,
        size: 14,
        font: fontBold,
        color: rgb(1, 1, 1),
    });
    page.drawText('NO VALIDA PARA ENVIO', {
        x: margin,
        y: height - 38,
        size: 9,
        font,
        color: rgb(1, 0.9, 0.9),
    });

    y = height - 52;

    // Carrier & Service
    page.drawText(data.carrierName.toUpperCase(), {
        x: margin,
        y,
        size: 16,
        font: fontBold,
        color: rgb(0, 0, 0),
    });
    y -= 16;
    page.drawText(data.serviceName, {
        x: margin,
        y,
        size: 10,
        font,
        color: rgb(0.3, 0.3, 0.3),
    });
    y -= 18;

    // Divider
    page.drawLine({
        start: { x: margin, y },
        end: { x: width - margin, y },
        thickness: 0.5,
        color: rgb(0.7, 0.7, 0.7),
    });
    y -= 12;

    // Recipient block
    page.drawText(data.isPickupPoint ? 'PUNTO DE RECOGIDA' : 'DESTINATARIO', {
        x: margin,
        y,
        size: 8,
        font: fontBold,
        color: rgb(0.5, 0.5, 0.5),
    });
    y -= 12;

    if (data.isPickupPoint && data.pickupPointName) {
        page.drawText(data.pickupPointName, {
            x: margin,
            y,
            size: 11,
            font: fontBold,
            color: rgb(0, 0, 0),
        });
        y -= 14;
    }

    page.drawText(data.recipientName, {
        x: margin,
        y,
        size: 11,
        font: fontBold,
        color: rgb(0, 0, 0),
    });
    y -= 14;

    y = drawWrappedText(page, data.recipientAddress, margin, y, width - margin * 2, font, 10);
    y -= 2;
    page.drawText(`${data.recipientPostalCode} ${data.recipientCity}`, {
        x: margin,
        y,
        size: 10,
        font,
        color: rgb(0, 0, 0),
    });
    y -= 14;
    page.drawText(data.recipientCountry, {
        x: margin,
        y,
        size: 10,
        font,
        color: rgb(0, 0, 0),
    });
    if (data.recipientPhone) {
        y -= 14;
        page.drawText(data.recipientPhone, {
            x: margin,
            y,
            size: 9,
            font,
            color: rgb(0.4, 0.4, 0.4),
        });
    }
    y -= 18;

    // Divider
    page.drawLine({
        start: { x: margin, y },
        end: { x: width - margin, y },
        thickness: 0.5,
        color: rgb(0.7, 0.7, 0.7),
    });
    y -= 12;

    // Sender block
    page.drawText('REMITENTE', {
        x: margin,
        y,
        size: 8,
        font: fontBold,
        color: rgb(0.5, 0.5, 0.5),
    });
    y -= 12;
    page.drawText(data.senderName, {
        x: margin,
        y,
        size: 10,
        font: fontBold,
        color: rgb(0, 0, 0),
    });
    y -= 13;
    y = drawWrappedText(page, data.senderAddress, margin, y, width - margin * 2, font, 9);
    y -= 2;
    page.drawText(`${data.senderPostalCode} ${data.senderCity}`, {
        x: margin,
        y,
        size: 9,
        font,
        color: rgb(0, 0, 0),
    });
    y -= 13;
    page.drawText(data.senderCountry, {
        x: margin,
        y,
        size: 9,
        font,
        color: rgb(0, 0, 0),
    });
    if (data.senderPhone) {
        y -= 13;
        page.drawText(data.senderPhone, {
            x: margin,
            y,
            size: 8,
            font,
            color: rgb(0.4, 0.4, 0.4),
        });
    }
    y -= 18;

    // Divider
    page.drawLine({
        start: { x: margin, y },
        end: { x: width - margin, y },
        thickness: 0.5,
        color: rgb(0.7, 0.7, 0.7),
    });
    y -= 14;

    // Tracking & Barcode
    page.drawText('NUM. SEGUIMIENTO', {
        x: margin,
        y,
        size: 8,
        font: fontBold,
        color: rgb(0.5, 0.5, 0.5),
    });
    y -= 14;
    page.drawText(data.trackingNumber, {
        x: margin,
        y,
        size: 13,
        font: fontBold,
        color: rgb(0, 0, 0),
    });
    y -= 20;

    drawBarcode(page, margin, y - 34, width - margin * 2, 32);
    y -= 44;

    // Reference
    page.drawText(`Ref: ${data.orderPublicId}`, {
        x: margin,
        y,
        size: 8,
        font,
        color: rgb(0.4, 0.4, 0.4),
    });
    y -= 12;
    page.drawText(`Generado: ${new Date().toLocaleDateString('es-ES')}`, {
        x: margin,
        y,
        size: 8,
        font,
        color: rgb(0.4, 0.4, 0.4),
    });

    return doc.save();
}
