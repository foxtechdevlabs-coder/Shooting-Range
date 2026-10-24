import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
// ─── Users ───────────────────────────────────────────────────────────────────
export const users = sqliteTable('users', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    full_name: text('full_name').notNull(),
    username: text('username').notNull().unique(),
    password_hash: text('password_hash').notNull(),
    role: text('role', { enum: ['admin', 'staff'] }).notNull().default('staff'),
    permissions: text('permissions').notNull().default('[]'), // JSON array
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    must_change_password: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
    created_at: text('created_at').notNull(),
    last_login_at: text('last_login_at'),
});
// ─── Sessions ────────────────────────────────────────────────────────────────
export const sessions = sqliteTable('sessions', {
    id: text('id').primaryKey(), // UUID
    user_id: integer('user_id')
        .notNull()
        .references(() => users.id),
    expires_at: text('expires_at').notNull(),
    last_seen_at: text('last_seen_at').notNull(),
});
// ─── Categories ──────────────────────────────────────────────────────────────
export const categories = sqliteTable('categories', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull().unique(),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
});
// ─── Participants ─────────────────────────────────────────────────────────────
export const participants = sqliteTable('participants', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    bib_number: text('bib_number').notNull().unique(),
    noc: text('noc').notNull(),
    name: text('name').notNull(),
    department: text('department'),
    gun_number: text('gun_number').notNull().unique(),
    contact_number: text('contact_number'),
    category_id: integer('category_id')
        .notNull()
        .references(() => categories.id),
    pouch_status: text('pouch_status', { enum: ['in', 'out'] }).notNull().default('in'),
    label_printed: integer('label_printed', { mode: 'boolean' }).notNull().default(false),
    label_stale: integer('label_stale', { mode: 'boolean' }).notNull().default(false),
    label_printed_at: text('label_printed_at'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
});
// ─── Transactions ─────────────────────────────────────────────────────────────
export const transactions = sqliteTable('transactions', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    participant_id: integer('participant_id')
        .notNull()
        .references(() => participants.id),
    gun_number: text('gun_number').notNull(),
    type: text('type', { enum: ['in', 'out'] }).notNull(),
    created_at: text('created_at').notNull(),
    user_id: integer('user_id')
        .notNull()
        .references(() => users.id),
    manual_entry: integer('manual_entry', { mode: 'boolean' }).notNull().default(false),
    source: text('source').notNull().default('scan'),
});
// ─── Corrections (append-only) ───────────────────────────────────────────────
export const corrections = sqliteTable('corrections', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    transaction_id: integer('transaction_id').references(() => transactions.id),
    action: text('action', { enum: ['edit', 'void', 'add'] }).notNull(),
    old_values: text('old_values'),
    new_values: text('new_values').notNull(),
    reason: text('reason').notNull(),
    user_id: integer('user_id').references(() => users.id),
    created_at: text('created_at').notNull(),
});
// ─── Print Jobs (append-only) ─────────────────────────────────────────────────
export const printJobs = sqliteTable('print_jobs', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    user_id: integer('user_id').references(() => users.id),
    created_at: text('created_at').notNull(),
    kind: text('kind', { enum: ['print', 'reprint', 'test'] }).notNull(),
    label_count: integer('label_count').notNull(),
    reason: text('reason'),
    status: text('status', { enum: ['sent', 'failed'] }).notNull(),
    error: text('error'),
    printer_name: text('printer_name').notNull(),
});
// ─── Print Job Items (append-only) ─────────────────────────────────────────────
export const printJobItems = sqliteTable('print_job_items', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    job_id: integer('job_id')
        .notNull()
        .references(() => printJobs.id),
    participant_id: integer('participant_id').references(() => participants.id),
    gun_number: text('gun_number').notNull(),
});
// ─── Activity Log ─────────────────────────────────────────────────────────────
export const activityLog = sqliteTable('activity_log', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    user_id: integer('user_id').references(() => users.id),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entity_id: text('entity_id'),
    old_values: text('old_values'), // JSON
    new_values: text('new_values'), // JSON
    created_at: text('created_at').notNull(),
});
// ─── Import Batches ───────────────────────────────────────────────────────────
export const importBatches = sqliteTable('import_batches', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    user_id: integer('user_id')
        .notNull()
        .references(() => users.id),
    file_name: text('file_name').notNull(),
    rows_imported: integer('rows_imported').notNull().default(0),
    rows_updated: integer('rows_updated').notNull().default(0),
    rows_rejected: integer('rows_rejected').notNull().default(0),
    created_at: text('created_at').notNull(),
});
// ─── Settings ─────────────────────────────────────────────────────────────────
export const settings = sqliteTable('settings', {
    key: text('key').primaryKey(),
    value: text('value').notNull(),
});
//# sourceMappingURL=schema.js.map