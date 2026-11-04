import { SetMetadata } from '@nestjs/common';

export const PUBLIC_KEY = 'lims:public';
export const PERMS_KEY = 'lims:perms';

/** No session required. Every route without this requires a session. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** The caller must hold at least one of these permissions. */
export const Perm = (...codes: string[]) => SetMetadata(PERMS_KEY, codes);
