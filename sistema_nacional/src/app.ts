import express from "express";
import cors from "cors";
import { authRouter } from "./auth.js";
import { ongsRouter } from "./ongs.js";
import { validacionRouter } from "./validacion.js";
import { compromisosRouter } from "./compromisos.js";
import swaggerUi from "swagger-ui-express";
import { openapi } from "./openapi.js";

export const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/openapi.json", (_req, res) => res.json(openapi));
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: "Sistema Nacional - API" }));
app.get("/", (_req, res) => res.redirect("/docs"));
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
