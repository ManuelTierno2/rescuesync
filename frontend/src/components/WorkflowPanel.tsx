import { useEffect, useRef, useState } from 'react';
import { api, type Warning } from '../api';
import { useDevUser } from '../user-context';
import { ErrorMessage, formatDate } from '../ui';
import type { useWorkflow } from '../workflow';

const labels: Record<string, string> = {
  registrar: 'Completar registro en Bonita', publicar: 'Publicar convocatoria', decidir: 'Confirmar curso de acción',
  'ver-ofertas': 'Continuar a selección', adjudicar: 'Confirmar adjudicación', leer: 'Confirmar lectura',
  'finalizar-actividad': 'Marcar actividad finalizada', 'finalizar-monitoreo': 'Finalizar monitoreo / continuar cierre',
  cerrar: 'Cerrar operativo', 'nueva-ronda': 'Preparar nueva ronda',
};
const roles: Record<string, string> = { registrar: 'MUNICIPIO', publicar: 'COORDINADOR', decidir: 'COORDINADOR',
  'ver-ofertas': 'MUNICIPIO', adjudicar: 'MUNICIPIO', leer: 'ONG', 'finalizar-actividad': 'ONG',
  'finalizar-monitoreo': 'COORDINADOR', cerrar: 'COORDINADOR', 'nueva-ronda': 'COORDINADOR' };
