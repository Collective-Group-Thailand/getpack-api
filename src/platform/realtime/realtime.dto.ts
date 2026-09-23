import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, IsUrl, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class RealtimeAuthDto {
  @ApiProperty({
    example: 'eyJhbGciOiJFZERTQSIsInR5cCI6InJ0K2p3dCJ9.eyJjaCI6W119.c2ln',
    description: 'Pass as `?token=` to the stream; valid 60 s',
  })
  token!: string;

  @ApiProperty({ format: 'date-time', example: '2026-09-23T14:06:00+07:00' })
  expiresAt!: string;

  @ApiProperty({ type: [String], example: ['user:0192f3a0-7c1e-7d2a-9b1f-3c4d5e6f7a8b'] })
  channels!: string[];

  @ApiProperty({ example: '/v1/store/realtime/stream' })
  streamPath!: string;
}

export class WebPushKeysDto {
  @ApiProperty({
    example: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
  })
  @IsString()
  @MinLength(16)
  @MaxLength(256)
  p256dh!: string;

  @ApiProperty({ example: 'tBHItJI5svbpez7KI4CCXg', description: 'Stored encrypted' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  auth!: string;
}

export class SubscribeWebPushDto {
  @ApiProperty({ example: 'https://push.example.com/subscription/abc123', maxLength: 2048 })
  @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: false })
  @MaxLength(2048)
  endpoint!: string;

  @ApiProperty({ type: WebPushKeysDto })
  @ValidateNested()
  @Type(() => WebPushKeysDto)
  keys!: WebPushKeysDto;

  @ApiPropertyOptional({ example: 'Mozilla/5.0 (fake test agent)', maxLength: 512 })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  userAgent?: string;
}

export class WebPushSubscriptionDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000beef' })
  id!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'BFakeVapidPublicKey',
    description: 'VAPID public key for PushManager.subscribe',
  })
  vapidPublicKey!: string | null;
}

export class VapidKeyDto {
  @ApiProperty({ type: String, nullable: true, example: 'BFakeVapidPublicKey' })
  vapidPublicKey!: string | null;
}
