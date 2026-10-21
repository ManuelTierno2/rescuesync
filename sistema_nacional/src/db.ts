import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

const url = process.env.DATABASE_URL!;
// El adapter no lee ?schema= de la URL (solo `migrate`), así que se pasa a mano.
const schema = new URL(url).searchParams.get("schema") ?? undefined;
if (schema && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) throw new Error("schema inválido en DATABASE_URL");

/** Tabla calificada con el schema: el search_path no se ajusta, así que el SQL crudo tiene que nombrarlo. */
export const tabla = (nombre: string) => `"${schema ?? "public"}"."${nombre}"`;

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url }, { schema }),
});
