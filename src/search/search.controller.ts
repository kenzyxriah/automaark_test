import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { SearchService } from './search.service';

export interface SearchRequest {
  q: string;
  limit?: number;
}

/**
 * POST /v1/search  (see README for the contract)
 * x-tenant: which business is asking (our API gateway has already checked their key)
 * x-now:    today's date for this request (resolve "this weekend" against it, not the server clock)
 */
@Controller('v1')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Post('search')
  @HttpCode(200)
  async run(@Body() body: SearchRequest, @Headers('x-tenant') tenant?: string, @Headers('x-now') now?: string) {
    return this.search.search({ q: String(body?.q ?? ''), limit: Math.min(Number(body?.limit ?? 10) || 10, 50) }, { tenant: tenant ?? '', now: now ?? new Date().toISOString().slice(0, 10) });
  }
}
