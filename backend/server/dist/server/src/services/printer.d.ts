import type { PrinterInfo } from '../../../shared/types.js';
export declare class PrinterError extends Error {
    code: 'PRINTER_NOT_FOUND' | 'PRINTER_OFFLINE' | 'SPOOL_FAILED' | 'LABEL_TOO_WIDE';
    constructor(code: 'PRINTER_NOT_FOUND' | 'PRINTER_OFFLINE' | 'SPOOL_FAILED' | 'LABEL_TOO_WIDE', message: string);
}
/**
 * Determine effective print driver: 'windows' | 'file'.
 * Default is 'file' in dev/tests, unless PRINT_DRIVER env is 'windows' or override specified.
 */
export declare function getEffectiveDriver(override?: string | null): 'windows' | 'file';
/**
 * List installed printers on Windows.
 * Returns empty array on non-Windows or if enumeration fails.
 */
export declare function listPrinters(): Promise<PrinterInfo[]>;
export interface PrintOptions {
    printerName?: string;
    driverOverride?: 'windows' | 'file';
}
export interface PrintResult {
    driver: 'windows' | 'file';
    target: string;
    bytes: number;
}
/**
 * Print raw ZPL via the effective driver.
 * - 'file': writes to data/labels/<timestamp>-<random>.zpl
 * - 'windows': sends raw bytes to Windows print spooler via winspool.drv
 */
export declare function printZpl(zpl: string, options?: PrintOptions): Promise<PrintResult>;
