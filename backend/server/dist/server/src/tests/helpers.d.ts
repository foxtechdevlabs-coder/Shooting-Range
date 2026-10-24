/**
 * Helper: create an authenticated supertest agent by logging in.
 */
import supertest from 'supertest';
export declare function agent(): import("supertest/lib/agent.js")<supertest.SuperTestStatic.Test>;
export declare function loginAs(username: string, password: string): Promise<import("supertest/lib/agent.js")<supertest.SuperTestStatic.Test>>;
