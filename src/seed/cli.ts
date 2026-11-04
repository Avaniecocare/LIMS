/** `node dist/seed/cli.js seed|remove`. Roles and baseline are created here too, so order does not matter. */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { loadBaseline } from '../modules/rbac/baseline.js';
import { syncPermissions } from '../modules/rbac/rbac.bootstrap.js';
import { removeDemo, seedDemo } from './demo.js';

const command = process.argv[2];
if (command !== 'seed' && command !== 'remove') {
  process.stderr.write('Usage: cli.js seed|remove\n');
  process.exit(64);
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
try {
  if (command === 'seed') {
    await prisma.$transaction(syncPermissions);
    await prisma.$transaction(loadBaseline);
    await seedDemo(prisma);
  } else {
    await removeDemo(prisma);
  }
} finally {
  await prisma.$disconnect();
}
