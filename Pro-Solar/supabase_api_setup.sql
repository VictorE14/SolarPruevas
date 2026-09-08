-- Ejecutar en Supabase antes de guardar la configuración API desde el panel.
-- Para producción, api_password y api_token deben quedar protegidos y solo leerse
-- desde una Edge Function / backend autenticado.

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
