import { Injectable } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service';
import { InventoryClient } from '../inventory/inventory.client';

export interface SearchResult {
  listing_id: string;
  title: string;
  /** For the requested nights, from live inventory: average per night, and the total. */
  nightly_avg: number | null;
  total: number | null;
  currency: string;
  /** One short line a guest could read: why this stay is here. */
  why: string;
}

/**
 * The search we have today: a word match on titles, written in an afternoon. It ignores dates, guests, pets,
 * place and price, shows the stale price_hint, and doesn't know who is asking. Replace it.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly inventory: InventoryClient,
  ) {}

  async search(req: { q: string; limit: number }, ctx: { tenant: string; now: string }): Promise<{ results: SearchResult[]; understood: Record<string, unknown> }> {
    const words = req.q.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    const scored = this.catalog.listings
      .map((l) => ({ l, score: words.filter((w) => l.title.toLowerCase().includes(w)).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, req.limit);
    return {
      results: scored.map(({ l, score }) => ({ listing_id: l.id, title: l.title, nightly_avg: l.price_hint, total: null, currency: l.currency, why: `${score} matching words in the title` })),
      understood: { words },
    };
  }
}
