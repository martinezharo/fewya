declare module 'pdf-lib' {
    export class PDFDocument {
        static create(): Promise<PDFDocument>;
        addPage(dimensions: [number, number]): PDFPage;
        embedFont(font: StandardFonts): Promise<PDFFont>;
        save(): Promise<Uint8Array>;
    }

    export interface PDFPage {
        drawText(text: string, options: {
            x?: number;
            y?: number;
            size?: number;
            font?: PDFFont;
            color?: PDFColor;
        }): void;
        drawRectangle(options: {
            x: number;
            y: number;
            width: number;
            height: number;
            color?: PDFColor;
        }): void;
        drawLine(options: {
            start: { x: number; y: number };
            end: { x: number; y: number };
            thickness?: number;
            color?: PDFColor;
        }): void;
    }

    export interface PDFFont {
        widthOfTextAtSize(text: string, size: number): number;
    }

    export interface PDFColor {
        _brand: 'PDFColor';
    }

    export function rgb(r: number, g: number, b: number): PDFColor;

    export enum StandardFonts {
        Helvetica = 'Helvetica',
        HelveticaBold = 'Helvetica-Bold',
    }
}
