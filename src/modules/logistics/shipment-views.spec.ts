import { PARTNER_HIDDEN_DESTINATION_FIELDS } from '@common/privacy/partner-destination';
import { DECORATORS } from '@nestjs/swagger';

import {
  ADMIN_SHIPMENT_EXAMPLE,
  AdminShipmentDestinationDto,
  AdminShipmentDto,
  PARTNER_POD_EXAMPLE,
  PARTNER_SHIPMENT_EXAMPLE,
  PartnerProofOfDeliveryDto,
  PartnerShipmentDto,
  ProofOfDeliveryDto,
  SHIP_PLAN_EXAMPLE,
  ShipmentAddressDto,
  ShipmentDestinationDto,
  ShipPlanDestinationDto,
  STORE_SHIPMENT_EXAMPLE,
} from './logistics.dto';
import { adminShipmentDto, partnerShipmentDto, type ShipmentRow, storeShipmentDto } from './shipment-views';

const swaggerFields = (cls: abstract new () => unknown): string[] =>
  (
    (Reflect.getMetadata(DECORATORS.API_MODEL_PROPERTIES_ARRAY, cls.prototype) as string[] | undefined) ?? []
  ).map((k) => k.replace(/^:/, ''));

const at = new Date('2026-10-20T03:00:00Z');
const row = (
  podKind: 'carrier_pod' | 'factory_photo_signature' | null = null,
  over: Record<string, unknown> = {},
) =>
  ({
    id: 1n,
    publicId: '0192f3a0-7c1e-7d2a-9b1f-000000000001',
    shipmentNo: 'SH-2610-0001',
    status: podKind ? 'delivered' : 'ready',
    carrier: { code: 'factory_fleet' },
    trackingNo: null,
    trackingUrl: null,
    carrierBookingRef: null,
    bookedAt: null,
    recipientName: 'สมหญิง ใจดี',
    phone: '+66810001234',
    line1: '99/9 ถนนสุขุมวิท',
    line2: 'แขวงคลองตัน',
    postcode: '10110',
    province: {
      publicId: '0192f3a0-7c1e-7d2a-9b1f-000000000007',
      nameTh: 'กรุงเทพมหานคร',
      nameEn: 'Bangkok',
    },
    cartonsCount: 3,
    weightG: 18000,
    volumeCm3: null,
    plannedShipOn: null,
    readyAt: at,
    pickedUpAt: null,
    deliveredAt: null,
    cancelledAt: null,
    cancelReason: null,
    labelFile: null,
    packingListFile: null,
    note: null,
    carrierRequestedAt: null,
    carrierRequestReason: null,
    payoutAmount: null,
    carrierCostAmount: null,
    exceptionResolution: null,
    exceptionNote: null,
    exceptionResolvedAt: null,
    exceptionResolvedBy: null,
    statusChangedAt: at,
    splitFrom: null,
    factory: { publicId: '0192f3a0-7c1e-7d2a-9b1f-000000000009', code: 'F9001' },
    items: [
      {
        orderId: 5n,
        orderDestinationId: 22n,
        quantity: 600,
        deliveredQuantity: null,
        // The order's destinations in stable order: 21n is D1, 22n is D2.
        order: {
          publicId: 'o',
          orderCode: 'PK-2610-0001-01',
          deliveryReconciliation: null,
          destinations: [{ id: 21n }, { id: 22n }],
        },
        orderDestination: { publicId: '0192f3a0-7c1e-7d2a-9b1f-000000000022' },
        productionJob: { publicId: '0192f3a0-7c1e-7d2a-9b1f-000000000030', jobNo: 'JOB-2610-0001' },
      },
    ],
    events: [],
    cartons: [],
    proofOfDelivery: podKind
      ? {
          kind: podKind,
          receiverName: 'สมหญิง ใจดี',
          deliveredQuantity: 600,
          capturedAt: at,
          signatureFile: null,
          carrierPodRef: podKind === 'carrier_pod' ? 'FLASH-1' : null,
          reviews: [],
        }
      : null,
    ...over,
  }) as unknown as ShipmentRow;

