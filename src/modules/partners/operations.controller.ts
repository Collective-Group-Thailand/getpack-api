import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { type Request } from 'express';

import { AgreementsService } from './agreements/agreements.service';
import {
  CAPABILITY_IDS,
  CapabilityDto,
  CapabilityItemsDto,
  CreateCapabilityDto,
  CreateMachineDto,
  DeliveryZoneDto,
  MachineDto,
  ReplaceCapabilityItemsDto,
  ReplaceDeliveryZonesDto,
  UpdateCapabilityDto,
  UpdateMachineDto,
} from './capability/capability.dto';
import { CapabilityService } from './capability/capability.service';
import { CapacityService } from './capacity/capacity.service';
import {
  CONFIGURATION_EXAMPLE,
  FactoryConfigurationDto,
  SetCapacityDto,
  SetParticipationDto,
  SetPayoutPolicyDto,
  SetPricingArrangementDto,
  SetToleranceDto,
} from './configuration/configuration.dto';
import { ConfigurationService } from './configuration/configuration.service';
import {
  AGREEMENT_STATUS_EXAMPLE,
  AgreementStatusDto,
  AgreementTemplateDto,
  CapacityQuery,
  CapacityWeekDto,
  PublishAgreementVersionDto,
  RecordSignedAgreementDto,
  RecordSiteVisitDto,
  SetCapacityOverrideDto,
  SiteVisitDto,
  VersionWriteResultDto,
} from './operations.dto';
import { staffOrPartner } from './partner-actor';
import { type SiteVisitRow, SiteVisitsService } from './site-visits/site-visits.service';

const WRITE = ['http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed'] as const;
const factoryParam = ApiParam({ name: 'factoryId', format: 'uuid' });
const typeParam = ApiParam({ name: 'productTypeId', format: 'uuid' });
const CAPABILITY: CapabilityDto = {
  id: CAPABILITY_IDS.capability,
  productTypeId: CAPABILITY_IDS.productType,
  productTypeCode: 'folding_carton',
  printTypeId: CAPABILITY_IDS.printType,
  maxSheetWidthMm: 720,
  maxSheetLengthMm: 1020,
  minOrderQty: 500,
  maxOrderQty: null,
  status: 'active',
};
const ITEMS: CapabilityItemsDto = {
  productTypeId: CAPABILITY_IDS.productType,
  items: [{ kind: 'material', itemId: CAPABILITY_IDS.material, code: 'art-card-350' }],
};
const MACHINE: MachineDto = {
  id: CAPABILITY_IDS.machine,
  name: 'Heidelberg 5 สี',
  printTypeId: CAPABILITY_IDS.printType,
  maxWidthMm: 720,
  maxLengthMm: 1020,
  details: 'เครื่องพิมพ์ออฟเซ็ท 5 สี + เคลือบ',
  status: 'active',
};
const ZONE: DeliveryZoneDto = {
  zoneId: CAPABILITY_IDS.zone,
  zoneCode: 'BKK',
  schemeCode: 'customer_default',
  serves: true,
  extraLeadDays: 1,
};
const WEEK: CapacityWeekDto = {
  weekStart: '2026-09-28',
  capacity: '12000.000',
  booked: '4500.000',
  free: '7500.000',
  source: 'version',
};
const SITE_VISIT: SiteVisitDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-00000000f503',
  visitedOn: '2026-09-25',
  checklistVersion: 'v1',
  checklist: { machinesOk: true, qcArea: 'ok' },
  result: 'pass',
  notes: 'สายการผลิตพร้อม',
  inspectorIds: ['0192f3a0-7c1e-7d2a-9b1f-00000000f502'],
  photoFileIds: ['0192f3a0-7c1e-7d2a-9b1f-00000000f501'],
  createdAt: '2026-09-26T10:00:00+07:00',
};

