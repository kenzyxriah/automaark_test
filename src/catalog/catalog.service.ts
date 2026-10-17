import { Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';

export interface Listing {
  id: string;
  place_id: string;
  title: string;
  description: string;
  type: string;
  sleeps: number;
  bedrooms: number;
  pets_allowed: boolean;
  amenities: string[];
  lat: number;
  lng: number;
  currency: 'USD' | 'NGN' | 'GHS';
  /** A price from when the listing was created. Out of date: live prices come from the inventory service. */
  price_hint: number;
  rating: number;
  reviews: number;
  host_id: string;
  /** "public", or "private:<tenant id>" for a partner's own stays (only that partner may ever see them). */
  visibility: string;
}

export interface Place {
  id: string;
  name: string;
  region: string;
  country: string;
  lat: number;
  lng: number;
  aliases: string[];
  currency: string;
  type: 'town' | 'neighbourhood';
}

/** The catalogue, loaded from data/ at start-up. */
@Injectable()
export class CatalogService {
  private readonly dir = process.env.DATA_DIR ?? join(__dirname, '..', '..', 'data');
  readonly listings: Listing[] = JSON.parse(readFileSync(join(this.dir, 'listings.json'), 'utf8'));
  readonly places: Place[] = JSON.parse(readFileSync(join(this.dir, 'places.json'), 'utf8'));
  readonly tenants: { id: string; name: string }[] = JSON.parse(readFileSync(join(this.dir, 'tenants.json'), 'utf8'));
}
