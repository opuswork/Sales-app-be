import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class UpsertUserDto {
  @IsOptional() @IsEmail() email?: string;
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
