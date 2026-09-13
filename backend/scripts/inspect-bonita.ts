// Read-only diagnostic: never instantiates, executes, assigns or modifies a case.
import { readEnv } from '../src/config/env.js';
import { createPrismaClient } from '../src/database/prisma.js';
import { createBonitaClient, BonitaError } from '../src/integrations/bonita/bonita.client.js';
async function main() {
  const env = readEnv();
  if (!env.bonita.enabled) { console.log(JSON.stringify({ enabled: false })); return; }
  const db = createPrismaClient(env.DATABASE_URL);
  try {
    const cases = await db.$queryRaw<{ id: string; caseId: string }[]>`SELECT id, bonita_instance_id::text AS "caseId" FROM emergencias WHERE bonita_instance_id IS NOT NULL ORDER BY created_at DESC LIMIT 5`;
    const client = createBonitaClient(env.bonita);
    for (const e of cases) {
      try {
        const state = await client.getCaseState(e.caseId);
        const tasks = state.state === 'OPEN' ? await client.listReadyHumanTasks(e.caseId) : [];
        const contracts = [];
        for (const task of tasks) {
          const contract = await client.getTaskContract(task.id) as { inputs?: { name: string; type: string; multiple?: boolean }[] };
          contracts.push({ taskId: task.id, name: task.name, inputs: contract.inputs?.map(i => ({ name: i.name, type: i.type, multiple: i.multiple ?? false })) });
        }
        console.log(JSON.stringify({ emergenciaId: e.id, caseId: e.caseId, ...state, contracts }));
      } catch (error) { console.log(JSON.stringify({ caseId: e.caseId, code: error instanceof BonitaError ? error.code : 'INSPECTION_FAILED' })); }
    }
    if (!cases.length) console.log(JSON.stringify({ enabled: true, linkedCases: 0 }));
  } finally { await db.$disconnect(); }
}
main().catch(() => { console.error('INSPECTION_FAILED'); process.exitCode = 1; });
