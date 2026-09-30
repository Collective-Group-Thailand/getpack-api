import { CursorQuery } from '@common/pagination/pagination.dto';
import { ApiProperty } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';

/** Order timelines, progress and public tracking (D-050, D-142, D-143; B4.4). */

export const TIMELINE_IDS = {
  order: '0192f3a0-7c1e-7d2a-9b1f-0000000f1002',
  shipment: '0192f3a0-7c1e-7d2a-9b1f-0000000f2001',
  photo: '0192f3a0-7c1e-7d2a-9b1f-0000000f2005',
  user: '0192f3a0-7c1e-7d2a-9b1f-3c4d5e6f7a8b',
};

export class TimelineQuery extends CursorQuery {}

export class TimelineShipmentRefDto {
  @ApiProperty({ format: 'uuid', example: TIMELINE_IDS.shipment })
  id!: string;

  @ApiProperty({ example: 'SH-2610-0001' })
  shipmentNo!: string;

  @ApiProperty({
    enum: ['packio', 'flash_express', 'deliveree'],
    enumName: 'StoreCarrier',
    example: 'packio',
  })
  carrier!: string;

  @ApiProperty({ nullable: true, example: null })
  trackingNo!: string | null;
}

/** One step of the customer's order story (chronological). */
export class TimelineEntryDto {
  @ApiProperty({ example: 'a:1042', description: 'Stable id of the entry within the timeline' })
  id!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-12T10:15:00+07:00' })
  occurredAt!: string;

  @ApiProperty({
    example: 'production.milestone_reached',
    description: 'What happened: an activity action or `shipment.<status>`',
  })
  type!: string;

  @ApiProperty({
    example: 'activity.production.milestone_reached',
    description: 'i18n key the client renders',
  })
  messageKey!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { stepKey: 'printing', labelTh: 'กำลังพิมพ์', labelEn: 'Printing' },
  })
  params!: Record<string, unknown>;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    example: [TIMELINE_IDS.photo],
    description: 'Photos shared with the customer (milestones, proof of delivery)',
  })
  photoFileIds!: string[];

  @ApiProperty({ type: TimelineShipmentRefDto, nullable: true })
  shipment!: TimelineShipmentRefDto | null;
}

export class TimelineActorDto {
  @ApiProperty({ enum: ['user', 'api_client', 'system', 'webhook'], enumName: 'ActorType', example: 'user' })
  type!: string;

  @ApiProperty({ nullable: true, example: 'CS ทดสอบ' })
  displayName!: string | null;
}

/** Staff see everything: internal steps, the factory's, shipments and internal notes with @mentions. */
export class StaffTimelineEntryDto extends TimelineEntryDto {
  @ApiProperty({
    enum: ['order', 'order_group', 'production_job', 'shipment', 'note'],
    enumName: 'TimelineSource',
    example: 'production_job',
  })
  source!: string;

  @ApiProperty({
    enum: ['internal', 'customer', 'partner'],
    enumName: 'ActivityVisibility',
    isArray: true,
    example: ['internal', 'partner'],
  })
  visibility!: string[];

  @ApiProperty({ type: TimelineActorDto, nullable: true })
  actor!: TimelineActorDto | null;

  @ApiProperty({ nullable: true, example: null, description: 'Internal note text (source `note`)' })
  body!: string | null;

  @ApiProperty({ type: [UserRefDto], description: 'Staff @mentioned in a note' })
  mentions!: UserRefDto[];
}

export class ProgressStepDto {
  @ApiProperty({ example: 'printing' })
  key!: string;

  @ApiProperty({ example: 'กำลังพิมพ์' })
  labelTh!: string;

  @ApiProperty({ example: 'Printing' })
  labelEn!: string;

  @ApiProperty({
    enum: ['pending', 'in_progress', 'completed', 'skipped'],
    enumName: 'MilestoneStatus',
    example: 'completed',
  })
  status!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-14T18:00:00+07:00',
    description: 'When the step is due in the factory’s plan (D-075); null when the plan sets no date',
  })
  promisedAt!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, example: '2026-10-14T16:00:00+07:00' })
  completedAt!: string | null;
}

/** Promised vs actual (D-081, B4.4): the order's facts and its customer-visible production steps. */
export class OrderProgressDto {
  @ApiProperty({ format: 'uuid', example: TIMELINE_IDS.order })
  orderId!: string;

  @ApiProperty({ example: 'shipping' })
  status!: string;

  @ApiProperty({ format: 'date', nullable: true, example: '2026-10-20' })
  promisedShipDate!: string | null;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    example: '2026-10-22',
    description: 'Expected arrival: the quotation’s delivery estimate moved with the promised ship date',
  })
  estimatedDeliveryDate!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, example: '2026-10-10T09:00:00+07:00' })
  paidForProductionAt!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, example: '2026-10-11T10:00:00+07:00' })
  artworkApprovedAt!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, example: '2026-10-11T10:05:00+07:00' })
  productionStartedAt!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, example: '2026-10-19T08:00:00+07:00' })
  shippedAt!: string | null;

  @ApiProperty({
    type: Boolean,
    nullable: true,
    example: true,
    description: 'Shipped on or before the promised date; null until shipped or without a promise',
  })
  shippedOnTime!: boolean | null;

  @ApiProperty({ format: 'date-time', nullable: true, example: null })
  deliveredAt!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, example: null })
  completedAt!: string | null;

  @ApiProperty({ type: [ProgressStepDto] })
  steps!: ProgressStepDto[];
}

