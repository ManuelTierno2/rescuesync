import type { Emergencia } from '../../generated/prisma/client.js';
import { createBonitaClient, type BonitaConfig, type BonitaClient } from './bonita.client.js';

export interface BonitaService {
  client?: BonitaClient;
  startRescueSyncProcess(emergencia: Emergencia): Promise<string | null>;
}

export function createBonitaService(config: BonitaConfig = { enabled: false }): BonitaService {
  if (!config.enabled) return { startRescueSyncProcess: async () => null };
  const client = createBonitaClient(config);
  return {
    client,
    // The current RescueSync start contract has no inputs. The link lives in PostgreSQL.
    startRescueSyncProcess: async (_emergencia) => client.startProcess(),
  };
}
