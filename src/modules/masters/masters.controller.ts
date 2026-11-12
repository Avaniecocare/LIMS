import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, ValidationPipe, type Type } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { AppError, flattenValidation } from '../../common/errors.js';
import { OkDto } from '../auth/auth.dto.js';
import { Perm } from '../auth/decorators.js';
import { readUpload } from '../files/files.controller.js';
import { MASTERS } from './definitions.js';
import * as D from './masters.dto.js';
import { MastersService } from './masters.service.js';

const pipe = (expectedType: Type<unknown>) =>
  new ValidationPipe({
    expectedType,
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => new AppError('VALIDATION_FAILED', 400, 'Please check the highlighted fields', flattenValidation(errors)),
  });

/** One typed controller per master, all sharing the same behaviour. */
export const MASTER_TYPES: Record<string, { input: Type<object>; dto: Type<unknown>; page: Type<unknown> }> = {
  departments: { input: D.DepartmentInput, dto: D.DepartmentDto, page: D.DepartmentPageDto },
  units: { input: D.UnitInput, dto: D.UnitDto, page: D.UnitPageDto },
  'unit-conversions': { input: D.UnitConversionInput, dto: D.UnitConversionDto, page: D.UnitConversionPageDto },
  'test-methods': { input: D.TestMethodInput, dto: D.TestMethodDto, page: D.TestMethodPageDto },
  tests: { input: D.TestMasterInput, dto: D.TestMasterDto, page: D.TestMasterPageDto },
  'test-parameters': { input: D.TestParameterInput, dto: D.TestParameterDto, page: D.TestParameterPageDto },
  specifications: { input: D.SpecificationInput, dto: D.SpecificationDto, page: D.SpecificationPageDto },
  'test-groups': { input: D.TestGroupInput, dto: D.TestGroupDto, page: D.TestGroupPageDto },
  'result-sets': { input: D.ResultSetInput, dto: D.ResultSetDto, page: D.ResultSetPageDto },
  formulas: { input: D.FormulaInput, dto: D.FormulaDto, page: D.FormulaPageDto },
  instruments: { input: D.InstrumentInput, dto: D.InstrumentDto, page: D.InstrumentPageDto },
  'standard-rates': { input: D.StandardRateInput, dto: D.StandardRateDto, page: D.StandardRatePageDto },
  'customer-rates': { input: D.CustomerRateInput, dto: D.CustomerRateDto, page: D.CustomerRatePageDto },
  'remark-templates': { input: D.RemarkTemplateInput, dto: D.RemarkTemplateDto, page: D.RemarkTemplatePageDto },
  lookups: { input: D.LookupInput, dto: D.LookupDto, page: D.LookupPageDto },
};

function masterController(key: string): Type<unknown> {
  const def = MASTERS.find((m) => m.key === key)!;
  const types = MASTER_TYPES[key];

  @ApiTags('masters')
  @Controller(`masters/${key}`)
  class C {
    constructor(readonly masters: MastersService) {}

    @Get()
    @Perm(def.view)
    @ApiOkResponse({ type: types.page })
    list(@Query() q: D.MasterQuery) {
      return this.masters.list(key, q);
    }

    @Get(':id')
    @Perm(def.view)
    @ApiOkResponse({ type: types.dto })
    get(@Param('id', ParseUUIDPipe) id: string) {
      return this.masters.get(key, id);
    }

    @Post()
    @Perm(def.edit)
    @ApiBody({ type: types.input })
    @ApiOkResponse({ type: types.dto })
    create(@Body(pipe(types.input)) body: object) {
      return this.masters.create(key, body);
    }

    @Patch(':id')
    @Perm(def.edit)
    @ApiBody({ type: types.input })
    @ApiOkResponse({ type: types.dto })
    update(@Param('id', ParseUUIDPipe) id: string, @Body(pipe(types.input)) body: object) {
      return this.masters.update(key, id, body);
    }

    @Delete(':id')
    @Perm(def.edit)
    @ApiOkResponse({ type: OkDto })
    async remove(@Param('id', ParseUUIDPipe) id: string) {
      await this.masters.remove(key, id);
      return { ok: true };
    }

    @Get(':id/history')
    @Perm(def.view)
    @ApiOkResponse({ type: [D.HistoryEntryDto] })
    history(@Param('id', ParseUUIDPipe) id: string) {
      return this.masters.history(key, id);
    }

    @Post('import')
    @HttpCode(200)
    @Perm(def.edit)
    @ApiConsumes('multipart/form-data')
    @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })
    @ApiOkResponse({ type: D.ImportResultDto })
    async importFile(@Req() req: FastifyRequest) {
      const f = await readUpload(req);
      return this.masters.importExcel(key, f.buffer, types.input);
    }
  }
  const name = `${key.replace(/(^|-)(\w)/g, (_, __, c: string) => c.toUpperCase())}Controller`;
  Object.defineProperty(C, 'name', { value: name });
  return C;
}

export const MASTER_CONTROLLERS = MASTERS.map((m) => masterController(m.key));

@ApiTags('masters')
@Controller('masters')
export class MasterToolsController {
  constructor(private readonly masters: MastersService) {}

  /** Test console for the formula master; also validates the expression. */
  @Post('formula-console')
  @HttpCode(200)
  @Perm('masters.view')
  @ApiOkResponse({ type: D.FormulaTestResultDto })
  formulaConsole(@Body() dto: D.FormulaTestInput) {
    return this.masters.testFormula(dto);
  }

  @Post('convert')
  @HttpCode(200)
  @Perm('masters.view', 'tests.work')
  @ApiOkResponse({ type: D.ConvertResultDto })
  convert(@Body() dto: D.ConvertInput) {
    return this.masters.convert(dto);
  }

  /** Rate priority check: customer rate, then standard rate. */
  @Get('rate-lookup')
  @Perm('rates.view')
  @ApiOkResponse({ type: D.RateLookupDto })
  rateLookup(@Query() q: D.RateLookupQuery) {
    return this.masters.lookupRate(q.testId, q.customerId, q.on ? new Date(q.on) : undefined);
  }
}
