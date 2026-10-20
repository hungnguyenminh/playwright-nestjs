import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ParseObjectIdPipe } from '../common/parse-object-id.pipe.js';
import { ProfileDto } from './profile.dto.js';
import { ProfilesService } from './profiles.service.js';

@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get()
  list() {
    return this.profiles.list();
  }

  @Get(':id')
  get(@Param('id', ParseObjectIdPipe) id: string) {
    return this.profiles.get(id);
  }

  @Post()
  create(@Body() dto: ProfileDto) {
    return this.profiles.create(dto);
  }

  @Put(':id')
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: ProfileDto) {
    return this.profiles.update(id, dto);
  }

  /** Remove the "needs to log in again" mark set by publishing (after logging in). */
  @Post(':id/health/clear')
  @HttpCode(204)
  clearHealth(@Param('id', ParseObjectIdPipe) id: string) {
    return this.profiles.clearHealth(id);
  }

  /** Copy cookies + localStorage from the Chrome folder into the database (switches to session mode). */
  @Post(':id/import-session')
  @HttpCode(200)
  importSession(@Param('id', ParseObjectIdPipe) id: string) {
    return this.profiles.importFromFolder(id);
  }

  @Delete(':id/session')
  clearSession(@Param('id', ParseObjectIdPipe) id: string) {
    return this.profiles.clearSession(id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseObjectIdPipe) id: string) {
    return this.profiles.remove(id);
  }
}
