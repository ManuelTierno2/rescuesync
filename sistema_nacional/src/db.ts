import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

const url = process.env.DATABASE_URL!;
// El adapter no lee ?schema= de la URL (solo `migrate`), así que se pasa a mano.
const schema = new URL(url).searchParams.get("schema") ?? undefined;

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url }, { schema }),
});
