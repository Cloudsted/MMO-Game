import type { Collections, AccountDoc } from "./db.js";
export declare class AuthError extends Error {
}
export declare function register(cols: Collections, username: string, password: string): Promise<void>;
export declare function login(cols: Collections, username: string, password: string): Promise<{
    token: string;
    account: AccountDoc;
}>;
/** Resolve a Bearer token to its account, or null. */
export declare function authenticate(cols: Collections, token: string | null): Promise<AccountDoc | null>;
//# sourceMappingURL=auth.d.ts.map