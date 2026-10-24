/**
 * Shared label specification and layout constants.
 * Used by both ZPL generator (server) and HTML preview (client).
 */
export interface LabelConfig {
    widthMm: number;
    heightMm: number;
    dpi: number;
    darkness: number;
    speed: number;
    offsetX: number;
    offsetY: number;
    showEventName: boolean;
    eventName?: string;
    mediaTracking: 'none' | 'gap';
    printDriver?: 'windows' | 'file';
    printerName?: string;
}
export declare const DEFAULT_LABEL_CONFIG: LabelConfig;
export declare const LABEL_LAYOUT: {
    readonly defaultWidthMm: 50;
    readonly defaultHeightMm: 25;
    readonly defaultDpi: 203;
    readonly dotsPerMm: 8;
    readonly maxNameChars: 24;
    readonly margin: {
        readonly leftMm: 2.5;
        readonly topMm: 1.5;
        readonly rightMm: 2.5;
        readonly bottomMm: 1.5;
        readonly leftDots: 20;
        readonly topDots: 12;
    };
    readonly withEventName: {
        readonly eventLine: {
            readonly y: 10;
            readonly fontH: 16;
            readonly fontW: 14;
        };
        readonly bibLine: {
            readonly y: 28;
            readonly fontH: 22;
            readonly fontW: 18;
        };
        readonly nameLine: {
            readonly y: 52;
            readonly fontH: 24;
            readonly fontW: 20;
        };
        readonly barcode: {
            readonly y: 80;
            readonly height: 64;
        };
        readonly gunNumberLine: {
            readonly y: 150;
            readonly fontH: 26;
            readonly fontW: 22;
        };
    };
    readonly withoutEventName: {
        readonly bibLine: {
            readonly y: 14;
            readonly fontH: 24;
            readonly fontW: 20;
        };
        readonly nameLine: {
            readonly y: 42;
            readonly fontH: 26;
            readonly fontW: 22;
        };
        readonly barcode: {
            readonly y: 74;
            readonly height: 72;
        };
        readonly gunNumberLine: {
            readonly y: 152;
            readonly fontH: 28;
            readonly fontW: 24;
        };
    };
};
/** Convert millimeters to printer dots at given DPI (default 203 dpi = 8 dpmm) */
export declare function mmToDots(mm: number, dpi?: number): number;
/** Convert printer dots to millimeters at given DPI */
export declare function dotsToMm(dots: number, dpi?: number): number;
/**
 * Sanitize ZPL text to prevent command injection.
 * Strips or replaces '^', '~', and control characters.
 */
export declare function sanitizeZplText(text: string | null | undefined): string;
/**
 * Sanitize and normalize barcode value.
 * Trimmed, uppercase, stripped of control and ZPL escape chars.
 */
export declare function sanitizeBarcodeValue(value: string | null | undefined): string;
/**
 * Truncate participant name to max allowed characters without overflowing.
 */
export declare function truncateName(name: string, maxLen?: number): string;
/**
 * Calculate the total number of modules in a Code 128 symbol (Subset B).
 * Formula:
 * - 1 Start symbol: 11 modules
 * - N Data characters: 11 * N modules
 * - 1 Check digit: 11 modules
 * - 1 Stop symbol with termination bar: 13 modules
 * - 2 Quiet zones (10 modules each): 20 modules
 * Total = 11 * N + 55 modules.
 */
export declare function calculateCode128Modules(data: string): number;
/**
 * Determine module width (^BY 2 or ^BY 1) so the barcode fits inside maxWidthDots.
 * Returns module width and total barcode width, or null if it cannot fit even at module width 1.
 */
export declare function fitCode128(gunNumber: string, maxWidthDots: number): {
    moduleWidth: 1 | 2;
    widthDots: number;
} | null;
