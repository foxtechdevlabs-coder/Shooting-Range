export declare const ALL_PERMISSIONS: readonly ['participants.view', 'participants.create', 'participants.edit', 'participants.delete', 'import.use', 'barcodes.print', 'scan.use', 'transactions.view', 'transactions.correct', 'reports.view', 'reports.export', 'users.manage', 'settings.manage'];
export type Permission = (typeof ALL_PERMISSIONS)[number];
export declare const ADMIN_ONLY_PERMISSIONS: Permission[];
export declare const DEFAULT_STAFF_PERMISSIONS: Permission[];
export declare const PERMISSION_LABELS: Record<Permission, string>;
