import type BetterSQLite3 from 'better-sqlite3';
export interface EffectiveTransaction {
    id: number;
    participant_id: number;
    gun_number: string;
    type: 'in' | 'out';
    created_at: string;
    user_id: number | null;
    manual_entry: number;
    source: string;
    participant_name?: string | null;
    bib_number?: string | null;
    noc?: string | null;
    user_name?: string | null;
    status: 'valid' | 'corrected' | 'voided';
    original_type?: 'in' | 'out';
    correction_reason?: string;
    corrected_by?: number;
    corrected_at?: string;
}
export declare function effectiveTransactions(db: BetterSQLite3.Database, participantId?: number): EffectiveTransaction[];
export declare function effectiveTransactionSelect(where?: string): string;
export declare function iterateEffectiveTransactions(db: BetterSQLite3.Database, where?: string, params?: Array<string | number>, orderBy?: string): IterableIterator<EffectiveTransaction>;
export declare function resultingPouchStatus(rows: EffectiveTransaction[]): 'in' | 'out';
