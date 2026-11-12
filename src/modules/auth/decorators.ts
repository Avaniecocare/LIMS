import { SetMetadata } from '@nestjs/common';

export const PUBLIC_KEY = 'lims:public';
export const PERMS_KEY = 'lims:perms';

/** No session required. Every route without this requires a session. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** The caller must hold at least one of these permissions. */
export const Perm = (...codes: string[]) => SetMetadata(PERMS_KEY, codes);

export const SIGNED_IN_KEY = 'lims:signedIn';

/**
 * Any signed-in user may call this route; the service itself scopes what they get (their own notifications,
 * documents, files on records they can see, their account). The reason is required, so every such route says why.
 */
export const SignedIn = (reason: string) => SetMetadata(SIGNED_IN_KEY, reason);

export const MODULE_KEY = 'lims:module';

/** The routes belong to a module the lab can turn off (see ModulesService); when it is off they are refused. */
export const RequireModule = (module: import('../../core/modules.service.js').ModuleKey) => SetMetadata(MODULE_KEY, module);
