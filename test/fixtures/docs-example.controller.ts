import { etagOf } from '@common/etag/etag';
import { UseEtag } from '@common/etag/etag.interceptor';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiConcurrency, ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { paginated } from '@common/pagination/pagination';
import { PageQuery } from '@common/pagination/pagination.dto';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBody, ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class ExampleDto {
  @ApiProperty({ format: 'uuid', example: '0d0c7a4e-5b0e-4c55-9d7c-3f2b8a1e6c11' })
  id!: string;

  @ApiProperty({ example: 'Mailer box A4', description: 'Display name' })
  name!: string;

  @ApiProperty({ type: 'integer', example: 3, description: 'Aggregate version' })
  version!: number;
}

export class CreateExampleDto {
  @ApiProperty({ example: 'Mailer box A4', maxLength: 120 })
  @IsString()
  @MaxLength(120)
  name!: string;
}

const EXAMPLE: ExampleDto = { id: '0d0c7a4e-5b0e-4c55-9d7c-3f2b8a1e6c11', name: 'Mailer box A4', version: 3 };

/** Test-only controller using every documentation decorator (never in the real contract). */
@ApiSurface('admin', 'examples')
@Controller('admin/examples')
export class DocsExampleController {
  @Get()
  @ApiEndpoint({
    id: 'admin.examples.list',
    summary: 'List examples',
    description: 'Paged list for the admin zone.',
    implements: ['D-052'],
  })
  @ApiPaginated(ExampleDto, { example: EXAMPLE })
  @ApiStandardErrors()
  list(@Query() query: PageQuery) {
    return paginated([EXAMPLE], 1, query);
  }

  @Get(':exampleId')
  @ApiEndpoint({
    id: 'admin.examples.get',
    summary: 'Get one example',
    description: 'By id.',
    implements: ['D-052'],
  })
  @UseEtag((e: ExampleDto) => etagOf(e.id, e.version))
  @ApiSuccess(200, { description: 'The example', type: ExampleDto, example: EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  get(@Param('exampleId', ParseUUIDPipe) _id: string): ExampleDto {
    return EXAMPLE;
  }

  @Post()
  @Idempotent()
  @ApiEndpoint({
    id: 'admin.examples.create',
    summary: 'Create an example',
    description: 'Creates.',
    implements: ['D-052'],
  })
  @ApiBody({ type: CreateExampleDto, examples: { default: { value: { name: 'Mailer box A4' } } } })
  @ApiSuccess(201, { description: 'Created', type: ExampleDto, example: EXAMPLE, headers: ['Location'] })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed')
  create(@Body() _body: CreateExampleDto): ExampleDto {
    return EXAMPLE;
  }

  @Put(':exampleId')
  @ApiConcurrency()
  @ApiEndpoint({
    id: 'admin.examples.update',
    summary: 'Update an example',
    description: 'Updates.',
    implements: ['D-052'],
  })
  @ApiBody({ type: CreateExampleDto, examples: { default: { value: { name: 'Mailer box A5' } } } })
  @ApiSuccess(200, { description: 'Updated', type: ExampleDto, example: EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'http.not_found', 'validation.failed', 'http.conflict')
  update(@Param('exampleId', ParseUUIDPipe) _id: string, @Body() _body: CreateExampleDto): ExampleDto {
    return EXAMPLE;
  }
}
