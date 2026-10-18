import { BadRequestException } from '@nestjs/common';
import { Ajv, type ErrorObject } from 'ajv';
import type { Action } from './action.types.js';
import { buildActionSchema } from './action.schema.js';

const ajv = new Ajv({ discriminator: true, allErrors: false, strict: false });
const validate = ajv.compile<Action[]>(buildActionSchema());

/** e.g. "/2/then/0: must have required property 'url'". */
function describe(err: ErrorObject): string {
  const where = err.instancePath || '/';
  return `${where}: ${err.message ?? 'invalid'}${
    err.params && 'additionalProperty' in err.params
      ? ` (${String(err.params.additionalProperty)})`
      : ''
  }`;
}

export function validateActions(actions: unknown): string[] {
  if (validate(actions)) return [];
  return (validate.errors ?? []).map(describe);
}

export function assertValidActions(actions: unknown): asserts actions is Action[] {
  const errors = validateActions(actions);
  if (errors.length) {
    throw new BadRequestException({ message: 'Invalid actions', errors });
  }
}
