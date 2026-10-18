import {
  Body,
  Controller,
  Get,
  HttpException,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { describeAiError } from './ai-client.js';
import { AiAssistDto } from './ai.dto.js';
import { AiService } from './ai.service.js';

@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('status')
  status() {
    return this.ai.status();
  }

  /**
   * Server-sent events: status, snapshot, text (guide deltas), proposal,
   * error, done. Closing the connection cancels the request to the model.
   */
  @Post('assist')
  async assist(@Body() dto: AiAssistDto, @Res() res: Response) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    const emit = (event: string, data: unknown) => {
      if (!res.writableEnded)
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    try {
      await this.ai.assist(dto, emit, abort.signal);
    } catch (err) {
      if (!abort.signal.aborted) {
        emit('error', {
          message:
            err instanceof HttpException ? err.message : describeAiError(err),
        });
      }
    } finally {
      res.end();
    }
  }
}
