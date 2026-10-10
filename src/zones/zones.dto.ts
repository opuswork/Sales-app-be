import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpsertZoneDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() sido?: string;
  @IsOptional() @IsString() area?: string;
  @IsOptional() @IsString() channel?: string;
  @IsOptional() @IsString() channel2?: string;
  @IsOptional() @IsInt() @Min(1) @Max(5) difficulty?: number;
  @IsOptional() @IsString() reqRank?: string;
  @IsOptional() @IsArray() products?: string[];
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() ownerId?: string | null;
  @IsOptional() @IsBoolean() lockOwner?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}
