import { ValidationPipe } from '@nestjs/common';
import { type ValidationError } from 'class-validator';

import { DomainException } from '../errors/domain.exception';
import { type ProblemFieldError } from '../errors/problem-details.dto';

function joinPath(parent: string, property: string): string {
  if (/^\d+$/.test(property)) return `${parent}[${property}]`;
  return parent ? `${parent}.${property}` : property;
}

/** Flattens class-validator's error tree into `{ path, code, message }` entries (contract §3). */
export function flattenValidationErrors(errors: ValidationError[], parent = ''): ProblemFieldError[] {
  return errors.flatMap((error) => {
    const path = joinPath(parent, error.property);
    const own = Object.entries(error.constraints ?? {}).map(([code, message]) => ({ path, code, message }));
    return [...own, ...flattenValidationErrors(error.children ?? [], path)];
  });
}

/** The single global validation pipe: unknown fields are rejected, payloads are transformed to DTOs. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    validationError: { target: false, value: false },
    stopAtFirstError: false,
    exceptionFactory: (errors) =>
      new DomainException('validation.failed', { errors: flattenValidationErrors(errors) }),
  });
}
