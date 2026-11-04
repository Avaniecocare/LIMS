import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { currentUser } from '../../common/context.js';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  LoginResultDto,
  LoginTotpDto,
  OkDto,
  ResetPasswordDto,
  SessionUserDto,
  TotpDisableDto,
  TotpEnableDto,
  TotpSetupDto,
} from './auth.dto.js';
import { AuthService } from './auth.service.js';
import { Public } from './decorators.js';
import { SessionService } from './session.service.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  private async begin(userId: string, reply: FastifyReply): Promise<LoginResultDto> {
    const { id, data } = await this.auth.startSession(userId);
    void reply.setCookie(this.sessions.cookieName, id, this.sessions.cookieOptions());
    return { user: await this.auth.describe(userId, data.csrfToken) };
  }

  @Public() @Post('login') @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) reply: FastifyReply): Promise<LoginResultDto> {
    const result = await this.auth.verifyCredentials(dto.email, dto.password);
    if (result.totpChallenge) return { totpChallenge: result.totpChallenge };
    return this.begin(result.userId!, reply);
  }

  @Public() @Post('login/totp') @HttpCode(200)
  async loginTotp(@Body() dto: LoginTotpDto, @Res({ passthrough: true }) reply: FastifyReply): Promise<LoginResultDto> {
    return this.begin(await this.auth.verifyTotpChallenge(dto.challenge, dto.code), reply);
  }

  @Post('logout') @HttpCode(200)
  async logout(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<OkDto> {
    const sid = req.cookies[this.sessions.cookieName];
    if (sid) await this.sessions.destroy(sid);
    void reply.clearCookie(this.sessions.cookieName, { path: '/', domain: this.sessions.cookieOptions().domain });
    return { ok: true };
  }

  @Get('me')
  async me(): Promise<SessionUserDto> {
    const user = currentUser()!;
    return this.auth.describe(user.id, user.csrfToken);
  }

  @Post('change-password') @HttpCode(200)
  async changePassword(@Body() dto: ChangePasswordDto): Promise<OkDto> {
    await this.auth.changePassword(dto.currentPassword, dto.newPassword);
    return { ok: true };
  }

  @Public() @Post('forgot-password') @HttpCode(200)
  async forgot(@Body() dto: ForgotPasswordDto): Promise<OkDto> {
    await this.auth.forgotPassword(dto.email);
    return { ok: true };
  }

  @Public() @Post('reset-password') @HttpCode(200)
  async reset(@Body() dto: ResetPasswordDto): Promise<OkDto> {
    await this.auth.resetPassword(dto.token, dto.newPassword);
    return { ok: true };
  }

  @Post('totp/setup') @HttpCode(200)
  async totpSetup(): Promise<TotpSetupDto> {
    return this.auth.totpSetup();
  }

  @Post('totp/enable') @HttpCode(200)
  async totpEnable(@Body() dto: TotpEnableDto): Promise<OkDto> {
    await this.auth.totpEnable(dto.code);
    return { ok: true };
  }

  @Post('totp/disable') @HttpCode(200)
  async totpDisable(@Body() dto: TotpDisableDto): Promise<OkDto> {
    await this.auth.totpDisable(dto.password);
    return { ok: true };
  }
}
