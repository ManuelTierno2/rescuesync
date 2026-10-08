import { Router, type RequestHandler } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "./db.js";
import type { Rol } from "./generated/prisma/enums.js";

const secret = process.env.JWT_SECRET;
if (!secret) throw new Error("Falta JWT_SECRET");

export type Claims = { sub: number; rol: Rol; ongId: number | null };

declare module "express-serve-static-core" {
  interface Request {
    user?: Claims;
  }
}

// Hash descartable para que el login tarde igual exista o no el email.
const DUMMY_HASH = bcrypt.hashSync("dummy", 10);

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "email y password son obligatorios" });
  }
  const u = await prisma.usuario.findUnique({ where: { email: email.toLowerCase() } });
  const ok = await bcrypt.compare(password, u?.passwordHash ?? DUMMY_HASH);
  if (!u || !ok) return res.status(401).json({ error: "Credenciales inválidas" });

  const claims: Claims = { sub: u.id, rol: u.rol, ongId: u.ongId };
  const token = jwt.sign(claims, secret, { expiresIn: "8h" });
  res.json({ token, tokenType: "Bearer", expiresIn: 8 * 3600, rol: u.rol, ongId: u.ongId });
});

/** Exige JWT válido y, si se pasan roles, que el rol del token esté entre ellos. */
export const requireAuth = (...roles: Rol[]): RequestHandler => (req, res, next) => {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
  if (!m) return res.status(401).json({ error: "Falta token" });
  try {
    const c = jwt.verify(m[1], secret) as unknown as Claims;
    if (roles.length && !roles.includes(c.rol)) return res.status(403).json({ error: "Sin permisos" });
    req.user = c;
    next();
  } catch {
    res.status(401).json({ error: "Token inválido o vencido" });
  }
};
