import { IsEmail, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail() @MaxLength(254)
  email: string;

  @IsString() @MaxLength(200)
  password: string;
}

export class LoginTotpDto {
  @IsString() @MaxLength(200)
  challenge: string;

  @IsString() @Length(6, 6)
  code: string;
}

export class ChangePasswordDto {
  @IsString() @MaxLength(200)
  currentPassword: string;

  @IsString() @MaxLength(200)
  newPassword: string;
}

export class ForgotPasswordDto {
  @IsEmail() @MaxLength(254)
  email: string;
}

export class ResetPasswordDto {
  @IsString() @MaxLength(200)
  token: string;

  @IsString() @MaxLength(200)
  newPassword: string;
}

export class TotpEnableDto {
  @IsString() @Length(6, 6)
  code: string;
}

export class TotpDisableDto {
  @IsString() @MaxLength(200)
  password: string;

  @IsOptional() @IsString() @Length(6, 6)
  code?: string;
}

export class SessionUserDto {
  id: string;
  name: string;
  email: string;
  designation: string | null;
  roles: string[];
  permissions: string[];
  csrfToken: string;
  totpEnabled: boolean;
  mustChangePassword: boolean;
  /** Admin, Signatory and Accounts may enrol in TOTP */
  totpAvailable: boolean;
}

export class LoginResultDto {
  /** present when a TOTP code is needed to finish signing in */
  totpChallenge?: string | null;
  user?: SessionUserDto | null;
}

export class TotpSetupDto {
  secret: string;
  otpauthUrl: string;
}

export class OkDto {
  ok: boolean;
}
