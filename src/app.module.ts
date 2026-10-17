import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { CatalogService } from './catalog/catalog.service';
import { InventoryClient } from './inventory/inventory.client';
import { SearchController } from './search/search.controller';
import { SearchService } from './search/search.service';

@Module({
  controllers: [HealthController, SearchController],
  providers: [CatalogService, InventoryClient, SearchService],
})
export class AppModule {}
