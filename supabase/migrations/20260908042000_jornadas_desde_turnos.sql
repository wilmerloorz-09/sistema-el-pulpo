-- Migración correctiva: 20260908034100 ya estaba aplicada en producción.
-- Convierte las jornadas manuales en jornadas derivadas de cash_shift_users.

DROP FUNCTION IF EXISTS public.reemplazar_jornada_trabajada(uuid,text,date,uuid,uuid,uuid,text);
DROP FUNCTION IF EXISTS public.registrar_jornada_trabajada(uuid,date,uuid,uuid,uuid,uuid,text);
DROP FUNCTION IF EXISTS public.aprobar_jornada_trabajada(uuid);
DROP FUNCTION IF EXISTS public.resolver_tarifa_jornada(date,uuid,uuid,uuid);
DROP FUNCTION IF EXISTS public.crear_version_tarifa_jornada(text,text,text,uuid,uuid,uuid,smallint[],uuid,uuid,date,date,numeric,integer,text);
DROP FUNCTION IF EXISTS public.guardar_configuracion_jornada_sucursal(uuid,uuid,uuid,text,smallint,boolean,date,date);
DROP FUNCTION IF EXISTS public.guardar_modalidad_jornada(uuid,text,text,text,boolean,smallint);

ALTER TABLE public.funciones_laborales ADD COLUMN IF NOT EXISTS shift_role_key text;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.funciones_laborales'::regclass
      AND conname='funciones_laborales_shift_role_ck'
  ) THEN
    ALTER TABLE public.funciones_laborales
      ADD CONSTRAINT funciones_laborales_shift_role_ck CHECK (
        shift_role_key IS NULL OR shift_role_key IN ('VENTA','DESPACHO','SERVIR','EMPAQUE','CAJA','SUPERVISOR')
      );
  END IF;
END;
$$;
CREATE UNIQUE INDEX IF NOT EXISTS ux_funciones_laborales_shift_role
  ON public.funciones_laborales (shift_role_key) WHERE shift_role_key IS NOT NULL;

UPDATE public.funciones_laborales SET shift_role_key='CAJA' WHERE codigo='CAJA';
UPDATE public.funciones_laborales SET shift_role_key='VENTA',nombre='Venta / Mesas' WHERE codigo='MESAS';
UPDATE public.funciones_laborales SET shift_role_key='DESPACHO' WHERE codigo='DESPACHO';
UPDATE public.funciones_laborales SET shift_role_key='SERVIR' WHERE codigo='SERVIR';
UPDATE public.funciones_laborales SET shift_role_key='EMPAQUE' WHERE codigo='EMPAQUE';
UPDATE public.funciones_laborales SET shift_role_key='SUPERVISOR' WHERE codigo='ADMINISTRACION';

DROP INDEX IF EXISTS public.ix_tarifas_jornada_sucursal;
ALTER TABLE public.tarifas_jornada DROP COLUMN IF EXISTS configuracion_jornada_sucursal_id;
CREATE INDEX IF NOT EXISTS ix_tarifas_jornada_sucursal
  ON public.tarifas_jornada (sucursal_id,funcion_laboral_id);

DROP INDEX IF EXISTS public.ix_jornadas_trabajadas_configuracion_activa;
DROP INDEX IF EXISTS public.ux_jornadas_reemplazo_activo;
ALTER TABLE public.jornadas_trabajadas
  DROP CONSTRAINT IF EXISTS jornadas_trabajadas_estado_ck,
  DROP CONSTRAINT IF EXISTS jornadas_trabajadas_cash_shift_id_fkey,
  DROP CONSTRAINT IF EXISTS jornadas_trabajadas_cash_shift_user_id_fkey,
  DROP COLUMN IF EXISTS configuracion_jornada_sucursal_id,
  DROP COLUMN IF EXISTS modalidad_nombre_snapshot,
  DROP COLUMN IF EXISTS reemplaza_jornada_id,
  ADD COLUMN IF NOT EXISTS cash_shift_user_id uuid,
  ADD COLUMN IF NOT EXISTS roles_snapshot text[] NOT NULL DEFAULT ARRAY[]::text[],
  ALTER COLUMN funcion_laboral_id DROP NOT NULL,
  ALTER COLUMN tarifa_jornada_id DROP NOT NULL,
  ALTER COLUMN monto_tarifa_snapshot DROP NOT NULL,
  ALTER COLUMN registrada_por DROP NOT NULL;

