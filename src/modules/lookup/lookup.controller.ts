import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Perm } from '../auth/decorators.js';
import { GstinLookupDto, PincodeLookupDto, StateDto } from './lookup.dto.js';
import { LookupService } from './lookup.service.js';


/** Auto-fill helpers for anyone who types customer or job addresses. */
const FORM_EDITORS = ['customers.edit', 'customers.view', 'jobs.create', 'jobs.edit', 'orders.edit', 'quotations.edit', 'admin.users'];

@ApiTags('lookup')
@Controller('lookup')
export class LookupController {
  constructor(private readonly lookup: LookupService) {}

  @Get('states') @Perm(...FORM_EDITORS) @ApiOkResponse({ type: [StateDto] })
  states() {
    return this.lookup.states();
  }

  @Get('gstin/:gstin') @Perm(...FORM_EDITORS) @ApiOkResponse({ type: GstinLookupDto })
  gstin(@Param('gstin') gstin: string) {
    return this.lookup.gstin(gstin.slice(0, 20));
  }

  @Get('pincode/:pincode') @Perm(...FORM_EDITORS) @ApiOkResponse({ type: PincodeLookupDto })
  pincode(@Param('pincode') pincode: string) {
    return this.lookup.pincode(pincode.slice(0, 10));
  }
}
