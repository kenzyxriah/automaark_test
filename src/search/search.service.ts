import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { CatalogService, Listing, Place } from '../catalog/catalog.service';
import { InventoryClient, Quote } from '../inventory/inventory.client';
import { HybridIndex } from './ranking';
import { ParsedSearch, parseSearch } from './query.parser';

export interface SearchResult {
  listing_id: string;
  title: string;
  nightly_avg: number;
  total: number;
  currency: string;
  why: string;
}

function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

@Injectable()
export class SearchService {
  private readonly index: HybridIndex;
  private readonly placeById: Map<string, Place>;
  private readonly allowedTenants: Set<string>;

  constructor(private readonly catalog: CatalogService, private readonly inventory: InventoryClient) {
    this.index = new HybridIndex(catalog.listings);
    this.placeById = new Map(catalog.places.map(place => [place.id, place]));
    this.allowedTenants = new Set(catalog.tenants.map(tenant => tenant.id));
  }

  /** Tenant authorization is a hard pre-retrieval boundary. The gateway authenticates x-tenant. */
  private eligible(listing: Listing, tenant: string, parsed: ParsedSearch): boolean {
    if (listing.visibility !== 'public' && listing.visibility !== `private:${tenant}`) return false;
    if (parsed.guests !== null && listing.sleeps < parsed.guests) return false;
    if (parsed.bedrooms !== null && listing.bedrooms < parsed.bedrooms) return false;
    if (parsed.pets && !listing.pets_allowed) return false;
    if (parsed.place_ids.length) {
      const place = parsed.place ? this.catalog.places.find(p => p.name === parsed.place) : null;
      if (place && parsed.radius_miles !== null) {
        if (milesBetween(place, listing) > parsed.radius_miles) return false;
      } else if (!parsed.place_ids.includes(listing.place_id)) return false;
    }
    if (parsed.budget !== null && parsed.budget_currency !== null && listing.currency !== parsed.budget_currency) return false;
    return true;
  }

  private verifyQuote(listing: Listing, quote: Quote | undefined, parsed: ParsedSearch): quote is Quote {
    if (!quote || !quote.available || quote.listing_id !== listing.id || quote.currency !== listing.currency) return false;
    const count = Math.round((Date.parse(parsed.check_out) - Date.parse(parsed.check_in)) / 86_400_000);
    if (quote.nights.length !== count || !Number.isFinite(quote.total) || !Number.isFinite(quote.nightly_avg) || quote.nightly_avg === null) return false;
    if (quote.nights.some((n, i) => !n.available || n.date !== new Date(Date.parse(parsed.check_in) + i * 86_400_000).toISOString().slice(0, 10) || !Number.isFinite(n.price))) return false;
    const computedTotal = quote.nights.reduce((sum, n) => sum + n.price, 0);
    if (Math.abs(computedTotal - quote.total) > 0.01 || Math.abs(computedTotal / count - quote.nightly_avg) > 0.011) return false;
    if (parsed.budget !== null) {
      const amount = parsed.budget_basis === 'total' ? quote.total : quote.nightly_avg;
      if (amount > parsed.budget) return false;
    }
    return true;
  }

  private explain(listing: Listing, parsed: ParsedSearch): string {
    const facts = [listing.type];
    const matches = listing.amenities.filter(a => new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '.*'), 'i').test(parsed.query)).slice(0, 2);
    if (matches.length) facts.push(`with ${matches.join(' and ')}`);
    const place = this.placeById.get(listing.place_id);
    if (place) {
      const center = parsed.place ? this.catalog.places.find(p => p.name === parsed.place) : null;
      facts.push(center ? `${Math.round(milesBetween(center, listing))} mi from ${center.name}` : `in ${place.name}`);
    }
    if (parsed.pets) facts.push('dogs welcome');
    if (parsed.guests) facts.push(`sleeps ${listing.sleeps}`);
    return facts.join(', ').replace(/^./, c => c.toUpperCase());
  }

  /** Hybrid candidate scoring is intentionally separate from eligibility and inventory truth. */
  async search(req: { q: string; limit: number }, ctx: { tenant: string; now: string }): Promise<{ results: SearchResult[]; understood: Record<string, unknown> }> {
    // Do not echo private catalogue details to unrecognized tenants.
    if (!this.allowedTenants.has(ctx.tenant)) return { results: [], understood: { error: 'Unknown tenant' } };
    const parsed = parseSearch(req.q, ctx.now, this.catalog.places);
    if (req.limit <= 0 || !req.q.trim()) return { results: [], understood: parsed as unknown as Record<string, unknown> };
    const structural = this.catalog.listings.filter(listing => this.eligible(listing, ctx.tenant, parsed));
    if (!structural.length) return { results: [], understood: parsed as unknown as Record<string, unknown> };
    const candidates = this.index.rank(structural, parsed);
    const quotes = new Map<string, Quote>();
    try {
      // Fetch ALL structurally eligible candidates in bounded parallel batches. A top-K
      // cut before live validation can incorrectly produce zero results during sell-outs.
      const batches: string[][] = [];
      for (let i = 0; i < candidates.length; i += 50) batches.push(candidates.slice(i, i + 50).map(c => c.listing.id));
      for (let i = 0; i < batches.length; i += 8) {
        const retrieved = await Promise.all(batches.slice(i, i + 8).map(ids => this.inventory.quotes(ids, parsed.check_in, parsed.check_out)));
        for (const batch of retrieved) for (const quote of batch) quotes.set(quote.listing_id, quote);
      }
    } catch {
      // Never serve stale hints as fallbacks for a failed inventory service.
      throw new ServiceUnavailableException('Live pricing and availability temporarily unavailable');
    }
    const results = candidates
      .filter(c => this.verifyQuote(c.listing, quotes.get(c.listing.id), parsed))
      .map(c => {
        const q = quotes.get(c.listing.id)!;
        const score = c.score + (parsed.budget !== null ? 0.06 * Math.max(0, 1 - (parsed.budget_basis === 'total' ? q.total : q.nightly_avg!) / parsed.budget) : 0);
        return { score, item: { listing_id: c.listing.id, title: c.listing.title, nightly_avg: q.nightly_avg!, total: q.total, currency: q.currency, why: this.explain(c.listing, parsed) } };
      })
      .sort((a, b) => b.score - a.score || a.item.listing_id.localeCompare(b.item.listing_id))
      .slice(0, Math.min(50, Math.max(0, req.limit)))
      .map(r => r.item);
    return { results, understood: parsed as unknown as Record<string, unknown> };
  }
}
