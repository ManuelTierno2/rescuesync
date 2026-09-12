import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, 'ROUTE_NOT_FOUND', 'La ruta solicitada no existe.'));
};
