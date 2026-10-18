import { Controller, Get } from '@nestjs/common';
import { BrowserPoolService } from './browser/browser-pool.service.js';

@Controller('system')
export class SystemController {
  constructor(private readonly pool: BrowserPoolService) {}

  /** Browser pool usage, for the dashboard. */
  @Get()
  stats() {
    return { pool: this.pool.stats() };
  }
}
