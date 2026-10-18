import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { assertValidActions } from '../actions/action-validator.js';
import { ScriptDto } from './script.dto.js';
import { Script } from './script.schema.js';

@Injectable()
export class ScriptsService {
  constructor(@InjectModel(Script.name) private readonly scripts: Model<Script>) {}

  list() {
    return this.scripts
      .find({}, { actions: 0 })
      .sort({ updatedAt: -1 })
      .lean();
  }

  async get(id: string) {
    const script = await this.scripts.findById(id).lean();
    if (!script) throw new NotFoundException('Script not found');
    return script;
  }

  create(dto: ScriptDto) {
    assertValidActions(dto.actions);
    return this.scripts.create(dto);
  }

  async update(id: string, dto: ScriptDto) {
    assertValidActions(dto.actions);
    const script = await this.scripts
      .findByIdAndUpdate(id, dto, { new: true, runValidators: true })
      .lean();
    if (!script) throw new NotFoundException('Script not found');
    return script;
  }

  async remove(id: string) {
    const res = await this.scripts.deleteOne({ _id: id });
    if (!res.deletedCount) throw new NotFoundException('Script not found');
  }
}
