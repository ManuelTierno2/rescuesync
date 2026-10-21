import express from "express";
import cors from "cors";
import { authRouter } from "./auth.js";
import { ongsRouter } from "./ongs.js";
import { validacionRouter } from "./validacion.js";
import { compromisosRouter } from "./compromisos.js";

export const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use(authRouter);
app.use(ongsRouter);
app.use(validacionRouter);
app.use(compromisosRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = (err as { status?: number }).status;
  if (status && status < 500) return res.status(status).json({ error: "Solicitud inválida" });
  console.error(err);
  res.status(500).json({ error: "Error interno" });
});
