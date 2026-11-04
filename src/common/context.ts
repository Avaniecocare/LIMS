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
}

export interface RequestContext {
  requestId: string;
  ip: string | null;
  user?: CurrentUser;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithContext = <T>(ctx: RequestContext, fn: () => T): T => storage.run(ctx, fn);
export const getContext = (): RequestContext | undefined => storage.getStore();
export const currentUser = (): CurrentUser | undefined => storage.getStore()?.user;

/** Current user id, or null in background jobs and first-run setup. */
export const actorId = (): string | null => storage.getStore()?.user?.id ?? null;
export const can = (permission: string): boolean => storage.getStore()?.user?.permissions.has(permission) ?? false;
