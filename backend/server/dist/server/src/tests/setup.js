/**
 * Test setup: creates an in-memory SQLite database for each test file.
 * Sets DATA_DIR to a temp path to avoid touching the real database.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { closeDb, getSqlite } from '../db/connection.js';
import { hash } from '@node-rs/argon2';
let testDataDir;
beforeAll(async () => {
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rangeops-test-'));
    process.env.DATA_DIR = testDataDir;
    process.env.PRINT_DRIVER = 'file';
    runMigrations();
    // Seed test data
    const db = getSqlite();
    const now = new Date().toISOString();
    // Admin user
    const adminHash = await hash('AdminPass123');
    db.prepare(`INSERT INTO users (full_name, username, password_hash, role, permissions, active, must_change_password, created_at) VALUES (?, 'admin', ?, 'admin', '[]', 1, 0, ?)`).run('Admin User', adminHash, now);
    // Staff user (only scan.use)
    const staffHash = await hash('StaffPass123');
    db.prepare(`INSERT INTO users (full_name, username, password_hash, role, permissions, active, must_change_password, created_at) VALUES (?, 'staff', ?, 'staff', ?, 1, 0, ?)`).run('Staff User', staffHash, JSON.stringify(['scan.use', 'transactions.view']), now);
    // Staff user with barcodes.print
    db.prepare(`INSERT INTO users (full_name, username, password_hash, role, permissions, active, must_change_password, created_at) VALUES (?, 'printerstaff', ?, 'staff', ?, 1, 0, ?)`).run('Printer Staff User', staffHash, JSON.stringify(['barcodes.print']), now);
    // Limited staff (no permissions)
    db.prepare(`INSERT INTO users (full_name, username, password_hash, role, permissions, active, must_change_password, created_at) VALUES (?, 'noperm', ?, 'staff', '[]', 1, 0, ?)`).run('No Perm User', staffHash, now);
    // Category
    db.prepare(`INSERT INTO categories (name, active) VALUES ('Senior Men', 1)`).run();
    // Participant for scan tests
    db.prepare(`INSERT INTO participants (bib_number, noc, name, gun_number, category_id, pouch_status, label_printed, created_at, updated_at) VALUES ('101', 'IND', 'Test Athlete', 'G-201', 1, 'in', 0, ?, ?)`).run(now, now);
});
afterAll(() => {
    closeDb();
    fs.rmSync(testDataDir, { recursive: true, force: true });
});
//# sourceMappingURL=setup.js.map