import { IsArray, IsOptional, IsString } from 'class-validator';

export class UpsertVisitDto {
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsString() staffId?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() companion?: string;
  @IsOptional() @IsString() duration?: string;
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsString() followup?: string;
  @IsOptional() @IsString() transport?: string;
  @IsOptional() @IsArray() products?: string[];
  @IsOptional() @IsString() stageAfter?: string;
}
