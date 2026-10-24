/**
 * Multer configuration for Excel uploads.
 * - Memory storage (no temp files)
 * - 5 MB limit
 * - .xlsx only
 * - Verifies XLSX file signature (magic bytes)
 */
import multer from 'multer';
export declare const upload: multer.Multer;
/** Verify the buffer starts with the XLSX (ZIP) magic bytes */
export declare function verifyXlsxSignature(buffer: Buffer): boolean;
