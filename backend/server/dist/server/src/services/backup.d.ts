export declare function defaultBackupFolder(): string;
export declare function validateBackupFolder(folder: string): string;
export declare function createDatabaseBackup(folder: string, updateManualTimestamp?: boolean): Promise<{
    path: string;
    filename: string;
    createdAt: string;
}>;
export declare function pruneBackups(folder: string): void;
export declare function getBackupStatus(): {
    lastManualBackupAt: string;
    hoursSinceManualBackup: number | null;
    lastAutomaticBackupAt: string;
    backupFolder: string;
};
export declare function runAutomaticBackup(force?: boolean): Promise<{
    path: string;
    filename: string;
    createdAt: string;
} | null>;
