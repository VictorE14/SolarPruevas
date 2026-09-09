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