const weekDto = (w: {
  weekStart: string;
  capacity: { toFixed(n: number): string };
  booked: { toFixed(n: number): string };
  free: { toFixed(n: number): string };
  source: 'version' | 'override';
}): CapacityWeekDto => ({
  weekStart: w.weekStart,
  capacity: w.capacity.toFixed(3),
  booked: w.booked.toFixed(3),
  free: w.free.toFixed(3),
  source: w.source,
});
const siteVisitDto = ({ visit, photoIds }: { visit: SiteVisitRow; photoIds: string[] }): SiteVisitDto => ({
  id: visit.publicId,
  visitedOn: visit.visitedOn.toISOString().slice(0, 10),
  checklistVersion: visit.checklistVersion,
  checklist: visit.checklist as Record<string, unknown>,
  result: visit.result,
  notes: visit.notes,
  inspectorIds: visit.inspectors.map((i) => i.user.publicId),
  photoFileIds: photoIds,
  createdAt: toBangkokIso(visit.createdAt),
});
const clientIp = (req: Request) => req.ip ?? null;

/** Reads shared by the admin and partner surfaces (decorated so subclasses inherit its injection). */
@Injectable()
abstract class FactoryReads {
  constructor(
    protected readonly configurationService: ConfigurationService,
    protected readonly capability: CapabilityService,
    protected readonly capacity: CapacityService,
    protected readonly agreements: AgreementsService,
  ) {}

  protected async weeks(actor: Actor, factoryId: string, query: CapacityQuery) {
    const weeks = await this.capacity.overview(
      actor,
      factoryId,
      query.productTypeId,
      query.from ?? bangkokDate(new Date()),
      query.weeks ?? 8,
    );
    return weeks.map(weekDto);
  }
}

@ApiSurface('admin', 'factories')
@Controller('factories/:factoryId')
export class AdminFactoryOperationsController extends FactoryReads {
  constructor(
    configurationService: ConfigurationService,
    capability: CapabilityService,
    capacity: CapacityService,
    agreements: AgreementsService,
    private readonly siteVisits: SiteVisitsService,
  ) {
    super(configurationService, capability, capacity, agreements);
  }

