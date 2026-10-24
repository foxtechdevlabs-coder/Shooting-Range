/**
 * Database connection singleton.
 * Uses better-sqlite3 in WAL mode with foreign keys enabled.
 * Drizzle ORM wraps the connection.
 */
import BetterSQLite3 from 'better-sqlite3';
import * as schema from './schema.js';
export declare function getDb(): import("drizzle-orm/better-sqlite3").BetterSQLite3Database<typeof schema> & {
    $client: BetterSQLite3.Database;
};
export declare function getSqlite(): BetterSQLite3.Database;
/** For tests: close the connection so the file can be deleted */
export declare function closeDb(): void;