-- Los registros manuales anteriores no representan hechos del turno.
DELETE FROM public.jornadas_trabajadas WHERE cash_shift_user_id IS NULL;

ALTER TABLE public.jornadas_trabajadas
  ALTER COLUMN cash_shift_id SET NOT NULL,
  ALTER COLUMN cash_shift_user_id SET NOT NULL,
  ADD CONSTRAINT jornadas_trabajadas_cash_shift_id_fkey
    FOREIGN KEY (cash_shift_id) REFERENCES public.cash_shifts(id) ON DELETE RESTRICT,
  ADD CONSTRAINT jornadas_trabajadas_cash_shift_user_id_fkey
    FOREIGN KEY (cash_shift_user_id) REFERENCES public.cash_shift_users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT jornadas_trabajadas_estado_ck
    CHECK (estado IN ('SIN_TARIFA','APROBADA','LIQUIDADA','ANULADA'));

CREATE UNIQUE INDEX IF NOT EXISTS ux_jornadas_cash_shift_user
  ON public.jornadas_trabajadas (cash_shift_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_jornadas_persona_turno
  ON public.jornadas_trabajadas (cash_shift_id,persona_id);

ALTER TABLE public.detalles_liquidacion_personal
  DROP COLUMN IF EXISTS modalidad_nombre_snapshot,
  ADD COLUMN IF NOT EXISTS roles_snapshot text[] NOT NULL DEFAULT ARRAY[]::text[];

DROP TABLE IF EXISTS public.configuraciones_jornada_sucursal;
DROP TABLE IF EXISTS public.modalidades_jornada;

CREATE OR REPLACE FUNCTION public.roles_laborales_turno(p_row public.cash_shift_users)
RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path=public
AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN COALESCE(p_row.can_serve_tables,false) THEN 'VENTA' END,
    CASE WHEN COALESCE(p_row.can_dispatch_orders,false) THEN 'DESPACHO' END,
    CASE WHEN COALESCE(p_row.can_serve_plates,false) THEN 'SERVIR' END,
    CASE WHEN COALESCE(p_row.can_pack_orders,false) THEN 'EMPAQUE' END,
    CASE WHEN COALESCE(p_row.can_use_caja,false) THEN 'CAJA' END,
    CASE WHEN COALESCE(p_row.is_supervisor,false) THEN 'SUPERVISOR' END
  ],NULL);
$$;