  @Get('configuration')
  @Can('partners.read')
  @factoryParam
  @ApiEndpoint({
    id: 'admin.factories.getConfiguration',
    summary: 'Get the effective-dated configuration of a factory',
    description:
      'Pricing mode (D-042), participation tier per type (D-043), weekly capacity (D-101), tolerance overrides (D-021) and ' +
      'payout policy (D-022): the version in force and scheduled or pending ones (ADR-0005).',
    implements: ['D-042', 'D-043', 'D-101', 'D-021', 'D-022'],
  })
  @ApiSuccess(200, {
    description: 'Configuration',
    type: FactoryConfigurationDto,
    example: CONFIGURATION_EXAMPLE,
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  configuration(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.configurationService.configuration(actor, factoryId);
  }

  @Post('participations')
  @Can('partners.manage')
  @factoryParam
  @ApiEndpoint({
    id: 'admin.factories.setParticipation',
    summary: 'Set the participation tier of a factory for a product type',
    description:
      'New version (ADR-0005). A tier needs an active capability for the type. A = full price list, B = within the lines it ' +
      'covers, C = quote on request (D-043).',
    implements: ['D-043', 'D-100'],
  })
  @ApiBody({
    type: SetParticipationDto,
    examples: {
      default: {
        value: { productTypeId: CAPABILITY_IDS.productType, tier: 'A', reason: 'Full price list agreed' },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Version written',
    type: VersionWriteResultDto,
    example: { versionNo: 1, status: 'approved', approvalRequestId: null },
  })
  @ApiStandardErrors(...WRITE, 'partners.backdated', 'partners.not_capable')
  participation(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: SetParticipationDto,
  ) {
    return this.configurationService.setParticipation(staffOrPartner(actor), factoryId, body);
  }

  @Post('pricing-arrangement-versions')
  @Can('partners.manage')
  @factoryParam
  @ApiEndpoint({
    id: 'admin.factories.setPricingArrangement',
    summary: 'Choose or change the pricing-ownership mode of a factory',
    description:
      'Platform rate card or factory price list (D-042). The first choice is part of onboarding; a change opens the ' +
      '`partner_pricing_mode_change` approval of the Partner Manager (D-167) and applies once approved.',
    implements: ['D-042', 'D-167'],
  })
  @ApiBody({
    type: SetPricingArrangementDto,
    examples: {
      default: { value: { ownershipMode: 'factory_price_list', reason: 'Factory keeps its own list' } },
    },
  })
  @ApiSuccess(201, {
    description: 'Version written',
    type: VersionWriteResultDto,
    example: { versionNo: 2, status: 'proposed', approvalRequestId: '0192f3a0-7c1e-7d2a-9b1f-00000000f301' },
  })
  @ApiStandardErrors(
    ...WRITE,
    'partners.backdated',
    'partners.version_pending',
    'approval.already_pending',
    'approval.no_matching_step',
  )
  pricingArrangement(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: SetPricingArrangementDto,
  ) {
    return this.configurationService.setPricingArrangement(staffOrPartner(actor), factoryId, body);
  }

  @Post('capacity-versions')
  @Can('partners.manage')
  @factoryParam
  @ApiEndpoint({
    id: 'admin.factories.setCapacity',
    summary: 'Set the weekly capacity of a factory for a product type',
    description: 'New version (ADR-0005); lead-time promises never exceed it (D-101).',
    implements: ['D-101'],
  })
  @ApiBody({
    type: SetCapacityDto,
    examples: {
      default: {
        value: {
          productTypeId: CAPABILITY_IDS.productType,
          capacityUnit: 'sheets',
          weeklyCapacity: 12000,
          reason: 'Agreed with the factory',
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Version written',
    type: VersionWriteResultDto,
    example: { versionNo: 1, status: 'approved', approvalRequestId: null },
  })
  @ApiStandardErrors(...WRITE, 'partners.backdated')
  setCapacity(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: SetCapacityDto,
  ) {
    return this.configurationService.setCapacity(staffOrPartner(actor), factoryId, body);
  }

  @Post('tolerance-versions')
  @Can('partners.manage')
  @factoryParam
  @ApiEndpoint({
    id: 'admin.factories.setTolerance',
    summary: 'Propose a quantity-tolerance override for a factory',
    description:
      'Factory default (no product type) or per product type (D-021); the platform default is ± 5 % (D-163). Opens the ' +
      '`factory_tolerance_change` approval (Superadmin, D-173) and applies once approved.',
    implements: ['D-021', 'D-163', 'D-173'],
  })
  @ApiBody({
    type: SetToleranceDto,
    examples: { default: { value: { shortagePct: 3, overagePct: 5, reason: 'Agreed at onboarding' } } },
  })
  @ApiSuccess(201, {
    description: 'Version proposed',
    type: VersionWriteResultDto,
    example: { versionNo: 1, status: 'proposed', approvalRequestId: '0192f3a0-7c1e-7d2a-9b1f-00000000f301' },
  })
  @ApiStandardErrors(
    ...WRITE,
    'partners.backdated',
    'partners.version_pending',
    'approval.already_pending',
    'approval.no_matching_step',
  )
  setTolerance(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: SetToleranceDto,
  ) {
    return this.configurationService.setTolerance(staffOrPartner(actor), factoryId, body);
  }

  @Post('payout-policy-versions')
  @Can('partners.manage')
  @factoryParam
  @ApiEndpoint({
    id: 'admin.factories.setPayoutPolicy',
    summary: 'Propose a payout-policy override for a factory',
    description:
      'Advance on acceptance, balance after POD and the claim window, retention and its release (D-022, D-164); without an ' +
      'override the platform defaults apply. Opens `factory_payout_policy_change` (Superadmin, D-173).',
    implements: ['D-022', 'D-164', 'D-173'],
  })
  @ApiBody({
    type: SetPayoutPolicyDto,
    examples: {
      default: {
        value: {
          advancePct: 30,
          advanceTrigger: 'job_accepted',
          balanceTrigger: 'after_pod_and_claim_window',
          claimWindowDays: 7,
          retentionPct: 5,
          retentionReleaseDays: 30,
          reason: 'Standard terms',
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Version proposed',
    type: VersionWriteResultDto,
    example: { versionNo: 1, status: 'proposed', approvalRequestId: '0192f3a0-7c1e-7d2a-9b1f-00000000f301' },
  })
  @ApiStandardErrors(
    ...WRITE,
    'partners.backdated',
    'partners.version_pending',
    'approval.already_pending',
    'approval.no_matching_step',
  )
  setPayout(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: SetPayoutPolicyDto,
  ) {
    return this.configurationService.setPayoutPolicy(staffOrPartner(actor), factoryId, body);
  }

  // --- capability ---------------------------------------------------------------------------------

  @Get('capabilities')
  @Can('partners.read')
  @factoryParam
  @ApiEndpoint({
    id: 'admin.factories.listCapabilities',
    summary: 'List the capabilities of a factory',
    description: 'Product types per print type with sheet and order limits (D-011).',
    implements: ['D-011', 'D-043'],
  })
  @ApiSuccess(200, { description: 'Capabilities', type: [CapabilityDto], example: [CAPABILITY] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  capabilities(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.capability.capabilities(actor, factoryId);
  }

  @Post('capabilities')
  @Can('partners.manage')
  @factoryParam
  @ApiEndpoint({
    id: 'admin.factories.addCapability',
    summary: 'Add a capability to a factory',
    description: 'One per product type and print type; the `capability` step becomes submitted.',
    implements: ['D-011', 'D-043'],
  })
  @ApiBody({
    type: CreateCapabilityDto,
    examples: {
      default: {
        value: { productTypeId: CAPABILITY_IDS.productType, maxSheetWidthMm: 720, maxSheetLengthMm: 1020 },
      },
    },
  })
  @ApiSuccess(201, { description: 'Added', type: CapabilityDto, example: CAPABILITY })
  @ApiStandardErrors(...WRITE, 'http.conflict')
  addCapability(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: CreateCapabilityDto,
  ) {
    return this.capability.addCapability(staffOrPartner(actor), factoryId, body);
  }

  @Patch('capabilities/:capabilityId')
  @Can('partners.manage')
  @factoryParam
  @ApiParam({ name: 'capabilityId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.factories.updateCapability',
    summary: 'Update a capability',
    description: 'Limits and status; deactivating stops routing the type to the factory.',
    implements: ['D-011', 'D-043'],
  })
  @ApiBody({ type: UpdateCapabilityDto, examples: { default: { value: { status: 'inactive' } } } })
  @ApiSuccess(200, { description: 'Updated', type: CapabilityDto, example: CAPABILITY })
  @ApiStandardErrors(...WRITE)
  updateCapability(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('capabilityId', ParseUUIDPipe) capabilityId: string,
    @Body() body: UpdateCapabilityDto,
  ) {
    return this.capability.updateCapability(staffOrPartner(actor), factoryId, capabilityId, body);
  }

  @Get('capability-items/:productTypeId')
  @Can('partners.read')
  @factoryParam
  @typeParam
  @ApiEndpoint({
    id: 'admin.factories.listCapabilityItems',
    summary: 'List what a factory can make for a product type',
    description: 'Materials, finishes, colours, die-cuts, assemblies, print types and patterns.',
    implements: ['D-011', 'D-043'],
  })
  @ApiSuccess(200, { description: 'Items', type: CapabilityItemsDto, example: ITEMS })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  items(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('productTypeId', ParseUUIDPipe) productTypeId: string,
  ) {
    return this.capability.items(actor, factoryId, productTypeId);
  }

  @Put('capability-items/:productTypeId')
  @Can('partners.manage')
  @factoryParam
  @typeParam
  @ApiEndpoint({
    id: 'admin.factories.replaceCapabilityItems',
    summary: 'Replace what a factory can make for a product type',
    description: 'The whole list is replaced; each item is checked against the catalogue.',
    implements: ['D-011', 'D-043'],
  })
  @ApiBody({
    type: ReplaceCapabilityItemsDto,
    examples: { default: { value: { items: [{ kind: 'material', itemId: CAPABILITY_IDS.material }] } } },
  })
  @ApiSuccess(200, { description: 'Items', type: CapabilityItemsDto, example: ITEMS })
  @ApiStandardErrors(...WRITE)
  replaceItems(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('productTypeId', ParseUUIDPipe) productTypeId: string,
    @Body() body: ReplaceCapabilityItemsDto,
  ) {
    return this.capability.replaceItems(staffOrPartner(actor), factoryId, productTypeId, body);
  }

  @Get('machines')
  @Can('partners.read')
  @factoryParam
  @ApiEndpoint({
    id: 'admin.factories.listMachines',
    summary: 'List the machines of a factory',
    description: 'Machines with print type and maximum sheet size.',
    implements: ['D-011'],
  })
  @ApiSuccess(200, { description: 'Machines', type: [MachineDto], example: [MACHINE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  machines(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.capability.machines(actor, factoryId);
  }

  @Post('machines')
  @Can('partners.manage')
  @factoryParam
  @ApiEndpoint({
    id: 'admin.factories.addMachine',
    summary: 'Add a machine to a factory',
    description: 'Audited and published as `factory.machine_added`.',
    implements: ['D-011'],
  })
  @ApiBody({
    type: CreateMachineDto,
    examples: { default: { value: { name: 'Heidelberg 5 สี', maxWidthMm: 720, maxLengthMm: 1020 } } },
  })
  @ApiSuccess(201, { description: 'Added', type: MachineDto, example: MACHINE })
  @ApiStandardErrors(...WRITE)
  addMachine(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: CreateMachineDto,
  ) {
    return this.capability.saveMachine(staffOrPartner(actor), factoryId, body);
  }

  @Patch('machines/:machineId')
  @Can('partners.manage')
  @factoryParam
  @ApiParam({ name: 'machineId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.factories.updateMachine',
    summary: 'Update a machine',
    description: 'Partial update.',
    implements: ['D-011'],
  })
  @ApiBody({ type: UpdateMachineDto, examples: { default: { value: { status: 'inactive' } } } })
  @ApiSuccess(200, { description: 'Updated', type: MachineDto, example: MACHINE })
  @ApiStandardErrors(...WRITE)
  updateMachine(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('machineId', ParseUUIDPipe) machineId: string,
    @Body() body: UpdateMachineDto,
  ) {
    return this.capability.saveMachine(staffOrPartner(actor), factoryId, body, machineId);
  }

  @Get('delivery-zones')
  @Can('partners.read')
  @factoryParam
  @ApiEndpoint({
    id: 'admin.factories.listDeliveryZones',
    summary: 'List the delivery zones of a factory',
    description: 'Zones its own fleet serves (D-013); others fall back to carriers (D-114).',
    implements: ['D-013', 'D-114'],
  })
  @ApiSuccess(200, { description: 'Zones', type: [DeliveryZoneDto], example: [ZONE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  deliveryZones(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.capability.deliveryZones(actor, factoryId);
  }

  @Put('delivery-zones')
  @Can('partners.manage')
  @factoryParam
  @ApiEndpoint({
    id: 'admin.factories.replaceDeliveryZones',
    summary: 'Replace the delivery zones of a factory',
    description:
      'The whole list is replaced; the `delivery_zones` step is approved when at least one zone is set.',
    implements: ['D-013', 'D-114'],
  })
  @ApiBody({
    type: ReplaceDeliveryZonesDto,
    examples: { default: { value: { zones: [{ zoneId: CAPABILITY_IDS.zone, extraLeadDays: 1 }] } } },
  })
  @ApiSuccess(200, { description: 'Zones', type: [DeliveryZoneDto], example: [ZONE] })
  @ApiStandardErrors(...WRITE)
  replaceZones(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: ReplaceDeliveryZonesDto,
  ) {
    return this.capability.replaceDeliveryZones(staffOrPartner(actor), factoryId, body);
  }

  // --- capacity -----------------------------------------------------------------------------------

  @Get('capacity')
  @Can('partners.read')
  @factoryParam
  @ApiEndpoint({
    id: 'admin.factories.getCapacity',
    summary: 'Get weekly capacity, bookings and free capacity',
    description:
      'Per product type for the next weeks (D-101); weeks without configured capacity are omitted.',
    implements: ['D-101'],
  })
  @ApiSuccess(200, { description: 'Weeks', type: [CapacityWeekDto], example: [WEEK] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  getCapacity(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() query: CapacityQuery,
  ) {
    return this.weeks(actor, factoryId, query);
  }

  @Put('capacity-overrides')
  @Can('partners.manage')
  @factoryParam
  @ApiEndpoint({
    id: 'admin.factories.setCapacityOverride',
    summary: 'Override the capacity of one week',
    description: 'E.g. maintenance or extra shifts; `weekStart` is a Monday (Bangkok).',
    implements: ['D-101'],
  })
  @ApiBody({
    type: SetCapacityOverrideDto,
    examples: {
      default: {
        value: {
          productTypeId: CAPABILITY_IDS.productType,
          weekStart: '2026-10-12',
          capacity: 6000,
          reason: 'Machine maintenance',
        },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'The week',
    type: [CapacityWeekDto],
    example: [
      {
        ...WEEK,
        weekStart: '2026-10-12',
        capacity: '6000.000',
        free: '6000.000',
        booked: '0.000',
        source: 'override',
      },
    ],
  })
  @ApiStandardErrors(...WRITE)
  async override(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: SetCapacityOverrideDto,
  ) {
    return (await this.capacity.setOverride(staffOrPartner(actor), factoryId, body)).map(weekDto);
  }

  // --- site visits & agreements ------------------------------------------------------------------

  @Get('site-visits')
  @Can('partners.read')
  @factoryParam
  @ApiEndpoint({
    id: 'admin.factories.listSiteVisits',
    summary: 'List the site visits of a factory',
    description: 'Newest first, with inspectors and photos (D-041).',
    implements: ['D-041'],
  })
  @ApiSuccess(200, { description: 'Visits', type: [SiteVisitDto], example: [SITE_VISIT] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async siteVisitsList(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return (await this.siteVisits.list(actor, factoryId)).map(siteVisitDto);
  }

  @Post('site-visits')
  @Can('partners.site_visits.record')
  @factoryParam
  @ApiEndpoint({
    id: 'admin.factories.recordSiteVisit',
    summary: 'Record a site visit',
    description:
      'Checklist, result, inspectors and photos. A `pass` approves the `site_visit` step and allows activation (D-041).',
    implements: ['D-041'],
  })
  @ApiBody({
    type: RecordSiteVisitDto,
    examples: {
      default: {
        value: {
          visitedOn: '2026-09-25',
          checklistVersion: 'v1',
          checklist: { machinesOk: true },
          result: 'pass',
          inspectorIds: ['0192f3a0-7c1e-7d2a-9b1f-00000000f502'],
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Recorded', type: SiteVisitDto, example: SITE_VISIT })
  @ApiStandardErrors(...WRITE)
  async recordSiteVisit(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: RecordSiteVisitDto,
  ) {
    return siteVisitDto(
      await this.siteVisits.record(staffOrPartner(actor), factoryId, { ...body, notes: body.notes ?? null }),
    );
  }

  @Get('agreements')
  @Can('partners.read')
  @factoryParam
  @ApiEndpoint({
    id: 'admin.factories.listAgreements',
    summary: 'List the agreements of a factory',
    description: 'Each agreement in force and whether the factory accepted that version (D-011, D-044).',
    implements: ['D-011', 'D-044'],
  })
  @ApiSuccess(200, {
    description: 'Agreements',
    type: [AgreementStatusDto],
    example: [AGREEMENT_STATUS_EXAMPLE],
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  agreementStatus(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.agreements.status(actor, factoryId);
  }

  @Post('agreements/:key/signed-copies')
  @HttpCode(200)
  @Can('partners.manage')
  @factoryParam
  @ApiParam({ name: 'key', example: 'partner_agreement' })
  @ApiEndpoint({
    id: 'admin.factories.recordSignedAgreement',
    summary: 'Record a signed copy of an agreement',
    description:
      'When the factory signs on paper: the scan is the evidence (`signed_upload`), recorded by the Partner team.',
    implements: ['D-011', 'D-044'],
  })
  @ApiBody({
    type: RecordSignedAgreementDto,
    examples: { default: { value: { signedFileId: '0192f3a0-7c1e-7d2a-9b1f-00000000f501' } } },
  })
  @ApiSuccess(200, {
    description: 'Agreements',
    type: [AgreementStatusDto],
    example: [
      {
        ...AGREEMENT_STATUS_EXAMPLE,
        accepted: true,
        acceptedAt: '2026-09-26T10:00:00+07:00',
        method: 'signed_upload',
      },
    ],
  })
  @ApiStandardErrors(...WRITE, 'partners.agreement_not_published', 'partners.agreement_already_accepted')
  recordSigned(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('key') key: string,
    @Body() body: RecordSignedAgreementDto,
    @Req() req: Request,
  ) {
    return this.agreements.accept(staffOrPartner(actor), factoryId, key, {
      ip: clientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
      signedFileId: body.signedFileId,
    });
  }
}

@ApiSurface('partner', 'factories')
@Controller('factories/:factoryId')
export class PartnerFactoryOperationsController extends FactoryReads {
  @Get('configuration')
  @Can('factory_profile.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.factories.getConfiguration',
    summary: 'Get my factory’s configuration',
    description:
      'Pricing mode, tiers, capacity, tolerance and payout policy agreed with Packio (own factory only, D-044).',
    implements: ['D-042', 'D-043', 'D-101', 'D-021', 'D-022'],
  })
  @ApiSuccess(200, {
    description: 'Configuration',
    type: FactoryConfigurationDto,
    example: CONFIGURATION_EXAMPLE,
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  configuration(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.configurationService.configuration(actor, factoryId);
  }

  @Get('capabilities')
  @Can('factory_profile.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.factories.listCapabilities',
    summary: 'List my factory’s capabilities',
    description: 'As recorded by the Packio Partner team (D-011).',
    implements: ['D-011'],
  })
  @ApiSuccess(200, { description: 'Capabilities', type: [CapabilityDto], example: [CAPABILITY] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  capabilities(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.capability.capabilities(actor, factoryId);
  }

  @Get('delivery-zones')
  @Can('factory_profile.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.factories.listDeliveryZones',
    summary: 'List my factory’s delivery zones',
    description: 'Zones the factory fleet serves (D-013).',
    implements: ['D-013'],
  })
  @ApiSuccess(200, { description: 'Zones', type: [DeliveryZoneDto], example: [ZONE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  deliveryZones(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.capability.deliveryZones(actor, factoryId);
  }

  @Get('capacity')
  @Can('factory_capacity.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.factories.getCapacity',
    summary: 'Get my factory’s weekly capacity and bookings',
    description: 'Per product type for the next weeks (D-101).',
    implements: ['D-101'],
  })
  @ApiSuccess(200, { description: 'Weeks', type: [CapacityWeekDto], example: [WEEK] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  getCapacity(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Query() query: CapacityQuery,
  ) {
    return this.weeks(actor, factoryId, query);
  }

  @Get('agreements')
  @Can('factory_profile.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.factories.listAgreements',
    summary: 'List the agreements to accept',
    description: 'The text of each agreement in force and whether my factory accepted it (D-011, D-044).',
    implements: ['D-011', 'D-044'],
  })
  @ApiSuccess(200, {
    description: 'Agreements',
    type: [AgreementStatusDto],
    example: [AGREEMENT_STATUS_EXAMPLE],
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  agreementStatus(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.agreements.status(actor, factoryId);
  }

  @Post('agreements/:key/acceptances')
  @HttpCode(200)
  @Can('factory_agreements.accept')
  @factoryParam
  @ApiParam({ name: 'key', example: 'partner_agreement' })
  @ApiEndpoint({
    id: 'partner.factories.acceptAgreement',
    summary: 'Accept an agreement for my factory',
    description:
      'E-acceptance of the version in force: who, when, IP and user agent are kept with a SHA-256 evidence digest over the ' +
      'text version. The `agreement` step is approved once every agreement is accepted (D-011).',
    implements: ['D-011', 'D-044'],
  })
  @ApiSuccess(200, {
    description: 'Agreements',
    type: [AgreementStatusDto],
    example: [
      {
        ...AGREEMENT_STATUS_EXAMPLE,
        accepted: true,
        acceptedAt: '2026-09-26T10:00:00+07:00',
        method: 'e_acceptance',
      },
    ],
  })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    'partners.agreement_not_published',
    'partners.agreement_already_accepted',
  )
  accept(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Param('key') key: string,
    @Req() req: Request,
  ) {
    return this.agreements.accept(staffOrPartner(actor), factoryId, key, {
      ip: clientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    });
  }
}

@ApiSurface('admin', 'agreementTemplates')
@Controller('agreement-templates')
export class AgreementTemplatesController {
  constructor(private readonly agreements: AgreementsService) {}

  @Get()
  @Can('partners.read')
  @ApiEndpoint({
    id: 'admin.agreementTemplates.list',
    summary: 'List the partner agreement templates',
    description: 'Keys and every published version (D-011, D-044).',
    implements: ['D-011', 'D-044'],
  })
  @ApiSuccess(200, {
    description: 'Templates',
    type: [AgreementTemplateDto],
    example: [
      {
        key: 'partner_agreement',
        name: 'Partner agreement',
        description: 'D-011 partner agreement',
        versions: [],
      },
    ],
  })
  @ApiStandardErrors('validation.failed')
  async list(): Promise<AgreementTemplateDto[]> {
    return (await this.agreements.templates()).map((t) => ({
      key: t.key,
      name: t.name,
      description: t.description,
      versions: t.versions.map((v) => ({
        versionNo: v.versionNo,
        effectiveFrom: toBangkokIso(v.effectiveFrom),
        textTh: v.textTh,
        textEn: v.textEn,
        textSha256: Buffer.from(v.textSha256).toString('hex'),
        reason: v.reason,
      })),
    }));
  }

  @Post(':key/versions')
  @Can('agreements.manage')
  @ApiParam({ name: 'key', example: 'partner_agreement' })
  @ApiEndpoint({
    id: 'admin.agreementTemplates.publishVersion',
    summary: 'Publish a new version of an agreement',
    description:
      'Legal text from counsel (ADR-0005: effective-dated, never back-dated). Factories accept each new version; earlier ' +
      'acceptances keep referring to the version they accepted.',
    implements: ['D-011', 'D-044'],
  })
  @ApiBody({
    type: PublishAgreementVersionDto,
    examples: {
      default: {
        value: { textTh: 'ข้อตกลงการเป็นพันธมิตร …', reason: 'First publication by legal counsel' },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Published',
    type: AgreementTemplateDto,
    example: {
      key: 'partner_agreement',
      name: 'Partner agreement',
      description: 'D-011 partner agreement',
      versions: [
        {
          versionNo: 1,
          effectiveFrom: '2026-09-26T10:00:00+07:00',
          textTh: 'ข้อตกลงการเป็นพันธมิตร …',
          textEn: null,
          textSha256: '4f1c…',
          reason: 'First publication by legal counsel',
        },
      ],
    },
  })
  @ApiStandardErrors(...WRITE, 'partners.backdated')
  async publish(
    @CurrentActor() actor: Actor,
    @Param('key') key: string,
    @Body() body: PublishAgreementVersionDto,
  ): Promise<AgreementTemplateDto> {
    await this.agreements.publish(staffOrPartner(actor), key, body);
    return (await this.list()).find((t) => t.key === key)!;
  }
}
