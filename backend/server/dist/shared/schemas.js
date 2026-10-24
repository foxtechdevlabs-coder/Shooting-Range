import { z } from 'zod';
import { ALL_PERMISSIONS } from './permissions.js';
// ─── Utility validators ─────────────────────────────────────────────────────
export const nocSchema = z
    .string()
    .trim()
    .regex(/^[A-Z]{2,3}$/, 'NOC must be 2–3 uppercase letters');
export const bibNumberSchema = z.string().trim().min(1, 'Bib number is required');
export const gunNumberSchema = z.string().trim().min(1, 'Gun number is required');
export const contactNumberSchema = z
    .string()
    .trim()
    .regex(/^[\d\s+]+$/, 'Contact number may only contain digits, spaces and +')
    .min(5, 'Contact number is too short')
    .optional()
    .or(z.literal(''));
// ─── Auth schemas ────────────────────────────────────────────────────────────
export const loginSchema = z.object({
    username: z.string().trim().min(1, 'Username is required'),
    password: z.string().min(1, 'Password is required'),
});
export const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});
// ─── User schemas ────────────────────────────────────────────────────────────
export const createUserSchema = z.object({
    full_name: z.string().trim().min(2, 'Full name is required'),
    username: z
        .string()
        .trim()
        .min(2, 'Username must be at least 2 characters')
        .regex(/^[a-z0-9_.-]+$/i, 'Username may only contain letters, digits, . _ -'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    role: z.enum(['admin', 'staff']),
    permissions: z.array(z.enum(ALL_PERMISSIONS)).default([]),
    active: z.boolean().default(true),
});
export const updateUserSchema = z.object({
    full_name: z.string().trim().min(2).optional(),
    username: z
        .string()
        .trim()
        .min(2)
        .regex(/^[a-z0-9_.-]+$/i)
        .optional(),
    role: z.enum(['admin', 'staff']).optional(),
    permissions: z.array(z.enum(ALL_PERMISSIONS)).optional(),
    active: z.boolean().optional(),
});
export const resetPasswordSchema = z.object({
    newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});
// ─── Category schemas ────────────────────────────────────────────────────────
export const categorySchema = z.object({
    name: z.string().trim().min(1, 'Category name is required'),
    active: z.boolean().default(true),
});
// ─── Participant schemas ─────────────────────────────────────────────────────
export const participantSchema = z.object({
    bib_number: bibNumberSchema,
    noc: nocSchema,
    name: z.string().trim().min(1, 'Name is required').max(100, 'Name is too long'),
    department: z.string().trim().max(100).optional().or(z.literal('')),
    gun_number: gunNumberSchema,
    contact_number: contactNumberSchema,
    category_id: z.number({ message: 'Category is required' }).int().positive(),
});
export const participantUpdateSchema = participantSchema.partial();
// ─── Import schemas ──────────────────────────────────────────────────────────
export const importCommitSchema = z.object({
    previewId: z.string().min(1, 'Preview ID is required'),
    mode: z.enum(['skip', 'update']),
});
// ─── Scan schemas ────────────────────────────────────────────────────────────
export const scanSchema = z.object({
    code: z.string().min(1, 'Code is required'),
    manual: z.boolean().optional().default(false),
    confirm: z.boolean().optional().default(false),
});
// ─── Settings schemas ────────────────────────────────────────────────────────
export const settingsUpdateSchema = z.record(z.string(), z.string());
// ─── Query / filter schemas ──────────────────────────────────────────────────
export const participantQuerySchema = z.object({
    search: z.string().optional(),
    noc: z.string().optional(),
    department: z.string().optional(),
    category_id: z.coerce.number().optional(),
    pouch_status: z.enum(['in', 'out']).optional(),
    page: z.coerce.number().int().nonnegative().default(0),
    limit: z.coerce.number().int().positive().max(200).default(20),
    sort: z.string().optional(),
    order: z.enum(['asc', 'desc']).default('asc'),
});
export const transactionQuerySchema = z.object({
    search: z.string().optional(),
    participant_id: z.coerce.number().optional(),
    gun_number: z.string().optional(),
    type: z.enum(['in', 'out']).optional(),
    user_id: z.coerce.number().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    page: z.coerce.number().int().nonnegative().default(0),
    limit: z.coerce.number().int().positive().max(200).default(20),
});
// ─── Printing schemas ────────────────────────────────────────────────────────
export const printSelectionSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('ids'),
        ids: z.array(z.number().int().positive()).min(1, 'At least one participant ID is required'),
    }),
    z.object({
        type: z.literal('filter'),
        filter: z.object({
            noc: z.string().optional(),
            department: z.string().optional(),
            categoryId: z.number().int().positive().optional(),
            pouchStatus: z.enum(['in', 'out']).optional(),
            search: z.string().optional(),
        }),
    }),
    z.object({
        type: z.literal('unprinted'),
    }),
]);
export const printLabelsSchema = z.object({
    selection: printSelectionSchema,
    reason: z.string().trim().optional(),
});
//# sourceMappingURL=schemas.js.map