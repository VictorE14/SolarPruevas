-- ============================================================
-- CRODE SOLAR - ESQUEMA DE LA BASE DE DATOS DE SUPABASE
-- Sincronizado con el esquema compartido desde Supabase.
-- ============================================================

create extension if not exists "uuid-ossp";

create table if not exists public.usuarios (
    id uuid not null default uuid_generate_v4(),
    nombre text not null,
    email text not null unique,
    password_hash text not null,
    rol text default 'tecnico'::text
        check (rol = any (array['admin'::text, 'tecnico'::text, 'invitado'::text])),
    estado text default 'activo'::text
        check (estado = any (array['activo'::text, 'inactivo'::text])),
    ultimo_acceso timestamp without time zone,
    created_at timestamp without time zone default now(),
    updated_at timestamp without time zone default now(),
    constraint usuarios_pkey primary key (id)
);

create table if not exists public.inversores (
    id uuid not null default uuid_generate_v4(),
    nombre text not null,
    marca text not null
        check (marca = any (array['Huawei'::text, 'Growatt'::text, 'Otra'::text])),
    modelo text,
    ubicacion text,
    capacidad_kw numeric,
    estado text default 'offline'::text
        check (estado = any (array['online'::text, 'warning'::text, 'offline'::text])),
    usuario_id uuid,
    tipo_conexion text not null default 'api'::text
        check (tipo_conexion = any (array['api'::text, 'modbus'::text])),
    ip_modbus text,
    puerto_modbus integer default 502,
    modbus_slave_id integer default 1,
    modbus_timeout integer default 5000,
    modbus_register_map jsonb,
    modbus_baudrate integer,
    modbus_parity text default 'none'::text,
    huawei_usuario text,
    huawei_password text,
    huawei_app_id text,
    huawei_app_secret text,
    huawei_plant_code text,
    growatt_usuario text,
    growatt_password text,
    growatt_api_key text,
    growatt_serial_number text,
    frecuencia_lectura integer default 60,
    ultima_lectura timestamp without time zone,
    created_at timestamp without time zone default now(),
    updated_at timestamp without time zone default now(),
    api_url text,
    plant_id text,
    gateway_id text,
    device_serial text,
    api_username text,
    api_password text,
    api_token text,
    api_status text default 'pending'::text
        check (api_status = any (array['pending'::text, 'connected'::text, 'error'::text, 'disabled'::text])),
    api_last_sync timestamp with time zone,
    api_last_error text,
    constraint inversores_pkey primary key (id),
    constraint inversores_usuario_id_fkey
        foreign key (usuario_id) references public.usuarios(id)
);

create table if not exists public.lecturas_historicas (
    id uuid not null default uuid_generate_v4(),
    inversor_id uuid not null,
    timestamp timestamp without time zone default now(),
    voltaje_dc numeric,
    corriente_dc numeric,
    potencia_ac numeric,
    energia_dia numeric,
    energia_total numeric,
    temperatura numeric,
    frecuencia numeric,
    estado_operativo text
        check (estado_operativo = any (array['online'::text, 'offline'::text, 'warning'::text])),
    constraint lecturas_historicas_pkey primary key (id),
    constraint lecturas_historicas_inversor_id_fkey
        foreign key (inversor_id) references public.inversores(id)
);

create table if not exists public.alertas (
    id uuid not null default uuid_generate_v4(),
    inversor_id uuid not null,
    tipo text not null
        check (tipo = any (array[
            'Comunicación'::text, 'Conexión'::text, 'API'::text, 'Rendimiento'::text,
            'Temperatura'::text, 'Mantenimiento'::text, 'Sistema'::text, 'Otro'::text
        ])),
    mensaje text not null,
    fecha timestamp without time zone default now(),
    resuelta boolean default false,
    resuelta_por uuid,
    fecha_resolucion timestamp without time zone,
    constraint alertas_pkey primary key (id),
    constraint alertas_inversor_id_fkey
        foreign key (inversor_id) references public.inversores(id),
    constraint alertas_resuelta_por_fkey
        foreign key (resuelta_por) references public.usuarios(id)
);

create table if not exists public.reglas_alertas (
    id uuid not null default uuid_generate_v4(),
    nombre text not null,
    condicion text not null,
    accion text not null,
    destinatarios jsonb,
    estado text default 'Activa'::text
        check (estado = any (array['Activa'::text, 'Inactiva'::text])),
    created_at timestamp without time zone default now(),
    constraint reglas_alertas_pkey primary key (id)
);

create table if not exists public.logs_actividad (
    id uuid not null default uuid_generate_v4(),
    usuario_id uuid,
    usuario_nombre text,
    accion text not null,
    descripcion text,
    ip text,
    fecha timestamp without time zone default now(),
    constraint logs_actividad_pkey primary key (id),
    constraint logs_actividad_usuario_id_fkey
        foreign key (usuario_id) references public.usuarios(id)
);

create table if not exists public.configuracion_sistema (
    id uuid not null default uuid_generate_v4(),
    clave text not null unique,
    valor text,
    descripcion text,
    updated_at timestamp without time zone default now(),
    constraint configuracion_sistema_pkey primary key (id)
);

create table if not exists public.inversores_tecnicos (
    inversor_id uuid not null,
    usuario_id uuid not null,
    created_at timestamp with time zone not null default now(),
    constraint inversores_tecnicos_pkey primary key (inversor_id, usuario_id),
    constraint inversores_tecnicos_inversor_id_fkey
        foreign key (inversor_id) references public.inversores(id),
    constraint inversores_tecnicos_usuario_id_fkey
        foreign key (usuario_id) references public.usuarios(id)
);

create table if not exists public.preferencias_notificaciones (
    usuario_id uuid not null primary key references public.usuarios(id) on delete cascade,
    email_destino text,
    telegram_chat_id text,
    telegram_habilitado boolean not null default false,
    telegram_consentimiento boolean not null default false,
    whatsapp_numero text,
    email_habilitado boolean default true,
    whatsapp_habilitado boolean default false,
    whatsapp_consentimiento boolean default false,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now()
);

alter table public.preferencias_notificaciones
    add column if not exists telegram_chat_id text,
    add column if not exists telegram_habilitado boolean not null default false,
    add column if not exists telegram_consentimiento boolean not null default false;
