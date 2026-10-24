import { type LabelConfig } from '../../../shared/label.js';
export interface ZplParticipantInput {
    bib_number: string;
    name: string;
    gun_number: string;
    noc?: string;
    category_name?: string | null;
}
export declare class LabelValidationError extends Error {
    code: string;
    constructor(code: string, message: string);
}
/**
 * Generate ZPL for a single label.
 * Pure function: takes participant data and settings, returns ZPL string.
 * Throws LabelValidationError with code 'LABEL_TOO_WIDE' if barcode cannot fit.
 */
export declare function buildLabelZpl(participant: ZplParticipantInput, userSettings?: Partial<LabelConfig>): string;
/**
 * Generate batch ZPL for multiple participants.
 */
export declare function buildBatchZpl(participants: ZplParticipantInput[], userSettings?: Partial<LabelConfig>): string;
