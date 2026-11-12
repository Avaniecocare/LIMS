import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { can, currentUser } from '../../common/context.js';
import { PrismaService } from '../../core/prisma.service.js';
import { SignedIn } from '../auth/decorators.js';
import { ScanResultDto, SearchResultDto } from '../jobs/jobs.dto.js';

const LIMIT = 8;

/** Numbers-first global search. Each section only runs for roles allowed to see that record. */
@ApiTags('search')
@SignedIn('results include only the record types the caller may see')
@Controller('search')
export class SearchController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOkResponse({ type: [SearchResultDto] })
  async search(@Query('q') raw?: string): Promise<SearchResultDto[]> {
    const q = (raw ?? '').trim().slice(0, 100);
    if (q.length < 2) return [];
    const has = { contains: q, mode: 'insensitive' as const };
    const out: SearchResultDto[] = [];
    if (can('customers.view')) {
      const rows = await this.prisma.customer.findMany({ where: { deletedAt: null, OR: [{ crn: has }, { name: has }, { gstin: has }] }, take: LIMIT, orderBy: { name: 'asc' } });
      out.push(...rows.map((c) => ({ type: 'Customer', id: c.id, title: c.name, subtitle: c.crn, link: `/customers/${c.id}` })));
    }
    if (can('jobs.view')) {
      const jobs = await this.prisma.job.findMany({ where: { deletedAt: null, jobNo: has }, take: LIMIT, orderBy: { receivedAt: 'desc' } });
      out.push(...jobs.map((j) => ({ type: 'Job', id: j.id, title: j.jobNo, subtitle: j.status, link: `/samples/jobs/${j.id}` })));
      const samples = await this.prisma.sample.findMany({ where: { deletedAt: null, sampleNo: has }, take: LIMIT, orderBy: { createdAt: 'desc' } });
      out.push(...samples.map((s) => ({ type: 'Sample', id: s.id, title: s.sampleNo, subtitle: s.description, link: `/samples/jobs/${s.jobId}?sample=${s.id}` })));
    }
    if (can('reports.view')) {
      const reports = await this.prisma.report.findMany({ where: { reportNo: has }, take: LIMIT, orderBy: { createdAt: 'desc' } });
      out.push(...reports.map((r) => ({ type: 'Report', id: r.id, title: r.reportNo, subtitle: null, link: `/approvals/reports/${r.id}` })));
    }
    if (can('invoices.view')) {
      const invoices = await this.prisma.invoice.findMany({ where: { deletedAt: null, invoiceNo: has }, take: LIMIT, orderBy: { createdAt: 'desc' } });
      out.push(...invoices.map((i) => ({ type: 'Invoice', id: i.id, title: i.invoiceNo ?? 'Draft', subtitle: i.status, link: `/invoices/${i.id}` })));
    }
    return out;
  }

  /**
   * A keyboard-mode scanner types the code and presses Enter. Technicians can scan too, but only
   * reach tests assigned to them, and never the job or customer behind the sample.
   */
  @Get('scan')
  @ApiOkResponse({ type: ScanResultDto })
  async scan(@Query('code') raw?: string): Promise<ScanResultDto> {
    const code = (raw ?? '').trim().slice(0, 100);
    if (!code) return { link: null };
    const sample = await this.prisma.sample.findFirst({ where: { sampleNo: code, deletedAt: null } });
    if (sample) {
      if (can('jobs.view')) return { link: `/samples/jobs/${sample.jobId}?sample=${sample.id}` };
      const mine = await this.prisma.sampleTest.findFirst({ where: { sampleId: sample.id, assignedToId: currentUser()?.id, status: { notIn: ['CANCELLED', 'APPROVED'] } } });
      return { link: mine ? `/my-tests/${mine.id}` : null };
    }
    if (can('jobs.view')) {
      const job = await this.prisma.job.findFirst({ where: { jobNo: code, deletedAt: null } });
      if (job) return { link: `/samples/jobs/${job.id}` };
    }
    if (can('reports.view')) {
      const report = await this.prisma.report.findFirst({ where: { reportNo: code } });
      if (report) return { link: `/approvals/reports/${report.id}` };
    }
    if (can('invoices.view')) {
      const invoice = await this.prisma.invoice.findFirst({ where: { invoiceNo: code, deletedAt: null } });
      if (invoice) return { link: `/invoices/${invoice.id}` };
    }
    if (can('customers.view')) {
      const customer = await this.prisma.customer.findFirst({ where: { crn: code, deletedAt: null } });
      if (customer) return { link: `/customers/${customer.id}` };
    }
    return { link: null };
  }
}