CREATE OR REPLACE FUNCTION public.resolver_tarifa_roles_jornada(
  p_fecha date,p_sucursal_id uuid,p_roles text[]
)
RETURNS TABLE(
  tarifa_jornada_id uuid,funcion_laboral_id uuid,funcion_nombre text,
  tarifa_nombre text,monto numeric,moneda text,prioridad integer,criterios jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
AS $$
  WITH candidates AS (
    SELECT t.*,f.nombre funcion_nombre,f.shift_role_key role_key,
      (CASE WHEN t.dia_especial_laboral_id IS NOT NULL THEN 8 ELSE 0 END
       + CASE WHEN t.tipo_dia_especial_laboral_id IS NOT NULL THEN 4 ELSE 0 END
       + CASE WHEN t.sucursal_id IS NOT NULL THEN 2 ELSE 0 END
       + CASE WHEN t.dias_semana IS NOT NULL THEN 1 ELSE 0 END) especificidad
    FROM public.tarifas_jornada t
    JOIN public.funciones_laborales f ON f.id=t.funcion_laboral_id
    WHERE t.activa AND f.activo
      AND f.shift_role_key=ANY(COALESCE(p_roles,ARRAY[]::text[]))
      AND p_fecha BETWEEN t.vigente_desde AND COALESCE(t.vigente_hasta,'infinity'::date)
      AND (t.sucursal_id IS NULL OR t.sucursal_id=p_sucursal_id)
      AND (t.dias_semana IS NULL OR extract(isodow FROM p_fecha)::smallint=ANY(t.dias_semana))
      AND (t.dia_especial_laboral_id IS NULL OR EXISTS(
        SELECT 1 FROM public.dias_especiales_laborales d
        WHERE d.id=t.dia_especial_laboral_id AND d.activo AND d.fecha=p_fecha
          AND (d.sucursal_id IS NULL OR d.sucursal_id=p_sucursal_id)
      ))
      AND (t.tipo_dia_especial_laboral_id IS NULL OR EXISTS(
        SELECT 1 FROM public.dias_especiales_laborales d
        WHERE d.tipo_dia_especial_laboral_id=t.tipo_dia_especial_laboral_id
          AND d.activo AND d.fecha=p_fecha
          AND (d.sucursal_id IS NULL OR d.sucursal_id=p_sucursal_id)
      ))
  ), role_winners AS (
    SELECT DISTINCT ON (c.role_key) c.*
    FROM candidates c
    ORDER BY c.role_key,c.prioridad DESC,c.especificidad DESC,c.creada_en DESC
  )
  SELECT c.id,c.funcion_laboral_id,c.funcion_nombre,c.nombre,c.monto,c.moneda::text,c.prioridad,
    jsonb_build_object(
      'roles_turno',p_roles,'sucursal_id',c.sucursal_id,'dias_semana',c.dias_semana,
      'tipo_dia_especial_laboral_id',c.tipo_dia_especial_laboral_id,
      'dia_especial_laboral_id',c.dia_especial_laboral_id
    )
  FROM role_winners c
  ORDER BY c.monto DESC,c.prioridad DESC,c.especificidad DESC,c.creada_en DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.sincronizar_jornada_usuario_turno(p_cash_shift_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  v_csu public.cash_shift_users%ROWTYPE;
  v_shift record; v_persona record; v_branch record; v_tarifa record; v_existing record;
  v_roles text[]; v_id uuid; v_fecha date;
BEGIN
  SELECT * INTO v_csu FROM public.cash_shift_users WHERE id=p_cash_shift_user_id;
  SELECT * INTO v_existing FROM public.jornadas_trabajadas
  WHERE cash_shift_user_id=p_cash_shift_user_id FOR UPDATE;
  IF v_csu.id IS NULL OR NOT COALESCE(v_csu.is_enabled,false) THEN
    IF v_existing.id IS NOT NULL AND v_existing.estado='LIQUIDADA' THEN
      RAISE EXCEPTION 'No se puede quitar del turno una jornada ya liquidada';
    END IF;
    DELETE FROM public.jornadas_trabajadas
    WHERE cash_shift_user_id=p_cash_shift_user_id AND estado<>'LIQUIDADA';
    RETURN NULL;
  END IF;
  IF v_existing.estado='LIQUIDADA' THEN
    RAISE EXCEPTION 'No se pueden cambiar funciones de una jornada ya liquidada';
  END IF;
  SELECT id,branch_id,cashier_id,opened_at,status INTO v_shift
  FROM public.cash_shifts WHERE id=v_csu.shift_id;
  SELECT id,COALESCE(NULLIF(full_name,''),NULLIF(alias,''),username,'Usuario') nombre,identity_number
  INTO v_persona FROM public.profiles WHERE id=v_csu.user_id;
  SELECT id,name,COALESCE(display_code,branch_code) codigo INTO v_branch
  FROM public.branches WHERE id=v_shift.branch_id;
  v_fecha:=(v_shift.opened_at AT TIME ZONE 'America/Guayaquil')::date;
  v_roles:=public.roles_laborales_turno(v_csu);
  SELECT * INTO v_tarifa FROM public.resolver_tarifa_roles_jornada(v_fecha,v_shift.branch_id,v_roles);
  v_id:=COALESCE(v_existing.id,gen_random_uuid());
  INSERT INTO public.jornadas_trabajadas(
    id,codigo,persona_id,fecha_laboral,sucursal_id,cash_shift_id,cash_shift_user_id,
    funcion_laboral_id,tarifa_jornada_id,monto_tarifa_snapshot,moneda_snapshot,
    tarifa_nombre_snapshot,criterios_tarifa_snapshot,prioridad_tarifa_snapshot,
    tarifa_resuelta_en,persona_nombre_snapshot,persona_identificacion_snapshot,
    sucursal_nombre_snapshot,sucursal_codigo_snapshot,funcion_nombre_snapshot,
    roles_snapshot,estado,registrada_por
  ) VALUES(
    v_id,'JOR-'||replace(p_cash_shift_user_id::text,'-',''),v_csu.user_id,v_fecha,v_shift.branch_id,
    v_shift.id,v_csu.id,v_tarifa.funcion_laboral_id,v_tarifa.tarifa_jornada_id,v_tarifa.monto,
    COALESCE(v_tarifa.moneda,'USD'),COALESCE(v_tarifa.tarifa_nombre,'Sin tarifa configurada'),
    COALESCE(v_tarifa.criterios,jsonb_build_object('roles_turno',v_roles)),
    COALESCE(v_tarifa.prioridad,0),now(),v_persona.nombre,v_persona.identity_number,
    v_branch.name,v_branch.codigo,COALESCE(v_tarifa.funcion_nombre,'Sin función tarifada'),
    v_roles,CASE WHEN v_tarifa.tarifa_jornada_id IS NULL THEN 'SIN_TARIFA' ELSE 'APROBADA' END,
    v_shift.cashier_id
  )
  ON CONFLICT(cash_shift_user_id) DO UPDATE SET
    persona_id=EXCLUDED.persona_id,fecha_laboral=EXCLUDED.fecha_laboral,
    sucursal_id=EXCLUDED.sucursal_id,cash_shift_id=EXCLUDED.cash_shift_id,
    funcion_laboral_id=EXCLUDED.funcion_laboral_id,tarifa_jornada_id=EXCLUDED.tarifa_jornada_id,
    monto_tarifa_snapshot=EXCLUDED.monto_tarifa_snapshot,moneda_snapshot=EXCLUDED.moneda_snapshot,
    tarifa_nombre_snapshot=EXCLUDED.tarifa_nombre_snapshot,
    criterios_tarifa_snapshot=EXCLUDED.criterios_tarifa_snapshot,
    prioridad_tarifa_snapshot=EXCLUDED.prioridad_tarifa_snapshot,tarifa_resuelta_en=now(),
    persona_nombre_snapshot=EXCLUDED.persona_nombre_snapshot,
    persona_identificacion_snapshot=EXCLUDED.persona_identificacion_snapshot,
    sucursal_nombre_snapshot=EXCLUDED.sucursal_nombre_snapshot,
    sucursal_codigo_snapshot=EXCLUDED.sucursal_codigo_snapshot,
    funcion_nombre_snapshot=EXCLUDED.funcion_nombre_snapshot,
    roles_snapshot=EXCLUDED.roles_snapshot,estado=EXCLUDED.estado;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sincronizar_jornada_usuario_turno()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS(SELECT 1 FROM public.jornadas_trabajadas WHERE cash_shift_user_id=OLD.id AND estado='LIQUIDADA') THEN
      RAISE EXCEPTION 'No se puede quitar del turno una jornada ya liquidada';
    END IF;
    DELETE FROM public.jornadas_trabajadas WHERE cash_shift_user_id=OLD.id AND estado<>'LIQUIDADA';
    RETURN OLD;
  END IF;
  PERFORM public.sincronizar_jornada_usuario_turno(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cash_shift_users_jornada_insert_update ON public.cash_shift_users;
DROP TRIGGER IF EXISTS trg_cash_shift_users_jornada_delete ON public.cash_shift_users;
CREATE TRIGGER trg_cash_shift_users_jornada_insert_update
AFTER INSERT OR UPDATE OF is_enabled,can_serve_tables,can_dispatch_orders,can_serve_plates,can_pack_orders,can_use_caja,is_supervisor
ON public.cash_shift_users FOR EACH ROW
EXECUTE FUNCTION public.trg_sincronizar_jornada_usuario_turno();
CREATE TRIGGER trg_cash_shift_users_jornada_delete
BEFORE DELETE ON public.cash_shift_users FOR EACH ROW
EXECUTE FUNCTION public.trg_sincronizar_jornada_usuario_turno();

CREATE OR REPLACE FUNCTION public.crear_version_tarifa_jornada(
  p_regla_codigo text,p_nombre text,p_descripcion text,p_funcion_laboral_id uuid,
  p_sucursal_id uuid,p_dias_semana smallint[],p_tipo_dia_especial_id uuid,
  p_dia_especial_id uuid,p_vigente_desde date,p_vigente_hasta date,
  p_monto numeric,p_prioridad integer,p_motivo text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_id uuid:=gen_random_uuid(); v_version integer; v_previous uuid; v_previous_start date; v_row record;
BEGIN
  IF NOT public.can_manage_pagos_personal(auth.uid()) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
  IF p_monto<0 THEN RAISE EXCEPTION 'El monto no puede ser negativo'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(upper(btrim(p_regla_codigo)),0));
  SELECT id,version,vigente_desde INTO v_previous,v_version,v_previous_start
  FROM public.tarifas_jornada WHERE regla_codigo=upper(btrim(p_regla_codigo))
  ORDER BY version DESC LIMIT 1 FOR UPDATE;
  v_version:=COALESCE(v_version,0)+1;
  IF v_previous IS NOT NULL THEN
    IF p_vigente_desde<=v_previous_start THEN RAISE EXCEPTION 'La nueva versión debe iniciar después de la anterior'; END IF;
    UPDATE public.tarifas_jornada SET vigente_hasta=p_vigente_desde-1
    WHERE id=v_previous AND (vigente_hasta IS NULL OR vigente_hasta>=p_vigente_desde);
  END IF;
  INSERT INTO public.tarifas_jornada(
    id,regla_codigo,version,nombre,descripcion,funcion_laboral_id,sucursal_id,dias_semana,
    tipo_dia_especial_laboral_id,dia_especial_laboral_id,vigente_desde,vigente_hasta,
    monto,prioridad,activa,version_anterior_id,motivo_cambio,creada_por
  ) VALUES(
    v_id,upper(btrim(p_regla_codigo)),v_version,btrim(p_nombre),nullif(btrim(p_descripcion),''),
    p_funcion_laboral_id,p_sucursal_id,p_dias_semana,p_tipo_dia_especial_id,p_dia_especial_id,
    p_vigente_desde,p_vigente_hasta,p_monto,COALESCE(p_prioridad,100),true,v_previous,btrim(p_motivo),auth.uid()
  );
  FOR v_row IN
    SELECT csu.id FROM public.cash_shift_users csu
    LEFT JOIN public.jornadas_trabajadas j ON j.cash_shift_user_id=csu.id
    WHERE csu.is_enabled AND COALESCE(j.estado,'')<>'LIQUIDADA'
  LOOP
    PERFORM public.sincronizar_jornada_usuario_turno(v_row.id);
  END LOOP;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sincronizar_jornadas_desde_turnos()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE v_row record; v_count integer:=0;
BEGIN
  IF NOT public.can_manage_pagos_personal(auth.uid()) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
  FOR v_row IN SELECT id FROM public.cash_shift_users WHERE is_enabled LOOP
    PERFORM public.sincronizar_jornada_usuario_turno(v_row.id);
    v_count:=v_count+1;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.calcular_periodo_pago_personal(p_periodo_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_period record; v_person record; v_liq uuid; v_total numeric;
  v_count integer; v_seq bigint; v_jornada_ids uuid[];
BEGIN
  IF NOT public.can_manage_pagos_personal(auth.uid()) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('calcular_periodos_pago_personal',0));
  SELECT * INTO v_period FROM public.periodos_pago_personal WHERE id=p_periodo_id FOR UPDATE;
  IF v_period.estado<>'ABIERTO' THEN RAISE EXCEPTION 'El período no está abierto'; END IF;
  SELECT array_agg(eligible.id ORDER BY eligible.id) INTO v_jornada_ids FROM(
    SELECT j.id FROM public.jornadas_trabajadas j
    JOIN public.cash_shifts cs ON cs.id=j.cash_shift_id AND cs.status='CLOSED'
    WHERE j.estado='APROBADA' AND j.tarifa_jornada_id IS NOT NULL
      AND j.fecha_laboral BETWEEN v_period.fecha_inicio AND v_period.fecha_fin
      AND NOT EXISTS(
        SELECT 1 FROM public.detalles_liquidacion_personal d
        JOIN public.liquidaciones_personal l ON l.id=d.liquidacion_personal_id
        JOIN public.periodos_pago_personal p ON p.id=l.periodo_pago_personal_id
        WHERE d.jornada_trabajada_id=j.id AND p.estado<>'ANULADO'
      )
    ORDER BY j.id FOR UPDATE OF j
  ) eligible;
  IF COALESCE(cardinality(v_jornada_ids),0)=0 THEN
    RAISE EXCEPTION 'No hay jornadas con tarifa de turnos cerrados en el período';
  END IF;
  FOR v_person IN
    SELECT persona_id,min(persona_nombre_snapshot) persona_nombre,
      min(persona_identificacion_snapshot) identificacion,count(*) cantidad,
      sum(monto_tarifa_snapshot) total
    FROM public.jornadas_trabajadas WHERE id=ANY(v_jornada_ids) GROUP BY persona_id
  LOOP
    v_liq:=gen_random_uuid();
    v_seq:=public.next_human_sequence('liquidaciones_personal',NULL,to_char(v_period.fecha_inicio,'YYYYMMDD'));
    INSERT INTO public.liquidaciones_personal(
      id,codigo,periodo_pago_personal_id,persona_id,persona_nombre_snapshot,
      persona_identificacion_snapshot,cantidad_jornadas_snapshot,total_snapshot,creada_por
    ) VALUES(
      v_liq,'LIQ-'||to_char(v_period.fecha_inicio,'YYMMDD')||'-'||lpad(v_seq::text,5,'0'),
      p_periodo_id,v_person.persona_id,v_person.persona_nombre,v_person.identificacion,
      v_person.cantidad,v_person.total,auth.uid()
    );
    INSERT INTO public.detalles_liquidacion_personal(
      liquidacion_personal_id,jornada_trabajada_id,fecha_laboral_snapshot,sucursal_id_snapshot,
      sucursal_nombre_snapshot,roles_snapshot,funcion_nombre_snapshot,tarifa_nombre_snapshot,
      monto_snapshot,moneda_snapshot
    )
    SELECT v_liq,id,fecha_laboral,sucursal_id,sucursal_nombre_snapshot,roles_snapshot,
      funcion_nombre_snapshot,tarifa_nombre_snapshot,monto_tarifa_snapshot,moneda_snapshot
    FROM public.jornadas_trabajadas
    WHERE persona_id=v_person.persona_id AND id=ANY(v_jornada_ids);
    UPDATE public.jornadas_trabajadas SET estado='LIQUIDADA'
    WHERE persona_id=v_person.persona_id AND id=ANY(v_jornada_ids) AND estado='APROBADA';
  END LOOP;
  SELECT count(*),COALESCE(sum(cantidad_jornadas_snapshot),0),COALESCE(sum(total_snapshot),0)
  INTO v_count,v_seq,v_total FROM public.liquidaciones_personal WHERE periodo_pago_personal_id=p_periodo_id;
  UPDATE public.periodos_pago_personal SET estado='CALCULADO',
    total_personas_snapshot=v_count,total_jornadas_snapshot=v_seq,total_general_snapshot=v_total,
    calculado_por=auth.uid(),calculado_en=now() WHERE id=p_periodo_id;
END;
$$;

DO $$
DECLARE v_row record;
BEGIN
  FOR v_row IN SELECT id FROM public.cash_shift_users WHERE is_enabled LOOP
    PERFORM public.sincronizar_jornada_usuario_turno(v_row.id);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.roles_laborales_turno(public.cash_shift_users) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolver_tarifa_roles_jornada(date,uuid,text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sincronizar_jornada_usuario_turno(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_sincronizar_jornada_usuario_turno() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crear_version_tarifa_jornada(text,text,text,uuid,uuid,smallint[],uuid,uuid,date,date,numeric,integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sincronizar_jornadas_desde_turnos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crear_version_tarifa_jornada(text,text,text,uuid,uuid,smallint[],uuid,uuid,date,date,numeric,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sincronizar_jornadas_desde_turnos() TO authenticated;

COMMENT ON TABLE public.jornadas_trabajadas IS
  'Jornadas pagables creadas y sincronizadas automáticamente desde cash_shift_users.';
