import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { rm } from 'node:fs/promises';
import { Model, Types } from 'mongoose';
import { BrowserPoolService } from '../browser/browser-pool.service.js';
import { mergeEmulation } from '../browser/emulation.js';
import { ProfileDto } from './profile.dto.js';
import { Profile } from './profile.schema.js';

@Injectable()
export class ProfilesService {
  constructor(
    @InjectModel(Profile.name) private readonly profiles: Model<Profile>,
    private readonly pool: BrowserPoolService,
  ) {}

  async list() {
    const items = await this.profiles.find().sort({ name: 1 }).lean();
    return items.map((p) => ({
      ...p,
      inUse: this.pool.isProfileInUse(String(p._id)),
    }));
  }

  async get(id: string) {
    const profile = await this.profiles.findById(id).lean();
    if (!profile) throw new NotFoundException('Profile not found');
    return profile;
  }

  create(dto: ProfileDto) {
    const _id = new Types.ObjectId();
    return this.profiles.create({
      ...dto,
      _id,
      userDataDir: this.pool.profileDir(String(_id)),
    });
  }

  async update(id: string, dto: ProfileDto) {
    const profile = await this.profiles
      .findByIdAndUpdate(id, dto, { new: true })
      .lean();
    if (!profile) throw new NotFoundException('Profile not found');
    return profile;
  }

  async remove(id: string) {
    if (this.pool.isProfileInUse(id)) {
      throw new ConflictException('Profile is in use by a running task');
    }
    const profile = await this.profiles.findByIdAndDelete(id).lean();
    if (!profile) throw new NotFoundException('Profile not found');
    await rm(profile.userDataDir, { recursive: true, force: true });
  }

  /** Emulation a task should use with this profile (proxy included). */
  async emulationFor(id: string) {
    const profile = await this.get(id);
    await this.profiles.updateOne({ _id: id }, { lastUsedAt: new Date() });
    return mergeEmulation(
      profile.emulation,
      profile.proxy ? { proxy: profile.proxy } : undefined,
    );
  }
}
