import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { buildActionSchema } from './action.schema.js';
import { validateActions } from './action-validator.js';

@Controller('actions')
export class ActionsController {
  private readonly schema = buildActionSchema();

  /** JSON Schema for the script editor (Monaco). */
  @Get('schema')
  getSchema() {
    return this.schema;
  }

  @Post('validate')
  @HttpCode(200)
  validate(@Body() body: { actions: unknown }) {
    const errors = validateActions(body?.actions);
    return { valid: errors.length === 0, errors };
  }
}
