import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { IfMatch, UseEtag } from '@common/etag/etag.interceptor';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { paginated, toSkipTake } from '@common/pagination/pagination';
import { PageQuery } from '@common/pagination/pagination.dto';
import { Body, Controller, Get, HttpCode, Post, Put, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsInt, IsString, Min, ValidateNested } from 'class-validator';

class LineDto {
  @IsString()
  sku!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateThingDto {
  @IsString()
  name!: string;

  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => LineDto)
  items!: LineDto[];
}

interface Thing {
  id: string;
  version: number;
  name: string;
}

/**
 * Test-only endpoints (never part of the contract) that exercise the global HTTP pipeline:
 * validation, problem details, idempotency, ETag/If-Match and pagination.
 */
@Controller('pipeline-test')
export class PipelineTestController {
  calls = 0;
  private thing: Thing = { id: '0d0c7a4e-5b0e-4c55-9d7c-3f2b8a1e6c11', version: 1, name: 'Sample' };

  @Post('things')
  @Idempotent()
  create(@Body() body: CreateThingDto): { callNumber: number; name: string } {
    this.calls += 1;
    return { callNumber: this.calls, name: body.name };
  }

  @Post('fail-once')
  @Idempotent()
  @HttpCode(200)
  failOnce(): { ok: true } {
    this.calls += 1;
    if (this.calls === 1) throw new DomainException('http.conflict');
    return { ok: true };
  }

  @Get('thing')
  @UseEtag((t: Thing) => etagOf(t.id, t.version))
  getThing(): Thing {
    return this.thing;
  }

  @Put('thing')
  @UseEtag((t: Thing) => etagOf(t.id, t.version))
  updateThing(@IfMatch() ifMatch: string | undefined, @Body() body: { name?: unknown }): Thing {
    assertIfMatch(ifMatch, etagOf(this.thing.id, this.thing.version));
    this.thing = { ...this.thing, version: this.thing.version + 1, name: String(body.name) };
    return this.thing;
  }

  @Get('page')
  page(@Query() query: PageQuery) {
    const all = Array.from({ length: 30 }, (_, i) => ({ n: i + 1 }));
    const { skip, take } = toSkipTake(query);
    return paginated(all.slice(skip, skip + take), all.length, query);
  }

  @Get('boom')
  boom(): never {
    throw new Error('secret internal detail');
  }
}
