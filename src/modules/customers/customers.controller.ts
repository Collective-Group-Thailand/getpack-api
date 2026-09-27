import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { IfMatch } from '@common/etag/etag.interceptor';
import {
  ApiConcurrency,
  ApiEndpoint,
  ApiEtag,
  ApiStandardErrors,
  ApiSuccess,
} from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { PageQuery } from '@common/pagination/pagination.dto';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { type Response } from 'express';

import { addressDto, adminCustomerDto, customerProfileDto, taxProfileDto } from './customer-views';
import {
  ADDRESS_EXAMPLE,
  ADDRESS_INPUT_EXAMPLE,
  AddressDto,
  AddressInputDto,
  AddressListQuery,
  ADMIN_CUSTOMER_EXAMPLE,
  AdminCustomerDto,
  CUSTOMER_PROFILE_EXAMPLE,
  CustomerListQuery,
  CustomerProfileDto,
  FindOrCreateCustomerDto,
  FindOrCreateCustomerResultDto,
  TAX_PROFILE_EXAMPLE,
  TAX_PROFILE_INPUT_EXAMPLE,
  TaxProfileDto,
  TaxProfileInputDto,
  UpdateAddressDto,
  UpdateCustomerProfileDto,
  UpdateTaxProfileDto,
} from './customers.dto';
import { addressEtag, customerEtag, CustomersService } from './customers.service';

const DECISIONS = ['D-142', 'D-174', 'D-092'];
const WRITE = ['http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed'] as const;
const addressParam = ApiParam({ name: 'addressId', format: 'uuid' });
const taxProfileParam = ApiParam({ name: 'taxProfileId', format: 'uuid' });
const customerParam = ApiParam({ name: 'customerId', format: 'uuid' });

function customerUser(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}

function staffUser(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

const page = <T>(data: T[], total: number, q: PageQuery) => ({
  data,
  meta: { page: q.page, perPage: q.perPage, total },
});

// --- store ----------------------------------------------------------------------------------------

@ApiSurface('store', 'customerProfile')
@Controller('customer-profile')
export class StoreCustomerProfileController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @ApiEndpoint({
    id: 'store.customerProfile.get',
    summary: 'Get my customer profile',
    description:
      'Customer type (individual / juristic / government drives payment schedules, D-020) and the customer ' +
      'code, assigned at the first checkout.',
    implements: ['D-020', 'D-092'],
  })
  @ApiEtag()
  @ApiSuccess(200, { description: 'Profile', type: CustomerProfileDto, example: CUSTOMER_PROFILE_EXAMPLE })
  @ApiStandardErrors('http.not_found')
  async get(@CurrentActor() actor: Actor, @Res({ passthrough: true }) res: Response) {
    const row = await this.customers.profile(customerUser(actor).userId);
    res.setHeader('ETag', customerEtag(row));
    return customerProfileDto(row);
  }

  @Patch()
  @ApiEndpoint({
    id: 'store.customerProfile.update',
    summary: 'Update my customer profile',
    description: 'Names and customer type; guarded by `If-Match` (D-020).',
    implements: ['D-020'],
  })
  @ApiConcurrency()
  @ApiBody({ type: UpdateCustomerProfileDto, examples: { default: { value: { customerType: 'juristic' } } } })
  @ApiSuccess(200, { description: 'Updated', type: CustomerProfileDto, example: CUSTOMER_PROFILE_EXAMPLE })
  @ApiStandardErrors(...WRITE)
  async update(
    @CurrentActor() actor: Actor,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: UpdateCustomerProfileDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = customerUser(actor);
    const row = await this.customers.updateProfile(user, user.userId, ifMatch, body);
    res.setHeader('ETag', customerEtag(row));
    return customerProfileDto(row);
  }
}

