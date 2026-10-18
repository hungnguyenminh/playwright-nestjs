import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Model, Types } from 'mongoose';
import type { BrowserContextOptions } from 'playwright';
import { BrowserPoolService } from '../browser/browser-pool.service.js';
import { mergeEmulation } from '../browser/emulation.js';
import { SecretBox } from '../settings/secret-box.js';
import { ProfileDto } from './profile.dto.js';
import { Profile, ProfileMode } from './profile.schema.js';
import { relocateDir } from './relocate.js';

type StorageState = Exclude<BrowserContextOptions['storageState'], string | undefined>;

/** Never leaves the server. */
const HIDDEN = { sessionSealed: 0 } as const;

/** How a task should open a browser for a profile. */
export interface ProfileLease {
  mode: ProfileMode;
  /** folder mode: persistent user-data dir. */
  profileId?: string;
  /** session mode: cookies + localStorage to start with. */
  storageState?: StorageState;
}

@Injectable()
export class ProfilesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProfilesService.name);

  constructor(
    @InjectModel(Profile.name) private readonly profiles: Model<Profile>,
    private readonly pool: BrowserPoolService,
    private readonly box: SecretBox,
  ) {}

  /**
   * PROFILES_DIR changed (e.g. moved out of the project folder): move each
   * profile's Chrome folder to its new place so logins are kept.
   */
  async onApplicationBootstrap() {
    for (const p of await this.profiles.find({}, { userDataDir: 1, name: 1 }).lean()) {
      const target = this.pool.profileDir(String(p._id));
      if (!p.userDataDir || resolve(p.userDataDir) === resolve(target)) continue;
      try {
        const result = await relocateDir(p.userDataDir, target);
        await this.profiles.updateOne({ _id: p._id }, { userDataDir: target });
        if (result === 'moved' || result === 'copied') {
          this.logger.log(`Profile "${p.name}" moved to ${target}`);
        } else if (result === 'target-exists') {
          this.logger.warn(`Profile "${p.name}": ${target} already exists, kept it (old folder left at ${p.userDataDir})`);
        }
      } catch (err) {
        this.logger.error(`Profile "${p.name}" could not be moved to ${target}: ${(err as Error).message}`);
      }
    }
  }

  async list() {
    const items = await this.profiles.find({}, HIDDEN).sort({ name: 1 }).lean();
    return items.map((p) => ({
      ...p,
      mode: p.mode ?? 'folder',
      inUse: (p.mode ?? 'folder') === 'folder' && this.pool.isProfileInUse(String(p._id)),
    }));
  }

  async get(id: string) {
    const profile = await this.profiles.findById(id, HIDDEN).lean();
    if (!profile) throw new NotFoundException('Profile not found');
    return { ...profile, mode: profile.mode ?? 'folder' };
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
    const profile = await this.profiles.findByIdAndUpdate(id, dto, { returnDocument: 'after', projection: HIDDEN }).lean();
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
    return mergeEmulation(profile.emulation, profile.proxy ? { proxy: profile.proxy } : undefined);
  }

  /** Folder mode: the user-data dir; session mode: the decrypted storage state. */
  async leaseFor(id: string): Promise<ProfileLease> {
    const p = await this.profiles.findById(id, { mode: 1, sessionSealed: 1 }).lean();
    if (!p) throw new NotFoundException('Profile not found');
    if ((p.mode ?? 'folder') === 'folder') return { mode: 'folder', profileId: id };
    return { mode: 'session', storageState: this.open(p.sessionSealed) };
  }

  /** Stores the latest cookies / localStorage of a session-mode profile. */
  async saveSession(id: string, state: StorageState) {
    await this.profiles.updateOne(
      { _id: id },
      {
        sessionSealed: this.box.encrypt(JSON.stringify(state)),
        sessionCookies: state.cookies?.length ?? 0,
        sessionUpdatedAt: new Date(),
      },
    );
  }

  /**
   * Copies cookies + localStorage out of the profile's Chrome folder into the
   * database and switches the profile to session mode (the folder is kept).
   */
  async importFromFolder(id: string) {
    const profile = await this.get(id);
    if (this.pool.isProfileInUse(id)) throw new ConflictException('Profile đang được dùng, thử lại khi task chạy xong');
    const lease = await this.pool.lease({ headless: true, emulation: profile.emulation ?? {}, profileId: id });
    let state: StorageState;
    try {
      state = await lease.context.storageState();
    } finally {
      await lease.release();
    }
    if (!state.cookies?.length) throw new BadRequestException('Thư mục profile chưa có cookie nào (chưa đăng nhập?)');
    await this.saveSession(id, state);
    await this.profiles.updateOne({ _id: id }, { mode: 'session' });
    return this.get(id);
  }

  async clearSession(id: string) {
    await this.get(id);
    await this.profiles.updateOne({ _id: id }, { $unset: { sessionSealed: 1, sessionUpdatedAt: 1 }, sessionCookies: 0 });
    return this.get(id);
  }

  private open(sealed?: string): StorageState | undefined {
    if (!sealed) return undefined;
    try {
      return JSON.parse(this.box.decrypt(sealed)) as StorageState;
    } catch {
      this.logger.error('Saved session cannot be decrypted (SETTINGS_SECRET changed?). Log in again.');
      return undefined;
    }
  }
}
