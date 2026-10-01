import { ApiProperty } from '@nestjs/swagger';

export class DashboardQueueDto {
  @ApiProperty({ example: 'finance.slips', description: 'Stable key; the frontend owns the label' })
  key!: string;

  @ApiProperty({ example: '/finance/slips', description: 'Zone-relative page of the queue' })
  path!: string;

  @ApiProperty({ type: 'integer', example: 4 })
  count!: number;

  @ApiProperty({
    type: 'integer',
    example: 1,
    description: 'Past their due time (SLA on the business calendar)',
  })
  overdueCount!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-01T14:30:00+07:00' })
  nextDueAt!: string | null;
}

export class AdminDashboardDto {
  @ApiProperty({ type: [DashboardQueueDto], description: 'Only the queues I may work' })
  queues!: DashboardQueueDto[];

  @ApiProperty({ format: 'date-time', example: '2026-10-01T10:00:00+07:00' })
  generatedAt!: string;
}

export const DASHBOARD_EXAMPLE: AdminDashboardDto = {
  queues: [
    {
      key: 'finance.slips',
      path: '/finance/slips',
      count: 4,
      overdueCount: 1,
      nextDueAt: '2026-10-01T14:30:00+07:00',
    },
  ],
  generatedAt: '2026-10-01T10:00:00+07:00',
};
