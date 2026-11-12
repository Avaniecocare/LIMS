import { createHmac, timingSafeEqual } from 'node:crypto';
import { Controller, Get, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../../common/errors.js';
import { logger } from '../../common/logger.js';
import { INFRA_CONFIG, type InfraConfig } from '../../config/infra.config.js';
import { WhatsappService } from '../../core/whatsapp.service.js';
import { Public } from '../auth/decorators.js';

const refused = () => new AppError('FORBIDDEN', 403, 'Not accepted');

/**
 * Meta's WhatsApp webhook, for delivered and read receipts. Meta proves the URL once with the verify token, then
 * signs every call with the app secret; anything unsigned or wrongly signed is refused. Nothing here is trusted
 * beyond moving a message's status forwards.
 */
@ApiExcludeController()
@Controller('webhooks/whatsapp')
export class WhatsappWebhookController {
  constructor(
    private readonly whatsapp: WhatsappService,
    @Inject(INFRA_CONFIG) private readonly infra: InfraConfig,
  ) {}

  @Public() @Get()
  verify(@Res({ passthrough: true }) reply: FastifyReply, @Query('hub.mode') mode?: string, @Query('hub.verify_token') token?: string, @Query('hub.challenge') challenge?: string) {
    const expected = this.infra.whatsapp?.verifyToken;
    if (!expected || mode !== 'subscribe' || !token || !same(token, expected) || !challenge) throw refused();
    // Meta expects the challenge back as it is, as plain text.
    void reply.type('text/plain');
    return challenge.slice(0, 200);
  }

  @Public() @Post() @HttpCode(200)
  async receive(@Req() req: FastifyRequest & { rawBody?: Buffer }) {
    const secret = this.infra.whatsapp?.appSecret;
    const header = req.headers['x-hub-signature-256'];
    if (!secret || typeof header !== 'string' || !req.rawBody) throw refused();
    const expected = `sha256=${createHmac('sha256', secret).update(req.rawBody).digest('hex')}`;
    if (!same(header, expected)) throw refused();
    const changed = await this.whatsapp.receipts(req.body);
    logger.debug({ changed }, 'whatsapp receipts');
    return { ok: true };
  }
}

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
