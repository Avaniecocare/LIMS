import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../core/prisma.service.js';
import { RedisService } from '../../core/redis.service.js';
import { Public } from '../auth/decorators.js';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    try {
      // A busy pool must answer "not ready" in good time, not hold the probe.
      await Promise.race([Promise.all([this.prisma.$queryRaw`SELECT 1`, this.redis.client.ping()]), new Promise((_, no) => setTimeout(() => no(new Error('timed out')), 4_000).unref())]);
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException('Dependencies are not ready');
    }
  }
}
