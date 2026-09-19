-- ============================================================
-- CRODE SOLAR - ESQUEMA COMPLETO DE BASE DE DATOS
-- Ejecutar en Supabase SQL Editor.
-- El script es idempotente: puede ejecutarse más de una vez.
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists public.usuarios (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    email text not null,
    password_hash text,
    rol text not null default 'tecnico',
    estado text not null default 'activo',
    ultimo_acceso timestamptz,
    created_at timestamptz not null default now()
);

create table if not exists public.inversores (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    marca text not null default 'Otra',
    modelo text,
    ubicacion text,
    capacidad_kw numeric(12, 3) not null default 0,
    tipo_conexion text not null default 'api',
    usuario_id uuid references public.usuarios(id) on delete set null,
    ip_modbus text,
    puerto_modbus integer default 502,
    huawei_usuario text,
    huawei_plant_code text,
    growatt_usuario text,
    growatt_serial_number text,
    api_url text,
    plant_id text,
    gateway_id text,
    device_serial text,
    api_username text,
    api_password text,
    api_token text,
    api_status text not null default 'pending',
    api_last_sync timestamptz,
    api_last_error text,
    frecuencia_lectura integer not null default 60,
    estado text not null default 'offline',
    created_at timestamptz not null default now()
);

create table if not exists public.lecturas_historicas (
    id uuid primary key default gen_random_uuid(),
    inversor_id uuid not null references public.inversores(id) on delete cascade,
    timestamp timestamptz not null default now(),
    voltaje_dc numeric(12, 3) not null default 0,
    corriente_dc numeric(12, 3) not null default 0,
    potencia_ac numeric(12, 3) not null default 0,
    energia_dia numeric(12, 3) not null default 0,
    energia_total numeric(14, 3) not null default 0,
    temperatura numeric(8, 3) not null default 0,
    frecuencia numeric(8, 3) not null default 60,
    estado_operativo text not null default 'offline'
);

create table if not exists public.alertas (
    id uuid primary key default gen_random_uuid(),
    inversor_id uuid not null references public.inversores(id) on delete cascade,
    tipo text not null default 'Sistema',
    mensaje text not null,
    fecha timestamptz not null default now(),
    resuelta boolean not null default false,
    resuelta_por uuid references public.usuarios(id) on delete set null,
    fecha_resolucion timestamptz
);

create table if not exists public.logs_actividad (
    id uuid primary key default gen_random_uuid(),
    usuario_id uuid references public.usuarios(id) on delete set null,
    usuario_nombre text not null default 'Sistema',
    accion text not null,
    descripcion text not null default '',
    ip text,
    fecha timestamptz not null default now()
);

create table if not exists public.inversores_tecnicos (
    inversor_id uuid not null references public.inversores(id) on delete cascade,
    usuario_id uuid not null references public.usuarios(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (inversor_id, usuario_id)
);

create index if not exists lecturas_historicas_inversor_timestamp_idx
    on public.lecturas_historicas (inversor_id, timestamp desc);

create index if not exists alertas_inversor_resuelta_fecha_idx
    on public.alertas (inversor_id, resuelta, fecha desc);

create index if not exists logs_actividad_fecha_idx
    on public.logs_actividad (fecha desc);

-- ============================================================
-- MIGRACIONES Y COMPATIBILIDAD
-- ============================================================

-- Ejecutar en Supabase antes de guardar la configuración API desde el panel.
-- Para producción, api_password y api_token deben quedar protegidos y solo leerse
-- desde una Edge Function / backend autenticado.

-- La autenticación del panel usa esta columna para guardar hashes bcrypt.
-- Ejecuta esta migración una vez si la tabla usuarios no la tiene.
alter table public.usuarios
    add column if not exists password_hash text;

update public.usuarios
set email = lower(trim(email))
where email is not null;

-- El login normaliza los correos a minúsculas y esta restricción evita duplicados
-- que solo se diferencien por mayúsculas/minúsculas.
create unique index if not exists usuarios_email_lower_unique
    on public.usuarios (lower(email));

alter table public.inversores
    add column if not exists api_url text,
    add column if not exists plant_id text,
    add column if not exists gateway_id text,
    add column if not exists device_serial text,
    add column if not exists api_username text,
    add column if not exists api_password text,
    add column if not exists api_token text,
    add column if not exists api_status text default 'pending',
    add column if not exists api_last_sync timestamptz,
    add column if not exists api_last_error text;

-- Evita valores fuera de la lista esperada.
alter table public.inversores
    drop constraint if exists inversores_api_status_check;

alter table public.inversores
    add constraint inversores_api_status_check
    check (api_status in ('pending', 'connected', 'error', 'disabled'));

-- Importante: si la tabla aún no tiene el campo 'estado', asegúrate de que exista.
-- Puedes dejarlo como varchar para que el app no falle en el dashboard.

alter table public.inversores
    add column if not exists estado text default 'offline';

alter table public.inversores
    add column if not exists usuario_id uuid references public.usuarios(id) on delete set null;

-- Permite asignar un mismo inversor a varios técnicos o invitados.
create table if not exists public.inversores_tecnicos (
    inversor_id uuid not null references public.inversores(id) on delete cascade,
    usuario_id uuid not null references public.usuarios(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (inversor_id, usuario_id)
);

create index if not exists inversores_tecnicos_usuario_id_idx
    on public.inversores_tecnicos (usuario_id);

create index if not exists inversores_tecnicos_inversor_id_idx
    on public.inversores_tecnicos (inversor_id);

-- Migra las asignaciones antiguas de inversores.usuario_id sin duplicarlas.
insert into public.inversores_tecnicos (inversor_id, usuario_id)
select id, usuario_id
from public.inversores
where usuario_id is not null
on conflict (inversor_id, usuario_id) do nothing;

-- Opcional: si quieres crear una vista de diagnóstico para revisar registros.
create or replace view public.v_inversores_api as
select
    i.id,
    i.nombre,
    i.marca,
    i.modelo,
    i.estado,
    i.api_status,
    i.api_last_sync,
    i.api_last_error,
    i.plant_id,
    i.gateway_id,
    i.device_serial,
    i.api_url,
    i.usuario_id
from public.inversores i;

-- Asegura que la Edge Function pueda leer y actualizar el registro.
-- Si RLS está activado, usa políticas para permitir update/select a service role.
-- Esto solo es una preparación; si tu proyecto ya se está usando con RLS, ajusta políticas.

-- Si la base de datos fue creada con RLS activado, no olvides esto:
-- create policy "Service role can manage growatt data" on public.inversores
-- for all using (true) with check (true);
