-- Ejecutar en el SQL Editor de Supabase una sola vez.
-- Reemplaza los valores entre comillas por los secretos reales.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net;

-- Guarda estos valores en Vault. No los pongas en el frontend ni en Git.
-- Si ya existen, usa UPDATE_SECRET en lugar de CREATE_SECRET.
-- Ejecuta estas consultas por separado y reemplaza SOLO la segunda cadena
-- con la service_role key real:
-- select vault.update_secret('https://nojpqnclmhztwwwjqxeh.supabase.co', 'growatt_project_url');
-- select vault.update_secret('TU_CRON_SECRET_REAL', 'growatt_cron_secret');

-- Comprueba qué nombres existen, sin mostrar los secretos:
-- select name from vault.decrypted_secrets
-- where name in ('growatt_project_url', 'growatt_service_role_key');

select cron.unschedule(jobid)
from cron.job
where jobname = 'growatt-sync-every-5-minutes';

select cron.schedule(
    'growatt-sync-every-5-minutes',
    '*/5 * * * *',
    $$
    select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'growatt_project_url')
            || '/functions/v1/growatt-scheduled',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'growatt_cron_secret')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
    );
    $$
);

-- Comprobación:
-- select jobid, jobname, schedule, active from cron.job where jobname = 'growatt-sync-every-5-minutes';
-- select * from cron.job_run_details order by start_time desc limit 10;
