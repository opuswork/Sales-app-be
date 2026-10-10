import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';

export class UpsertAccountDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() zoneId?: string | null;
  @IsOptional() @IsString() channel?: string;
  @IsOptional() @IsIn(['S', 'A', 'B']) grade?: string;
  @IsOptional() @IsString() stage?: string;
  @IsOptional() @IsIn(['zone', 'fixed']) ownerMode?: string;
  @IsOptional() @IsString() ownerId?: string | null;
  @IsOptional() @IsArray() products?: string[];
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() memo?: string;
  @IsOptional() @IsString() nextAction?: string;
  @IsOptional() @IsString() nextDate?: string;
  @IsOptional() @IsString() lastVisit?: string;
  @IsOptional() @IsString() force?: string; // 'true' 면 중복 경고 무시하고 등록
}
