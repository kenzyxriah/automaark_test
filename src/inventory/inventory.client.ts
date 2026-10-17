import { Injectable } from '@nestjs/common';

export interface Quote {
  listing_id: string;
  available: boolean;
  nights: { date: string; available: boolean; price: number }[];
  total: number;
  nightly_avg: number | null;
  currency: string;
}

/** Hearthly's live availability and prices (tools/inventory-dev.mjs locally; INVENTORY_URL when graded). */
@Injectable()
export class InventoryClient {
  private readonly base = (process.env.INVENTORY_URL ?? 'http://localhost:4010').replace(/\/$/, '');

  /** At most 50 ids per call. */
  async quotes(ids: string[], checkIn: string, checkOut: string): Promise<Quote[]> {
    const url = `${this.base}/v1/availability?ids=${ids.join(',')}&check_in=${checkIn}&check_out=${checkOut}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`inventory ${res.status}: ${await res.text()}`);
    return ((await res.json()) as { results: Quote[] }).results;
  }
}
