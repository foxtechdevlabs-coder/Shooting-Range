/**
 * Shared label specification and layout constants.
 * Used by both ZPL generator (server) and HTML preview (client).
 */
export const DEFAULT_LABEL_CONFIG = {
    widthMm: 50,
    heightMm: 25,
    dpi: 203,
    darkness: 20,
    speed: 3,
    offsetX: 0,
    offsetY: 0,
    showEventName: false,
    eventName: '',
    mediaTracking: 'gap',
    printDriver: 'file',
    printerName: '',
};
export const LABEL_LAYOUT = {
    // Physical defaults
    defaultWidthMm: 50,
    defaultHeightMm: 25,
    defaultDpi: 203,
    dotsPerMm: 8, // at 203 dpi, 8 dots/mm (400 x 200 dots)
    maxNameChars: 24,
    // Margins in mm and dots
    margin: {
        leftMm: 2.5,
        topMm: 1.5,
        rightMm: 2.5,
        bottomMm: 1.5,
        leftDots: 20,
        topDots: 12,
    },
    // Layout coordinates (in dots) when event name is shown
    withEventName: {
        eventLine: { y: 10, fontH: 16, fontW: 14 },
        bibLine: { y: 28, fontH: 22, fontW: 18 },
        nameLine: { y: 52, fontH: 24, fontW: 20 },
        barcode: { y: 80, height: 64 },
        gunNumberLine: { y: 150, fontH: 26, fontW: 22 },
    },
    // Layout coordinates (in dots) when event name is hidden
    withoutEventName: {
        bibLine: { y: 14, fontH: 24, fontW: 20 },
        nameLine: { y: 42, fontH: 26, fontW: 22 },
        barcode: { y: 74, height: 72 },
        gunNumberLine: { y: 152, fontH: 28, fontW: 24 },
    },
};
/** Convert millimeters to printer dots at given DPI (default 203 dpi = 8 dpmm) */
export function mmToDots(mm, dpi = 203) {
    return Math.round(mm * (dpi / 25.4));
}
/** Convert printer dots to millimeters at given DPI */
export function dotsToMm(dots, dpi = 203) {
    return Math.round((dots * 25.4) / dpi * 10) / 10;
}
/**
 * Sanitize ZPL text to prevent command injection.
 * Strips or replaces '^', '~', and control characters.
 */
export function sanitizeZplText(text) {
    if (!text)
        return '';
    return text
        .replace(/[\x00-\x1F\x7F]/g, '') // strip control chars
        .replace(/\^/g, '_') // replace ^ with _
        .replace(/~/g, '-') // replace ~ with -
        .trim();
}
/**
 * Sanitize and normalize barcode value.
 * Trimmed, uppercase, stripped of control and ZPL escape chars.
 */
export function sanitizeBarcodeValue(value) {
    if (!value)
        return '';
    return sanitizeZplText(value).toUpperCase();
}
/**
 * Truncate participant name to max allowed characters without overflowing.
 */
export function truncateName(name, maxLen = LABEL_LAYOUT.maxNameChars) {
    const clean = sanitizeZplText(name);
    if (clean.length <= maxLen)
        return clean;
    return clean.slice(0, maxLen).trim();
}
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
export function calculateCode128Modules(data) {
    return 11 * data.length + 55;
}
/**
 * Determine module width (^BY 2 or ^BY 1) so the barcode fits inside maxWidthDots.
 * Returns module width and total barcode width, or null if it cannot fit even at module width 1.
 */
export function fitCode128(gunNumber, maxWidthDots) {
    const modules = calculateCode128Modules(gunNumber);
    if (modules * 2 <= maxWidthDots) {
        return { moduleWidth: 2, widthDots: modules * 2 };
    }
    if (modules * 1 <= maxWidthDots) {
        return { moduleWidth: 1, widthDots: modules * 1 };
    }
    return null;
}
//# sourceMappingURL=label.js.map