export function WorkflowPanel({ id, query, onChanged }: { id: string; query: ReturnType<typeof useWorkflow>; onChanged: () => void }) {
  const { user } = useDevUser();
  const { data, monitoring } = query;
  const [selection, setSelection] = useState<string[]>([]);
  const [course, setCourse] = useState('REABRIR');
  const [confirm, setConfirm] = useState<string>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const [feedback, setFeedback] = useState('');
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const requestId = useRef<string | undefined>(undefined);
  const busy = useRef(false);
  useEffect(() => { setSelection([]); setConfirm(undefined); requestId.current = undefined; }, [data?.round?.id, user?.id]);
  if (!data) return <section className="card"><h2>Estado Bonita</h2><ErrorMessage error={query.error} retry={query.refresh} /><p>Consultando estado…</p></section>;
  const round = monitoring?.rondas.find(r => r.id === data.round?.id);
  const myParticipation = round?.participaciones.find(p => p.ong_usuario_id === user?.id);
  const lots = round?.lotes ?? [];
  const overflow = lots.some(l => l.ofertas.filter(o => selection.includes(o.id)).reduce((n, o) => n + o.cantidad_ofrecida, 0) > l.cantidad_requerida);
  const available = (action: string) => data.availableActions.includes(action) && roles[action] === user?.rol && !query.error
    && (user?.rol !== 'MUNICIPIO' || monitoring?.emergencia.creada_por_id === user.id);
  function allowed(action: string) {
    if (data!.localClosed) return false;
    if (action === 'publicar') return !!lots.length && !round?.publicada_at;
    if (action === 'ver-ofertas') return !!round?.publicada_at && !round.ofertas_vistas_at && data!.validationMode === 'DESARROLLO';
    if (action === 'adjudicar') return !!round?.ofertas_vistas_at && !round.seleccionada_at && !!selection.length && !overflow && data!.validationMode === 'DESARROLLO';
    if (action === 'leer' || action === 'finalizar-actividad') {
      if (!myParticipation || (action === 'leer' ? myParticipation.lectura_at : myParticipation.finalizada_at || !myParticipation.lectura_at)) return false;
      if (data!.enabled) return data!.readyTasks.some(t => t.ongUsuarioId === user?.id && t.name === (action === 'leer' ? 'Visualizar notificacion' : 'Marcar actividad finalizada'));
    }
    if (action === 'finalizar-monitoreo') return !!round?.seleccionada_at && !round.monitoreo_finalizado_at;
    if (action === 'cerrar') return !!round?.seleccionada_at && !!round.monitoreo_finalizado_at && round.participaciones.every(p => p.finalizada_at);
    return true;
  }
  async function send(action: string, reconcileId?: string) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(undefined); setFeedback(''); setWarnings([]);
    try {
      requestId.current ??= crypto.randomUUID();
      const body = reconcileId || action === 'nueva-ronda' ? {} : { accionId: requestId.current,
        ...(action === 'decidir' ? { cursoAccion: course } : {}), ...(action === 'adjudicar' ? { ofertaIds: selection } : {}) };
      const result = await api(`/emergencias/${id}/acciones/${reconcileId ? reconcileId + '/reconciliar' : action}`, { body });
      setWarnings(result.warnings ?? []); setFeedback(result.warnings?.length ? 'Datos guardados; sincronización pendiente.' : 'Acción confirmada.');
      setConfirm(undefined); requestId.current = undefined; onChanged();
    } catch (e) { setError(e); query.refresh(); }
    finally { setPending(false); busy.current = false; }
  }
  return <>
    <section className="card workflow-state" aria-label="Estado Bonita">
      <div className="section-heading"><h2>Estado Bonita</h2><button type="button" onClick={query.refresh}>Actualizar estado</button></div>
      <p>Caso: <strong>{data.caseId ? '#' + data.caseId : 'Sin caso vinculado'}</strong> · {data.enabled ? data.state : 'Bonita deshabilitado'}</p>
      <p>Tareas actuales: {data.readyTasks.length ? data.readyTasks.map(t => `${t.name} (#${t.id})`).join(' · ') : 'Sin tareas humanas disponibles'}</p>
      <p>Ronda {data.round?.numero ?? 1} · {data.localClosed ? 'Cierre local confirmado' : data.round?.publicada_at ? 'Publicada' : 'En preparación'}</p>
      {data.enabled && data.localClosed && data.state !== 'COMPLETED' && <p className="notice warning">El cierre está guardado localmente; falta confirmar el archivo del caso en Bonita.</p>}
      {!data.enabled && <p className="muted">Operaciones locales. Los timers y las decisiones de routing requieren Bonita.</p>}
      <ErrorMessage error={query.error} retry={query.refresh} />
      {query.warnings.map((w, i) => <p className="notice warning" key={i}>{w.message}</p>)}
      {data.windows.filter(w => !w.cerrada_at).map(w => <p key={w.id}>Ventana: {data.enabled ? 'vence ' + formatDate(w.vence_at) : 'abierta hasta confirmar adjudicación'}</p>)}
    </section>
    <section className="card" aria-label="Acciones del operativo">
      <h2>Acciones del operativo</h2>
      <p className="notice warning">{data.validationMode === 'DESARROLLO' ? 'Validación de desarrollo: ofertas activas consideradas disponibles. Sistema Nacional real pendiente.' : 'Validación externa pendiente. La selección requiere habilitar explícitamente el modo de desarrollo.'}</p>
      <ErrorMessage error={error} />
      {feedback && <p role="status">{feedback}</p>}
      {warnings.map((w, i) => <p className="notice warning" role="alert" key={i}>{w.message}</p>)}
      {available('decidir') && <label>Curso de acción <select value={course} disabled={pending || !!confirm} onChange={e => setCourse(e.target.value)}>
        <option>REABRIR</option><option>REFORMULAR</option><option>PARCIAL</option>
      </select></label>}
      {user?.rol === 'MUNICIPIO' && round?.publicada_at && <div className="selection-list">
        <h3>Ofertas disponibles / selección</h3>
        {lots.map(l => <div key={l.id}><h4>{l.descripcion}</h4>
          <p>Seleccionadas: {l.ofertas.filter(o => selection.includes(o.id)).reduce((n, o) => n + o.cantidad_ofrecida, 0)} / {l.cantidad_requerida} {l.unidad}</p>
          {l.ofertas.filter(o => o.activa).map(o => <label className="offer-choice" key={o.id}>
            <input type="checkbox" checked={selection.includes(o.id)} disabled={pending || !!confirm || !available('adjudicar') || !!round.seleccionada_at || data.validationMode !== 'DESARROLLO'}
              onChange={e => setSelection(v => e.target.checked ? [...v, o.id] : v.filter(x => x !== o.id))} />
            {o.ong_usuario.organizacion}: {o.cantidad_ofrecida} {l.unidad}{o.adjudicacion ? ' · Adjudicada' : ''}
          </label>)}
        </div>)}
        {overflow && <p role="alert">La selección supera la cantidad requerida de un lote. Seleccione otra combinación.</p>}
      </div>}
      {user?.rol === 'ONG' && round?.seleccionada_at && <div>
        <h3>Resultado de adjudicación</h3>
        <p>{myParticipation ? 'Tiene ofertas adjudicadas en esta ronda.' : 'No tiene ofertas adjudicadas en esta ronda.'}</p>
        <ul>{lots.flatMap(l => l.ofertas.filter(o => o.adjudicacion && o.ong_usuario_id === user.id).map(o => <li key={o.id}>{l.descripcion}: {o.cantidad_ofrecida} {l.unidad}</li>))}</ul>
        {myParticipation?.lectura_at && <p>Lectura confirmada.</p>}{myParticipation?.finalizada_at && <p>Actividad finalizada.</p>}
      </div>}
      <div className="workflow-buttons">{Object.keys(labels).filter(available).map(action => <button type="button" key={action}
        disabled={pending || !!confirm || !allowed(action)} onClick={() => { setConfirm(action); setError(undefined); requestId.current = undefined; }}>{labels[action]}</button>)}</div>
      {confirm && <div className="notice confirmation" role="group" aria-label="Confirmar acción">
        <p>Confirmar: {labels[confirm]}{confirm === 'decidir' ? ' · ' + course : ''}.</p>
        <button type="button" disabled={pending} onClick={() => void send(confirm)}>{pending ? 'Guardando…' : 'Confirmar acción'}</button>{' '}
        <button type="button" disabled={pending} onClick={() => { setConfirm(undefined); requestId.current = undefined; }}>Cancelar</button>
      </div>}
      {data.actions.filter(a => a.actor_id === user?.id && a.estado !== 'CONFIRMADO').map(a => <div className="notice warning" key={a.id}>
        <p>{labels[a.accion]} · {a.estado} · Tarea #{a.task_id}</p>
        <button type="button" disabled={pending} onClick={() => void send(a.accion, a.id)}>Consultar / reconciliar acción</button>
      </div>)}
    </section>
    {(user?.rol === 'COORDINADOR' || user?.rol === 'AUDITOR') && <section className="card" aria-label="Monitoreo">
      <h2>Monitoreo</h2>
      <p>{monitoring?.emergencia.zona} · Ronda {round?.numero}</p>
      <ul>{lots.map(l => <li key={l.id}>{l.descripcion}: {l.ofertas.filter(o => o.adjudicacion).reduce((n, o) => n + o.cantidad_ofrecida, 0)} / {l.cantidad_requerida} {l.unidad} adjudicadas</li>)}</ul>
      {lots.flatMap(l => l.ofertas.filter(o => o.adjudicacion).map(o => <p key={o.id}>{l.descripcion} · {o.ong_usuario.organizacion} · {o.cantidad_ofrecida} {l.unidad}</p>))}
      <ul>{round?.participaciones.map(p => <li key={p.ong_usuario_id}>{p.ong_usuario.organizacion}: {p.finalizada_at ? 'Actividad finalizada' : 'Actividad pendiente'} · {p.lectura_at ? 'Notificación leída' : 'Lectura pendiente'}</li>)}</ul>
      {round?.monitoreo_finalizado_at && <p>Monitoreo finalizado.</p>}
    </section>}
    {!!monitoring && monitoring.rondas.length > 1 && <details className="card"><summary>Historial de rondas</summary>
      {monitoring.rondas.slice(1).map(r => <div key={r.id}><h3>Ronda {r.numero}</h3><ul>{r.lotes.map(l => <li key={l.id}>{l.descripcion}: {l.ofertas.length} ofertas conservadas</li>)}</ul></div>)}
    </details>}
  </>;
}
