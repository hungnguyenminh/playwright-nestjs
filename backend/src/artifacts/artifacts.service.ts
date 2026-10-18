import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Model, Types } from 'mongoose';
import type { SaveArtifactInput } from '../actions/run-context.js';
import { appConfig, type AppConfig } from '../config/app.config.js';
import { Artifact } from './artifact.schema.js';

const safeName = (s: string) => s.replace(/[^\w.-]+/g, '_').slice(0, 80);

@Injectable()
export class ArtifactsService {
  constructor(
    @InjectModel(Artifact.name) private readonly artifacts: Model<Artifact>,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  /** Writes the file to STORAGE_DIR/<jobId>/<taskId>/ and returns the artifact id. */
  async save(jobId: string, taskId: string, input: SaveArtifactInput): Promise<string> {
    const dir = join(this.config.storageDir, jobId, taskId);
    await mkdir(dir, { recursive: true });
    const base = safeName((input.name ?? input.kind).replace(/\.[^.]+$/, ''));
    const name = `${base}.${input.ext}`;
    const path = join(dir, `${Date.now()}-${name}`);
    if (input.fromPath) await copyFile(input.fromPath, path);
    else await writeFile(path, input.data ?? Buffer.alloc(0));
    const { size } = await stat(path);
    const doc = await this.artifacts.create({
      jobId: new Types.ObjectId(jobId),
      taskId: new Types.ObjectId(taskId),
      kind: input.kind,
      name,
      path,
      size,
      mime: input.mime,
    });
    return String(doc._id);
  }

  async get(id: string) {
    const artifact = await this.artifacts.findById(id).lean();
    if (!artifact) throw new NotFoundException('Artifact not found');
    return artifact;
  }

  listByTask(taskId: string) {
    return this.artifacts
      .find({ taskId: new Types.ObjectId(taskId) }, { path: 0 })
      .sort({ createdAt: 1 })
      .lean();
  }

  async removeByJob(jobId: string) {
    await this.artifacts.deleteMany({ jobId: new Types.ObjectId(jobId) });
    await rm(join(this.config.storageDir, jobId), { recursive: true, force: true });
  }
}
