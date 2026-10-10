import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class UpsertUserDto {
  /** 로그인 ID 또는 이메일 (공백 없이 3자 이상) */
  @IsOptional() @IsString() @Matches(/^\S{3,}$/, { message: '로그인 ID는 공백 없이 3자 이상이어야 합니다.' }) email?: string;
  @IsOptional() @IsString() @MinLength(8) password?: string;
  @IsOptional() @IsIn(['ADMIN', 'STAFF']) role?: 'ADMIN' | 'STAFF';
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() rank?: string;
  @IsOptional() @IsString() part?: string;
  @IsOptional() @IsString() roleDesc?: string;
  @IsOptional() @IsString() base?: string;
  @IsOptional() @IsInt() @Min(0) @Max(60) exp?: number;
  @IsOptional() @IsObject() skills?: Record<string, number>;
  @IsOptional() @IsArray() products?: string[];
  @IsOptional() @IsBoolean() field?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(20) zoneCap?: number;
  @IsOptional() @IsInt() @Min(0) @Max(60) capacity?: number;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() phone?: string;
}