describe('shipment views: no customer identity for the factory (P4-01 / P4-D1)', () => {
  it('gives the factory the job destination code, postcode prefix and province only', () => {
    const dto = partnerShipmentDto(row());
    expect(dto.destination).toEqual({
      code: 'D2',
      postcodePrefix: '101',
      province: { id: '0192f3a0-7c1e-7d2a-9b1f-000000000007', nameTh: 'กรุงเทพมหานคร', nameEn: 'Bangkok' },
    });
    expect(dto.cartonsCount).toBe(3);
    expect(dto.items[0]).toMatchObject({ destinationCode: 'D2' });
    const json = JSON.stringify(dto);
    for (const field of PARTNER_HIDDEN_DESTINATION_FIELDS) expect(json).not.toContain(`"${field}"`);
    expect(json).not.toContain('สมหญิง');
    expect(json).not.toContain('+66810001234');
    expect(json).not.toContain('สุขุมวิท');
  });

  it('D-463: a factory-recorded POD returns receiverRecorded, never the name; staff keep it', () => {
    for (const kind of ['factory_photo_signature', 'carrier_pod'] as const) {
      const pod = partnerShipmentDto(row(kind), ['p1']).proofOfDelivery!;
      expect(pod).toEqual({
        kind,
        receiverRecorded: true,
        deliveredQuantity: 600,
        capturedAt: '2026-10-20T10:00:00+07:00',
        signatureFileId: null,
        photoFileIds: ['p1'],
      });
      expect(pod).not.toHaveProperty('receiverName');
      expect(pod).not.toHaveProperty('carrierPodRef');
      expect(JSON.stringify(partnerShipmentDto(row(kind)))).not.toContain('สมหญิง');
      expect(adminShipmentDto(row(kind), { cost: false }).proofOfDelivery).toMatchObject({
        receiverName: 'สมหญิง ใจดี',
        receiverRecorded: true,
        carrierPodRef: kind === 'carrier_pod' ? 'FLASH-1' : null,
      });
    }
    expect(swaggerFields(PartnerProofOfDeliveryDto)).toContain('receiverRecorded');
    expect(swaggerFields(PartnerProofOfDeliveryDto)).not.toContain('receiverName');
    expect(swaggerFields(ProofOfDeliveryDto)).toEqual(
      expect.arrayContaining(['receiverName', 'carrierPodRef']),
    );
    expect(PARTNER_POD_EXAMPLE).not.toHaveProperty('receiverName');
  });

  it('D-463: a fallback carrier shows the factory its name and "booked" only; staff keep tracking', () => {
    const booked = row(null, {
      carrier: { code: 'flash_express' },
      trackingNo: 'TH0123456789',
      trackingUrl: 'https://flashexpress.example/track?pno=TH0123456789',
      carrierBookingRef: 'TH0123456789',
      bookedAt: at,
    });
    const partner = partnerShipmentDto(booked);
    expect(partner.carrier).toBe('flash_express');
    expect(partner.carrierBooked).toBe(true);
    expect(partner).not.toHaveProperty('trackingNo');
    expect(partner).not.toHaveProperty('trackingUrl');
    expect(partner).not.toHaveProperty('carrierBookingRef');
    expect(JSON.stringify(partner)).not.toContain('TH0123456789');
    expect(partnerShipmentDto(row()).carrierBooked).toBe(false);
    expect(adminShipmentDto(booked, { cost: false })).toMatchObject({
      carrierBooked: true,
      trackingNo: 'TH0123456789',
      trackingUrl: 'https://flashexpress.example/track?pno=TH0123456789',
      carrierBookingRef: 'TH0123456789',
    });
    expect(swaggerFields(PartnerShipmentDto)).not.toContain('trackingNo');
    expect(swaggerFields(AdminShipmentDto)).toContain('trackingNo');
    expect(PARTNER_SHIPMENT_EXAMPLE).not.toHaveProperty('trackingNo');
  });

  it('keeps the full address for staff and for the customer', () => {
    expect(adminShipmentDto(row(), { cost: false }).destination).toMatchObject({
      code: 'D2',
      postcodePrefix: '101',
      recipientName: 'สมหญิง ใจดี',
      phone: '+66810001234',
      line1: '99/9 ถนนสุขุมวิท',
      line2: 'แขวงคลองตัน',
      postcode: '10110',
    });
    expect(storeShipmentDto(row(), 5n).destination).toMatchObject({
      recipientName: 'สมหญิง ใจดี',
      postcode: '10110',
    });
  });

  it('declares no recipient field on the partner destination contracts', () => {
    for (const cls of [ShipmentDestinationDto, ShipPlanDestinationDto]) {
      const fields = swaggerFields(cls);
      expect(fields).toEqual(expect.arrayContaining(['code', 'postcodePrefix']));
      for (const field of PARTNER_HIDDEN_DESTINATION_FIELDS) expect(fields).not.toContain(field);
    }
    expect(swaggerFields(AdminShipmentDestinationDto)).toEqual(
      expect.arrayContaining([...PARTNER_HIDDEN_DESTINATION_FIELDS, 'code']),
    );
    expect(swaggerFields(ShipmentAddressDto)).toEqual(
      expect.arrayContaining([...PARTNER_HIDDEN_DESTINATION_FIELDS]),
    );
  });

  it('D-463: tells the factory only whether a waybill was issued; staff see the link state, never a token', () => {
    const partner = partnerShipmentDto(row(), [], false, undefined, true);
    expect(partner.waybillIssued).toBe(true);
    expect(partner).not.toHaveProperty('handover');
    const json = JSON.stringify(partner);
    for (const value of ['สมหญิง', '+66810001234', '0810001234', 'สุขุมวิท', 'คลองตัน', '10110', '/l/d'])
      expect(json).not.toContain(value);
    expect(partnerShipmentDto(row()).waybillIssued).toBe(false);

    const link = {
      state: 'active' as const,
      issuedAt: '2026-10-19T16:05:00+07:00',
      expiresAt: '2026-10-26T16:05:00+07:00',
      openCount: 1,
      lastOpenedAt: null,
      pickupConfirmedAt: null,
    };
    const admin = adminShipmentDto(row(), { cost: false }, [], false, undefined, {
      waybillIssued: true,
      link,
    });
    expect(admin.waybillIssued).toBe(true);
    expect(admin.handover).toEqual(link);
    expect(adminShipmentDto(row(), { cost: false }).handover).toBeNull();
    expect(PARTNER_SHIPMENT_EXAMPLE).toHaveProperty('waybillIssued');
    expect(PARTNER_SHIPMENT_EXAMPLE).not.toHaveProperty('handover');
  });

  it('keeps the recipient out of the partner examples', () => {
    for (const field of PARTNER_HIDDEN_DESTINATION_FIELDS) {
      expect(PARTNER_SHIPMENT_EXAMPLE.destination).not.toHaveProperty(field);
      for (const d of SHIP_PLAN_EXAMPLE.destinations) expect(d).not.toHaveProperty(field);
      expect(ADMIN_SHIPMENT_EXAMPLE.destination).toHaveProperty(field);
      expect(STORE_SHIPMENT_EXAMPLE.destination).toHaveProperty(field);
    }
  });
});
