// All permission constants shared between frontend and backend
export const ALL_PERMISSIONS = [
    'participants.view',
    'participants.create',
    'participants.edit',
    'participants.delete',
    'import.use',
    'barcodes.print',
    'scan.use',
    'transactions.view',
    'transactions.correct',
    'reports.view',
    'reports.export',
    'users.manage',
    'settings.manage',
];
export const ADMIN_ONLY_PERMISSIONS = [
    'participants.delete',
    'users.manage',
    'settings.manage',
];
export const DEFAULT_STAFF_PERMISSIONS = ['scan.use'];
export const PERMISSION_LABELS = {
    'participants.view': 'View participants',
    'participants.create': 'Add participants',
    'participants.edit': 'Edit participants',
    'participants.delete': 'Delete participants',
    'import.use': 'Import participants',
    'barcodes.print': 'Print barcodes',
    'scan.use': 'Use scan station',
    'transactions.view': 'View transactions',
    'transactions.correct': 'Correct transactions',
    'reports.view': 'View reports',
    'reports.export': 'Export reports',
    'users.manage': 'Manage users',
    'settings.manage': 'Manage settings',
};
//# sourceMappingURL=permissions.js.map