import { useCallback, useEffect, useState } from 'react';
import { api, type Emergencia, type Lote, type Oferta, type Usuario, type Warning } from './api';
export interface Round {
  id: string; numero: number; publicada_at: string | null; seleccionada_at: string | null;
  ofertas_vistas_at: string | null; monitoreo_finalizado_at: string | null;
}
export interface Participation { ong_usuario_id: string; ong_usuario: Usuario; lectura_at: string | null; finalizada_at: string | null }
export interface Workflow {
  enabled: boolean; caseId: string | null; state: string; compatible: boolean; localClosed: boolean;
  validationMode: 'PENDIENTE' | 'DESARROLLO'; round: Round | null;
  readyTasks: { id: string; name: string; ongUsuarioId?: string }[]; availableActions: string[];
  windows: { id: string; vence_at: string; cerrada_at: string | null }[];
  actions: { id: string; accion: string; actor_id: string; estado: string; task_id: string | null }[];
}
export interface Monitoring { emergencia: Emergencia; rondas: (Round & { lotes: (Lote & { ofertas: Oferta[] })[]; participaciones: Participation[] })[] }
export function useWorkflow(id: string) {
  const [data, setData] = useState<Workflow>();
  const [monitoring, setMonitoring] = useState<Monitoring>();
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [error, setError] = useState<unknown>();
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(v => v + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    async function poll() {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const [workflow, monitor] = await Promise.all([
          api<Workflow>(`/emergencias/${id}/workflow`, { signal: controller.signal }),
          api<Monitoring>(`/emergencias/${id}/monitoreo`, { signal: controller.signal }),
        ]);
        if (!controller.signal.aborted) { setData(workflow.data); setMonitoring(monitor.data); setWarnings(workflow.warnings ?? []); setError(undefined); }
      } catch (e) { if (!controller.signal.aborted) setError(e); }
      finally { busy = false; }
    }
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 5000);
    const onFocus = () => { void poll(); };
    window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onFocus);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [id, revision]);
  return { data, monitoring, warnings, error, refresh };
}
