/**
 * For an administrator who cannot sign in and has no other administrator to ask. Run on the server:
 *   node dist/recover.js reset-2fa <email>        turn off two-factor sign-in
 *   node dist/recover.js unlock <email>           end a lockout
 * Both are written to the audit log. Passwords are not set here: use Forgot password.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

const [command, email] = process.argv.slice(2);
if ((command !== 'reset-2fa' && command !== 'unlock') || !email) {
  process.stderr.write('Usage: recover.js reset-2fa|unlock <email>\n');
  process.exit(64);
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
try {
  const user = await prisma.user.findFirst({ where: { email: email.trim().toLowerCase(), deletedAt: null } });
  if (!user) {
    process.stderr.write('No such user\n');
    process.exitCode = 1;
  } else {
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: command === 'reset-2fa' ? { totpEnabled: false, totpSecret: null } : { failedLogins: 0, lockedUntil: null } }),
      prisma.auditLog.create({
        data: { userName: 'Server operator', action: command === 'reset-2fa' ? 'user.totpReset' : 'user.unlocked', entity: 'User', entityId: user.id, reason: 'Recovery on the server' },
      }),
    ]);
    process.stdout.write('Done\n');
  }
} finally {
  await prisma.$disconnect();
}
