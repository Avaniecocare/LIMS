import { Body, Controller, Get, Headers, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getContext } from '../../common/context.js';
import { AppError } from '../../common/errors.js';
import { logger } from '../../common/logger.js';
import { PrismaService } from '../../core/prisma.service.js';
import { OkDto } from '../auth/auth.dto.js';
import { Perm, Public, WhenReadOnly } from '../auth/decorators.js';
import { SessionService } from '../auth/session.service.js';
import { HelpAnalyticsDto, HelpAnalyticsQuery, HelpAskDto, HelpFeedbackDto, HelpPageFeedbackDto, HelpStatusDto } from './help.dto.js';
import { HelpService, type Asker } from './help.service.js';

// A question, a short history and a captcha token fit well inside this.
const MAX_BODY_BYTES = 32 * 1024;

/**
 * The help site's "Ask AI". Public, because the docs can be read without signing in; a signed-in person is
 * recognised from their session for higher limits and staff-only pages. All AI calls are made from here.
 */
@WhenReadOnly('the help assistant saves no lab records')
@ApiTags('help')
@Controller('help')
export class HelpController {
  constructor(
    private readonly help: HelpService,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  /** The signed-in person, if any. A missing or expired session simply means "anonymous". */
  private async userId(req: FastifyRequest): Promise<string | null> {
    const sid = req.cookies?.[this.sessions.cookieName];
    if (!sid) return null;
    const session = await this.sessions.touch(sid);
    if (!session) return null;
    const user = await this.prisma.user.findFirst({ where: { id: session.userId, isActive: true, deletedAt: null }, select: { id: true } });
    return user?.id ?? null;
  }

  private async asker(req: FastifyRequest, turnstileToken: string | null = null): Promise<Asker> {
    const header = (name: string) => {
      const v = req.headers[name];
      return typeof v === 'string' ? v : null;
    };
    return {
      ip: getContext()?.ip ?? req.ip ?? null,
      userId: await this.userId(req),
      userAgent: header('user-agent'),
      origin: header('origin'),
      requestedWith: header('x-requested-with'),
      turnstileToken,
    };
  }

  @Public()
  @Get('status')
  @ApiOkResponse({ type: HelpStatusDto })
  async status(@Req() req: FastifyRequest): Promise<HelpStatusDto> {
    return this.help.status(!!(await this.userId(req)));
  }

  /**
   * Streams the answer as server-sent events: `meta` (answer id and source pages), `delta` (text), `replace` (the text so far is withdrawn), then `done` or `error`.
   * Refusals (limits, captcha, invalid input, assistant off) are ordinary JSON errors before the stream starts.
   */
  @Public()
  @Post('ask')
  @HttpCode(200)
  @ApiProduces('text/event-stream')
  async ask(@Body() dto: HelpAskDto, @Req() req: FastifyRequest, @Res() reply: FastifyReply, @Headers('content-length') length?: string) {
    if (Number(length ?? 0) > MAX_BODY_BYTES) throw new AppError('PAYLOAD_TOO_LARGE', 413, 'That request is too large.');
    // The request stream ends as soon as its body is read; it is the response that closes when the visitor leaves.
    const left = new AbortController();
    reply.raw.on('close', () => left.abort());
    const events = await this.help.ask(await this.asker(req, dto.turnstileToken ?? null), dto, left.signal);
    // Headers set by the app (CORS, security headers, request id) carry over to the raw stream.
    for (const [k, v] of Object.entries(reply.getHeaders())) if (v !== undefined) reply.raw.setHeader(k, v as string);
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
    // Keeps proxies from closing a connection that is quiet while the model thinks.
    const beat = setInterval(() => reply.raw.write(': waiting\n\n'), 15_000);
    try {
      for await (const e of events) {
        if (left.signal.aborted) break;
        reply.raw.write(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
      }
    } catch (err) {
      // The headers have gone, so this cannot become an ordinary error answer.
      logger.warn({ err }, 'help answer stream failed');
      if (!left.signal.aborted) reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: 'The help assistant could not finish this answer. Try again, or use Search.' })}\n\n`);
    } finally {
      clearInterval(beat);
      reply.raw.end();
    }
  }

  @Public()
  @Post('feedback')
  @HttpCode(200)
  @ApiOkResponse({ type: OkDto })
  feedback(@Body() dto: HelpFeedbackDto) {
    return this.help.feedback(dto.id, dto.helpful);
  }

  @Public()
  @Post('page-feedback')
  @HttpCode(200)
  @ApiOkResponse({ type: OkDto })
  async pageFeedback(@Body() dto: HelpPageFeedbackDto, @Req() req: FastifyRequest) {
    return this.help.pageFeedback(dto.path, dto.helpful, await this.asker(req));
  }
}

@ApiTags('admin')
@Controller('admin/help')
export class HelpAdminController {
  constructor(private readonly help: HelpService) {}

  @Get('analytics')
  @Perm('admin.settings')
  @ApiOkResponse({ type: HelpAnalyticsDto })
  analytics(@Query() q: HelpAnalyticsQuery): Promise<HelpAnalyticsDto> {
    return this.help.analytics(q.days ?? 30) as Promise<HelpAnalyticsDto>;
  }
}
