-- Preferencias de contacto ingresadas por cada usuario (permisivas para la app de prueba).
create table if not exists public.preferencias_notificaciones (
    usuario_id uuid primary key references public.usuarios(id) on delete cascade,
    email_destino text,
    whatsapp_numero text,
    email_habilitado boolean not null default true,
    whatsapp_habilitado boolean not null default false,
    whatsapp_consentimiento boolean not null default false,
    updated_at timestamptz not null default now(),
    constraint preferencias_notificaciones_email_check
        check (email_destino is null or email_destino ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
    constraint preferencias_notificaciones_whatsapp_check
        check (whatsapp_numero is null or whatsapp_numero ~ '^\+[1-9][0-9]{7,14}$'),
    constraint preferencias_notificaciones_whatsapp_optin_check
        check (not whatsapp_habilitado or (whatsapp_numero is not null and whatsapp_consentimiento))
);

alter table public.preferencias_notificaciones enable row level security;
drop policy if exists "Preferencias de notificación para pruebas" on public.preferencias_notificaciones;
create policy "Preferencias de notificación para pruebas"
    on public.preferencias_notificaciones
    for all
    to anon, authenticated
    using (true)
    with check (true);
grant select, insert, update, delete on public.preferencias_notificaciones to anon, authenticated, service_role;

-- Una sola entrega por alerta, usuario y canal.
create table if not exists public.notificaciones_destinatarios_envios (
    alerta_id uuid not null references public.alertas(id) on delete cascade,
    usuario_id uuid not null references public.usuarios(id) on delete cascade,
    canal text not null check (canal in ('correo', 'whatsapp')),
    estado text not null default 'pendiente' check (estado in ('pendiente', 'enviado', 'error')),
    proveedor_id text,
    error text,
    creado_en timestamptz not null default now(),
    enviado_en timestamptz,
    primary key (alerta_id, usuario_id, canal)
);

alter table public.notificaciones_destinatarios_envios enable row level security;
revoke all on public.notificaciones_destinatarios_envios from public, anon, authenticated;
grant all on public.notificaciones_destinatarios_envios to service_role;

-- Mantiene el comportamiento abierto del dashboard en esta versión de prueba.
grant select, insert, update, delete on public.alertas to anon, authenticated;
