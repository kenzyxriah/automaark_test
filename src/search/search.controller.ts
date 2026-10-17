import { BadRequestException, Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { SearchService } from './search.service';

export interface SearchRequest { q: string; limit?: number; }

@Controller('v1')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Post('search')
  @HttpCode(200)
  async run(@Body() body: SearchRequest, @Headers('x-tenant') tenant?: string, @Headers('x-now') now?: string) {
    if (typeof body?.q !== 'string' || !body.q.trim() || body.q.length > 2000) throw new BadRequestException('q must be a non-empty sentence (up to 2000 characters)');
    const limit = body.limit === undefined ? 10 : body.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new BadRequestException('limit must be an integer between 1 and 50');
    const current = now ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(current) || Number.isNaN(Date.parse(current))) throw new BadRequestException('x-now must be YYYY-MM-DD');
    return this.search.search({ q: body.q, limit }, { tenant: tenant ?? '', now: current });
  }
}
