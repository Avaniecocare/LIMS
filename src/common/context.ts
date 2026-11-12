import { AsyncLocalStorage } from 'node:async_hooks';

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  designation: string | null;
  roles: string[];
  permissions: Set<string>;
  sessionId: string;
  csrfToken: string;
  /** when the password was last confirmed in this session (ms), for sensitive actions */
  reauthAt?: number;
}

export interface RequestContext {
  requestId: string;
  ip: string | null;
  userAgent?: string | null;
  user?: CurrentUser;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithContext = <T>(ctx: RequestContext, fn: () => T): T => storage.run(ctx, fn);
export const getContext = (): RequestContext | undefined => storage.getStore();
export const currentUser = (): CurrentUser | undefined => storage.getStore()?.user;

/** Current user id, or null in background jobs and first-run setup. */
export const actorId = (): string | null => storage.getStore()?.user?.id ?? null;
export const can = (permission: string): boolean => storage.getStore()?.user?.permissions.has(permission) ?? false;

/** How long a password confirmation covers sensitive actions in the same session. */
// TODO(rbac-decision): how long a confirmed password covers sensitive actions (ten minutes chosen).
export const REAUTH_WINDOW_MS = 10 * 60_000;
