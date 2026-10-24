/**
 * Multer configuration for Excel uploads.
 * - Memory storage (no temp files)
 * - 5 MB limit
 * - .xlsx only
 * - Verifies XLSX file signature (magic bytes)
 */
import multer from 'multer';
// XLSX magic bytes: PK\x03\x04 (ZIP container)
const XLSX_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
export const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    fileFilter: (_req, file, cb) => {
        if (!file.originalname.toLowerCase().endsWith('.xlsx')) {
            cb(new Error('Only .xlsx files are accepted'));
            return;
        }
        cb(null, true);
    },
});
/** Verify the buffer starts with the XLSX (ZIP) magic bytes */
export function verifyXlsxSignature(buffer) {
    if (buffer.length < 4)
        return false;
    return buffer.slice(0, 4).equals(XLSX_MAGIC);
}
//# sourceMappingURL=upload.js.map