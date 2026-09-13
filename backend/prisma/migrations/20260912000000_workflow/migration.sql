ALTER TABLE emergencias ADD COLUMN cerrada_at TIMESTAMPTZ(3);
ALTER TABLE ofertas ADD COLUMN activa BOOLEAN NOT NULL DEFAULT true;
CREATE TABLE rondas (
 id UUID PRIMARY KEY, emergencia_id UUID NOT NULL REFERENCES emergencias(id) ON DELETE CASCADE,
 numero INTEGER NOT NULL CHECK (numero > 0), tarea_lotes_id VARCHAR(19), publicada_at TIMESTAMPTZ(3),
 seleccionada_at TIMESTAMPTZ(3), ofertas_vistas_at TIMESTAMPTZ(3), monitoreo_finalizado_at TIMESTAMPTZ(3),
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(emergencia_id, numero), UNIQUE(emergencia_id, tarea_lotes_id)
);
INSERT INTO rondas(id, emergencia_id, numero) SELECT gen_random_uuid(), id, 1 FROM emergencias;
ALTER TABLE lotes ADD COLUMN ronda_id UUID REFERENCES rondas(id) ON DELETE RESTRICT;
UPDATE lotes SET ronda_id = rondas.id FROM rondas WHERE rondas.emergencia_id = lotes.emergencia_id;
CREATE TABLE ventanas_convocatoria (
 id UUID PRIMARY KEY, ronda_id UUID NOT NULL REFERENCES rondas(id) ON DELETE CASCADE,
 actividad_id VARCHAR(80) NOT NULL UNIQUE, abierta_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 vence_at TIMESTAMPTZ(3) NOT NULL, cerrada_at TIMESTAMPTZ(3), cobertura JSONB
);
CREATE INDEX ventanas_convocatoria_ronda_id_idx ON ventanas_convocatoria(ronda_id);
CREATE TABLE adjudicaciones (
 id UUID PRIMARY KEY, oferta_id UUID NOT NULL UNIQUE REFERENCES ofertas(id) ON DELETE CASCADE,
 municipio_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE participaciones_ong (
 id UUID PRIMARY KEY, ronda_id UUID NOT NULL REFERENCES rondas(id) ON DELETE CASCADE,
 ong_usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
 lectura_at TIMESTAMPTZ(3), finalizada_at TIMESTAMPTZ(3), UNIQUE(ronda_id, ong_usuario_id)
);
CREATE TABLE acciones_workflow (
 id UUID PRIMARY KEY, emergencia_id UUID NOT NULL REFERENCES emergencias(id) ON DELETE CASCADE,
 actor_id UUID NOT NULL, accion VARCHAR(40) NOT NULL, task_id VARCHAR(19) UNIQUE,
 task_name VARCHAR(100), destinatario_id UUID, contrato JSONB NOT NULL, solicitud JSONB NOT NULL,
 estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE', error_code VARCHAR(80),
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX acciones_workflow_emergencia_id_idx ON acciones_workflow(emergencia_id);
