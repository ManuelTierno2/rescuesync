import type { ErrorRequestHandler } from 'express';
import { Prisma } from '../generated/prisma/client.js';
import { AppError } from '../errors/app-error.js';
import { BonitaError } from '../integrations/bonita/bonita.client.js';

const unavailableCodes = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2037']);

function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof BonitaError) return new AppError(/TASK_|CONTRACT_/.test(error.code) ? 409 : 502, error.code, error.message);

  if (error instanceof URIError) {
    return new AppError(400, 'INVALID_URL', 'La URL contiene una codificación inválida.');
  }

  if (error && typeof error === 'object' && 'type' in error) {
    if (error.type === 'entity.parse.failed') {
      return new AppError(400, 'INVALID_JSON', 'El cuerpo debe contener JSON válido.');
    }
    if (error.type === 'entity.too.large') {
      return new AppError(400, 'BODY_TOO_LARGE', 'El cuerpo supera el límite de 100 KB.');
    }
    if (error.type === 'charset.unsupported' || error.type === 'encoding.unsupported') {
      return new AppError(400, 'INVALID_ENCODING', 'La codificación del cuerpo no está admitida.');
    }
  }

  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    (error instanceof Prisma.PrismaClientKnownRequestError && unavailableCodes.has(error.code))
  ) {
    return new AppError(503, 'DATABASE_UNAVAILABLE', 'La base de datos no está disponible.');
  }

  return new AppError(500, 'INTERNAL_ERROR', 'Ocurrió un error interno.');
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  const normalized = normalizeError(error);
  if (normalized.status >= 500) {
    // Registrar solo códigos: los errores del driver pueden contener SQL o credenciales.
    console.error(`[${normalized.code}]`, error instanceof Error ? error.name : 'UnknownError');
  }
  res.status(normalized.status).json({
    error: {
      code: normalized.code,
      message: normalized.message,
      details: normalized.details,
    },
  });
};