@ApiSurface('store', 'addresses')
@Controller('addresses')
export class StoreAddressesController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @ApiEndpoint({
    id: 'store.addresses.list',
    summary: 'List my addresses',
    description: 'Delivery and billing addresses, default first (D-142: orders copy a snapshot).',
    implements: DECISIONS,
  })
  @ApiPaginated(AddressDto, { example: ADDRESS_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() q: AddressListQuery) {
    const { rows, total } = await this.customers.listAddresses(customerUser(actor).userId, q.kind, q.page, q.perPage);
    return page(rows.map(addressDto), total, q);
  }

  @Post()
  @ApiEndpoint({
    id: 'store.addresses.create',
    summary: 'Add an address',
    description:
      'The phone is stored as E.164; a subdistrict must belong to the province and match the postcode. The ' +
      'first address of a kind becomes the default (D-142).',
    implements: DECISIONS,
  })
  @ApiBody({ type: AddressInputDto, examples: { default: { value: ADDRESS_INPUT_EXAMPLE } } })
  @ApiEtag()
  @ApiSuccess(201, { description: 'Created', type: AddressDto, example: ADDRESS_EXAMPLE })
  @ApiStandardErrors(...WRITE)
  async create(
    @CurrentActor() actor: Actor,
    @Body() body: AddressInputDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = customerUser(actor);
    const row = await this.customers.createAddress(user, user.userId, body);
    res.setHeader('ETag', addressEtag(row));
    return addressDto(row);
  }

  @Get(':addressId')
  @addressParam
  @ApiEndpoint({
    id: 'store.addresses.get',
    summary: 'Get one of my addresses',
    description: 'Only the owner; anything else is 404.',
    implements: DECISIONS,
  })
  @ApiEtag()
  @ApiSuccess(200, { description: 'Address', type: AddressDto, example: ADDRESS_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @CurrentActor() actor: Actor,
    @Param('addressId', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.customers.address(customerUser(actor).userId, id);
    res.setHeader('ETag', addressEtag(row));
    return addressDto(row);
  }

  @Patch(':addressId')
  @addressParam
  @ApiEndpoint({
    id: 'store.addresses.update',
    summary: 'Update an address',
    description: 'Partial update guarded by `If-Match`; orders placed before keep their snapshot (D-142).',
    implements: DECISIONS,
  })
  @ApiConcurrency()
  @ApiBody({ type: UpdateAddressDto, examples: { default: { value: { label: 'โกดัง', isDefault: true } } } })
  @ApiSuccess(200, { description: 'Updated', type: AddressDto, example: ADDRESS_EXAMPLE })
  @ApiStandardErrors(...WRITE)
  async update(
    @CurrentActor() actor: Actor,
    @Param('addressId', ParseUUIDPipe) id: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: UpdateAddressDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = customerUser(actor);
    const row = await this.customers.updateAddress(user, user.userId, id, ifMatch, body);
    res.setHeader('ETag', addressEtag(row));
    return addressDto(row);
  }

  @Delete(':addressId')
  @HttpCode(204)
  @addressParam
  @ApiEndpoint({
    id: 'store.addresses.delete',
    summary: 'Remove an address',
    description: 'Soft delete (schema-design §1.6); carts and orders keep their snapshot (D-142).',
    implements: DECISIONS,
  })
  @ApiSuccess(204, { description: 'Removed' })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'concurrency.stale')
  async remove(
    @CurrentActor() actor: Actor,
    @Param('addressId', ParseUUIDPipe) id: string,
    @IfMatch() ifMatch: string | undefined,
  ): Promise<void> {
    const user = customerUser(actor);
    await this.customers.deleteAddress(user, user.userId, id, ifMatch);
  }
}

@ApiSurface('store', 'taxProfiles')
@Controller('tax-profiles')
export class StoreTaxProfilesController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @ApiEndpoint({
    id: 'store.taxProfiles.list',
    summary: 'List my tax-invoice profiles',
    description:
      'Buyer data for full-form tax invoices issued by the entity (D-092): tax id, head office / branch and ' +
      'whether the customer withholds tax (D-174).',
    implements: DECISIONS,
  })
  @ApiPaginated(TaxProfileDto, { example: TAX_PROFILE_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() q: PageQuery) {
    const { rows, total } = await this.customers.listTaxProfiles(customerUser(actor).userId, q.page, q.perPage);
    return page(rows.map(taxProfileDto), total, q);
  }

  @Post()
  @ApiEndpoint({
    id: 'store.taxProfiles.create',
    summary: 'Add a tax-invoice profile',
    description:
      'The tax id check digit is validated; head office is branch 00000, a branch needs its own code. ' +
      '`withholdsTax` makes checkout show the expected cash after withholding (D-174).',
    implements: DECISIONS,
  })
  @ApiBody({ type: TaxProfileInputDto, examples: { default: { value: TAX_PROFILE_INPUT_EXAMPLE } } })
  @ApiEtag()
  @ApiSuccess(201, { description: 'Created', type: TaxProfileDto, example: TAX_PROFILE_EXAMPLE })
  @ApiStandardErrors(...WRITE)
  async create(
    @CurrentActor() actor: Actor,
    @Body() body: TaxProfileInputDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = customerUser(actor);
    const row = await this.customers.createTaxProfile(user, user.userId, body);
    res.setHeader('ETag', addressEtag(row));
    return taxProfileDto(row);
  }

  @Get(':taxProfileId')
  @taxProfileParam
  @ApiEndpoint({
    id: 'store.taxProfiles.get',
    summary: 'Get one of my tax-invoice profiles',
    description: 'Only the owner; anything else is 404.',
    implements: DECISIONS,
  })
  @ApiEtag()
  @ApiSuccess(200, { description: 'Tax profile', type: TaxProfileDto, example: TAX_PROFILE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @CurrentActor() actor: Actor,
    @Param('taxProfileId', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.customers.taxProfile(customerUser(actor).userId, id);
    res.setHeader('ETag', addressEtag(row));
    return taxProfileDto(row);
  }

  @Patch(':taxProfileId')
  @taxProfileParam
  @ApiEndpoint({
    id: 'store.taxProfiles.update',
    summary: 'Update a tax-invoice profile',
    description:
      'Name, address, withholding flag and document e-mail; tax id and branch never change (add a new ' +
      'profile instead). Guarded by `If-Match`.',
    implements: DECISIONS,
  })
  @ApiConcurrency()
  @ApiBody({ type: UpdateTaxProfileDto, examples: { default: { value: { withholdsTax: true } } } })
  @ApiSuccess(200, { description: 'Updated', type: TaxProfileDto, example: TAX_PROFILE_EXAMPLE })
  @ApiStandardErrors(...WRITE)
  async update(
    @CurrentActor() actor: Actor,
    @Param('taxProfileId', ParseUUIDPipe) id: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: UpdateTaxProfileDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = customerUser(actor);
    const row = await this.customers.updateTaxProfile(user, user.userId, id, ifMatch, body);
    res.setHeader('ETag', addressEtag(row));
    return taxProfileDto(row);
  }

  @Delete(':taxProfileId')
  @HttpCode(204)
  @taxProfileParam
  @ApiEndpoint({
    id: 'store.taxProfiles.delete',
    summary: 'Remove a tax-invoice profile',
    description: 'Soft delete; issued documents and orders keep their buyer snapshot.',
    implements: DECISIONS,
  })
  @ApiSuccess(204, { description: 'Removed' })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'concurrency.stale')
  async remove(
    @CurrentActor() actor: Actor,
    @Param('taxProfileId', ParseUUIDPipe) id: string,
    @IfMatch() ifMatch: string | undefined,
  ): Promise<void> {
    const user = customerUser(actor);
    await this.customers.deleteTaxProfile(user, user.userId, id, ifMatch);
  }
}

// --- admin (CS) -----------------------------------------------------------------------------------

@ApiSurface('admin', 'customers')
@Controller('customers')
export class AdminCustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @Can('customers.read')
  @ApiEndpoint({
    id: 'admin.customers.list',
    summary: 'Find customers',
    description: 'Search by phone (Thai or E.164), e-mail, name or customer code; newest first.',
    implements: ['D-092'],
  })
  @ApiPaginated(AdminCustomerDto, { example: ADMIN_CUSTOMER_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() q: CustomerListQuery) {
    const { rows, total } = await this.customers.search(q.q, q.page, q.perPage);
    return page(rows.map(adminCustomerDto), total, q);
  }

  @Post()
  @Can('customers.manage')
  @ApiEndpoint({
    id: 'admin.customers.findOrCreate',
    summary: 'Find or create a customer (CS)',
    description:
      'CS looks the customer up by phone or e-mail and creates the account when none matches, so orders can be ' +
      'placed on their behalf. A created account gets its customer code (series `customer`) and publishes ' +
      '`customer.registered` (via `cs`). Returns 200 with `created: false` when an account matched.',
    implements: ['D-092'],
  })
  @ApiBody({
    type: FindOrCreateCustomerDto,
    examples: { default: { value: { phone: '0810001234', displayName: 'สมชาย ทดสอบ' } } },
  })
  @ApiSuccess(201, {
    description: 'Created (or 200 when found)',
    type: FindOrCreateCustomerResultDto,
    example: { created: true, customer: ADMIN_CUSTOMER_EXAMPLE },
  })
  @ApiSuccess(200, {
    description: 'An existing customer matched',
    type: FindOrCreateCustomerResultDto,
    example: { created: false, customer: ADMIN_CUSTOMER_EXAMPLE },
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed', 'numbering.series_missing')
  async findOrCreate(
    @CurrentActor() actor: Actor,
    @Body() body: FindOrCreateCustomerDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<FindOrCreateCustomerResultDto> {
    const result = await this.customers.findOrCreate(staffUser(actor), body);
    if (!result.created) res.status(200);
    return { created: result.created, customer: adminCustomerDto(result.customer) };
  }

  @Get(':customerId')
  @Can('customers.read')
  @customerParam
  @ApiEndpoint({
    id: 'admin.customers.get',
    summary: 'Get a customer',
    description: 'Account and profile (customer type, code, how it was created).',
    implements: ['D-092'],
  })
  @ApiSuccess(200, { description: 'Customer', type: AdminCustomerDto, example: ADMIN_CUSTOMER_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('customerId', ParseUUIDPipe) customerId: string) {
    const id = await this.customers.customerIdOf(customerId);
    return adminCustomerDto(await this.customers.profile(id));
  }

  @Get(':customerId/addresses')
  @Can('customers.read')
  @customerParam
  @ApiEndpoint({
    id: 'admin.customers.listAddresses',
    summary: "List a customer's addresses",
    description: 'Same rules as the customer’s own list (D-142).',
    implements: DECISIONS,
  })
  @ApiPaginated(AddressDto, { example: ADDRESS_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async listAddresses(@Param('customerId', ParseUUIDPipe) customerId: string, @Query() q: AddressListQuery) {
    const id = await this.customers.customerIdOf(customerId);
    const { rows, total } = await this.customers.listAddresses(id, q.kind, q.page, q.perPage);
    return page(rows.map(addressDto), total, q);
  }

  @Post(':customerId/addresses')
  @Can('customers.manage')
  @customerParam
  @ApiEndpoint({
    id: 'admin.customers.createAddress',
    summary: 'Add an address for a customer (CS)',
    description: 'CS enters an address on the customer’s behalf; recorded with the CS user (D-142).',
    implements: DECISIONS,
  })
  @ApiBody({ type: AddressInputDto, examples: { default: { value: ADDRESS_INPUT_EXAMPLE } } })
  @ApiEtag()
  @ApiSuccess(201, { description: 'Created', type: AddressDto, example: ADDRESS_EXAMPLE })
  @ApiStandardErrors(...WRITE)
  async createAddress(
    @CurrentActor() actor: Actor,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() body: AddressInputDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const id = await this.customers.customerIdOf(customerId);
    const row = await this.customers.createAddress(staffUser(actor), id, body);
    res.setHeader('ETag', addressEtag(row));
    return addressDto(row);
  }

  @Patch(':customerId/addresses/:addressId')
  @Can('customers.manage')
  @customerParam
  @addressParam
  @ApiEndpoint({
    id: 'admin.customers.updateAddress',
    summary: "Update a customer's address (CS)",
    description: 'Guarded by `If-Match`; orders keep their snapshot (D-142).',
    implements: DECISIONS,
  })
  @ApiConcurrency()
  @ApiBody({ type: UpdateAddressDto, examples: { default: { value: { label: 'โกดัง' } } } })
  @ApiSuccess(200, { description: 'Updated', type: AddressDto, example: ADDRESS_EXAMPLE })
  @ApiStandardErrors(...WRITE)
  async updateAddress(
    @CurrentActor() actor: Actor,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: UpdateAddressDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const id = await this.customers.customerIdOf(customerId);
    const row = await this.customers.updateAddress(staffUser(actor), id, addressId, ifMatch, body);
    res.setHeader('ETag', addressEtag(row));
    return addressDto(row);
  }

  @Get(':customerId/tax-profiles')
  @Can('customers.read')
  @customerParam
  @ApiEndpoint({
    id: 'admin.customers.listTaxProfiles',
    summary: "List a customer's tax-invoice profiles",
    description: 'Buyer data and withholding flag (D-174).',
    implements: DECISIONS,
  })
  @ApiPaginated(TaxProfileDto, { example: TAX_PROFILE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async listTaxProfiles(@Param('customerId', ParseUUIDPipe) customerId: string, @Query() q: PageQuery) {
    const id = await this.customers.customerIdOf(customerId);
    const { rows, total } = await this.customers.listTaxProfiles(id, q.page, q.perPage);
    return page(rows.map(taxProfileDto), total, q);
  }

  @Post(':customerId/tax-profiles')
  @Can('customers.manage')
  @customerParam
  @ApiEndpoint({
    id: 'admin.customers.createTaxProfile',
    summary: 'Add a tax-invoice profile for a customer (CS)',
    description: 'Same validation as the customer’s own (check digit, head office / branch, D-174).',
    implements: DECISIONS,
  })
  @ApiBody({ type: TaxProfileInputDto, examples: { default: { value: TAX_PROFILE_INPUT_EXAMPLE } } })
  @ApiEtag()
  @ApiSuccess(201, { description: 'Created', type: TaxProfileDto, example: TAX_PROFILE_EXAMPLE })
  @ApiStandardErrors(...WRITE)
  async createTaxProfile(
    @CurrentActor() actor: Actor,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() body: TaxProfileInputDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const id = await this.customers.customerIdOf(customerId);
    const row = await this.customers.createTaxProfile(staffUser(actor), id, body);
    res.setHeader('ETag', addressEtag(row));
    return taxProfileDto(row);
  }
}