export class TrackingStepDto {
  @ApiProperty({
    enum: ['ready', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'failed', 'returned'],
    enumName: 'TrackingStatus',
    example: 'in_transit',
  })
  status!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-19T12:00:00+07:00' })
  occurredAt!: string;
}

export class TrackingShipmentDto {
  @ApiProperty({ example: 'SH-2610-0001' })
  shipmentNo!: string;

  @ApiProperty({
    enum: ['ready', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'failed', 'returned'],
    enumName: 'TrackingStatus',
    example: 'in_transit',
  })
  status!: string;

  @ApiProperty({
    enum: ['packio', 'flash_express', 'deliveree'],
    enumName: 'StoreCarrier',
    example: 'packio',
  })
  carrier!: string;

  @ApiProperty({ nullable: true, example: null })
  trackingNo!: string | null;

  @ApiProperty({ nullable: true, example: null })
  trackingUrl!: string | null;

  @ApiProperty({ type: 'integer', example: 3 })
  cartonsCount!: number;

  @ApiProperty({ type: [TrackingStepDto] })
  steps!: TrackingStepDto[];
}

/** Public tracking (B4.4): no personal data — no names, addresses, phones, locations or photos. */
export class PublicTrackingDto {
  @ApiProperty({ example: 'shipping' })
  status!: string;

  @ApiProperty({ format: 'date', nullable: true, example: '2026-10-20' })
  promisedShipDate!: string | null;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    example: '2026-10-22',
    description: 'Expected arrival: the quotation’s delivery estimate moved with the promised ship date',
  })
  estimatedDeliveryDate!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, example: '2026-10-19T08:00:00+07:00' })
  shippedAt!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, example: null })
  deliveredAt!: string | null;

  @ApiProperty({ type: [ProgressStepDto] })
  steps!: ProgressStepDto[];

  @ApiProperty({ type: [TrackingShipmentDto] })
  shipments!: TrackingShipmentDto[];
}

export class TrackingLinkDto {
  @ApiProperty({
    example: 'https://www.packio.example/track/q3J9f0T1xYk8Zb2mR4sW6uE7vN0aLcDh',
    description: 'Shown once; only its hash is kept',
  })
  url!: string;

  @ApiProperty({ example: 'q3J9f0T1xYk8Zb2mR4sW6uE7vN0aLcDh' })
  token!: string;
}

const STEP = {
  key: 'printing',
  labelTh: 'กำลังพิมพ์',
  labelEn: 'Printing',
  status: 'completed',
  promisedAt: '2026-10-14T18:00:00+07:00',
  completedAt: '2026-10-14T16:00:00+07:00',
};
export const TIMELINE_ENTRY_EXAMPLE = {
  id: 'a:1042',
  occurredAt: '2026-10-14T16:00:00+07:00',
  type: 'production.milestone_reached',
  messageKey: 'activity.production.milestone_reached',
  params: { stepKey: 'printing', labelTh: 'กำลังพิมพ์', labelEn: 'Printing' },
  photoFileIds: [TIMELINE_IDS.photo],
  shipment: null,
};
export const STAFF_TIMELINE_ENTRY_EXAMPLE = {
  ...TIMELINE_ENTRY_EXAMPLE,
  source: 'order',
  visibility: ['internal', 'customer'],
  actor: { type: 'user', displayName: 'ผู้ปฏิบัติงาน (fake)' },
  body: null,
  mentions: [],
};
export const PROGRESS_EXAMPLE = {
  orderId: TIMELINE_IDS.order,
  status: 'shipping',
  promisedShipDate: '2026-10-20',
  estimatedDeliveryDate: '2026-10-22',
  paidForProductionAt: '2026-10-10T09:00:00+07:00',
  artworkApprovedAt: '2026-10-11T10:00:00+07:00',
  productionStartedAt: '2026-10-11T10:05:00+07:00',
  shippedAt: '2026-10-19T08:00:00+07:00',
  shippedOnTime: true,
  deliveredAt: null,
  completedAt: null,
  steps: [STEP],
};
export const TRACKING_EXAMPLE = {
  status: 'shipping',
  promisedShipDate: '2026-10-20',
  estimatedDeliveryDate: '2026-10-22',
  shippedAt: '2026-10-19T08:00:00+07:00',
  deliveredAt: null,
  steps: [STEP],
  shipments: [
    {
      shipmentNo: 'SH-2610-0001',
      status: 'in_transit',
      carrier: 'packio',
      trackingNo: null,
      trackingUrl: null,
      cartonsCount: 3,
      steps: [
        { status: 'picked_up', occurredAt: '2026-10-19T08:00:00+07:00' },
        { status: 'in_transit', occurredAt: '2026-10-19T12:00:00+07:00' },
      ],
    },
  ],
};
