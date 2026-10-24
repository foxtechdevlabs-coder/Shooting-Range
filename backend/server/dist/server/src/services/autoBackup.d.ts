import type BetterSQLite3 from 'better-sqlite3';
export type AutoBackupReason = 'startup' | 'daily' | 'shutdown';
type Clock = () => Date;
export interface AutoBackupServiceOptions {
    db?: BetterSQLite3.Database;
    folder?: () => string;
    liveDatabasePath?: string;
    clock?: Clock;
    checkMinutes?: number;
    minimumAgeHours?: number;
    timeoutMs?: number;
    closeDatabase?: () => void;
    setIntervalFn?: typeof setInterval;
    clearIntervalFn?: typeof clearInterval;
}
export declare function createAutoBackupService(options?: AutoBackupServiceOptions): {
    start: () => /*elided*/ any;
    runBackup: (reason: AutoBackupReason) => Promise<string | null>;
    runStartupCheck: () => Promise<string | null>;
    runDailyCheck: () => Promise<string | null>;
    shutdown: () => Promise<void>;
    listAutomaticBackups: (directory: string) => {
        filename: string;
        path: string;
        modifiedAt: Date;
    }[];
};
export declare function startAutoBackup(options?: AutoBackupServiceOptions): {
    start: () => /*elided*/ any;
    runBackup: (reason: AutoBackupReason) => Promise<string | null>;
    runStartupCheck: () => Promise<string | null>;
    runDailyCheck: () => Promise<string | null>;
    shutdown: () => Promise<void>;
    listAutomaticBackups: (directory: string) => {
        filename: string;
        path: string;
        modifiedAt: Date;
    }[];
};
export declare function runShutdownBackup(): Promise<void>;
export {};
