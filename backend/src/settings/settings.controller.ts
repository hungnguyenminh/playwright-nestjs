import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { AiSettingsDto } from './ai-settings.dto.js';
import { AiSettingsService } from './ai-settings.service.js';

@Controller('settings/ai')
export class SettingsController {
  constructor(private readonly ai: AiSettingsService) {}

  /** Token is never returned, only its last 4 characters. */
  @Get()
  get() {
    return this.ai.getPublic();
  }

  @Put()
  update(@Body() dto: AiSettingsDto) {
    return this.ai.update(dto);
  }

  /** Test with the (possibly unsaved) values from the form. */
  @Post('test')
  @HttpCode(200)
  test(@Body() dto: AiSettingsDto) {
    return this.ai.test(dto);
  }

  @Post('models')
  @HttpCode(200)
  models(@Body() dto: AiSettingsDto) {
    return this.ai.listModels(dto);
  }
}
