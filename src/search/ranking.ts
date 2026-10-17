import type { Listing } from '../catalog/catalog.service';
import type { ParsedSearch } from './query.parser';

const { embed } = require('../../tools/embed.cjs') as { embed: (text: string) => number[] };

const STOP = new Set('a an the to in on of for and or with without near around stay stays place places us i we my our me need want looking first next weekend october september november december january february march april may june july august this night nights under less than budget cheaper price max maximum for two three four five six seven eight nine ten people guests adults dog dogs cat cats pet pets'.split(' '));
const TYPE_EQUIVALENTS: Record<string, string[]> = {
  cabin: ['cabin', 'chalet', 'a-frame', 'lodge'], cottage: ['cottage', 'house', 'farmhouse'],
  apartment: ['apartment', 'serviced apartment', 'studio'], house: ['house', 'farmhouse', 'cottage'],
};

export function tokens(text: string): string[] {
  return text.toLowerCase().match(/[a-z][a-z-]{1,}/g)?.filter(w => !STOP.has(w)) ?? [];
}
function dot(a: number[], b: number[]): number { return a.reduce((sum, x, i) => sum + x * b[i], 0); }

/** In-memory offline lexical/semantic index: catalogue only, never prices or availability. */
export class HybridIndex {
  private readonly documents: { listing: Listing; frequency: Map<string, number>; length: number; vector: number[] }[];
  private readonly df = new Map<string, number>();
  private readonly averageLength: number;

  constructor(listings: Listing[]) {
    this.documents = listings.map(listing => {
      const words = tokens(`${listing.title} ${listing.title} ${listing.type} ${listing.description} ${listing.amenities.join(' ')}`);
      const frequency = new Map<string, number>();
      for (const word of words) frequency.set(word, (frequency.get(word) ?? 0) + 1);
      for (const word of frequency.keys()) this.df.set(word, (this.df.get(word) ?? 0) + 1);
      return { listing, frequency, length: words.length, vector: embed(`${listing.title} ${listing.type} ${listing.description} ${listing.amenities.join(' ')}`) };
    });
    this.averageLength = this.documents.reduce((total, doc) => total + doc.length, 0) / Math.max(1, this.documents.length);
  }

  rank(listings: Listing[], parsed: ParsedSearch): { listing: Listing; score: number }[] {
    const queryTerms = [...new Set(tokens(parsed.meaning))];
    const queryVector = embed(parsed.meaning);
    const queryHasVector = queryVector.some(x => x > 0);
    const allow = new Set(listings.map(l => l.id));
    const scored = this.documents.filter(doc => allow.has(doc.listing.id)).map(doc => {
      let bm25 = 0;
      for (const term of queryTerms) {
        const tf = doc.frequency.get(term) ?? 0;
        if (!tf) continue;
        const idf = Math.log(1 + (this.documents.length - (this.df.get(term) ?? 0) + 0.5) / ((this.df.get(term) ?? 0) + 0.5));
        bm25 += idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * doc.length / Math.max(1, this.averageLength)));
      }
      const semantic = queryHasVector ? Math.max(0, dot(queryVector, doc.vector)) : 0;
      const typeBoost = parsed.requested_type === doc.listing.type ? 2.5 :
        parsed.requested_type && TYPE_EQUIVALENTS[parsed.requested_type]?.includes(doc.listing.type) ? 0.7 : 0;
      return { listing: doc.listing, lexical: bm25, semantic, typeBoost };
    });
    const lexicalRank = [...scored].sort((a, b) => b.lexical - a.lexical);
    const semanticRank = [...scored].sort((a, b) => b.semantic - a.semantic);
    const lexRank = new Map(lexicalRank.map((x, i) => [x.listing.id, i + 1]));
    const vecRank = new Map(semanticRank.map((x, i) => [x.listing.id, i + 1]));
    const maxLexical = Math.max(1, ...scored.map(x => x.lexical));
    return scored.map(x => ({
      listing: x.listing,
      score: 20 * (1 / (60 + (lexRank.get(x.listing.id) ?? scored.length)) + (queryHasVector ? 1 / (60 + (vecRank.get(x.listing.id) ?? scored.length)) : 0))
        + 1.6 * x.lexical / maxLexical + 2 * x.semantic + x.typeBoost + (x.listing.rating - 3.5) * 0.1,
    })).sort((a, b) => b.score - a.score || a.listing.id.localeCompare(b.listing.id));
  }
}
