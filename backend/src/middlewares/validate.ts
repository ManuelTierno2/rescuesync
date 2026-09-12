import type { RequestHandler } from 'express';
import type { z } from 'zod';
import { AppError } from '../errors/app-error.js';

export function validate(schema: z.ZodType, source: 'body' | 'params'): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      next(new AppError(400, 'VALIDATION_ERROR', 'La solicitud contiene datos inválidos.',
        result.error.issues.map((issue) => ({
          field: issue.path.join('.') || source,
          message: issue.message,
        })),
      ));
      return;
    }
    // Express 5 expone req.params como getter: guardar el resultado validado aparte.
    res.locals[source] = result.data;
    next();
  };
}
