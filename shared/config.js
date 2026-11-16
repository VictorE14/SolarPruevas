(function () {
    const defaults = {
        supabase: {
            // IMPORTANTE: la clave publishable/anónima es pública y puede ir en el frontend.
            // Nunca agregues service_role_key ni secretos aquí.
            url: 'https://nojpqnclmhztwwwjqxeh.supabase.co',
            anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5vanBxbmNsbWh6dHd3d2pxeGVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyOTI5NjMsImV4cCI6MjEwMDg2ODk2M30.VbgGn_QWdZvF4mYRbU_Vg1Zi_O-JMMbSrWMsmsdx5vw'
        },
        weather: {
            openWeatherApiKey: '',
            solcastApiKey: '',
            solcastSiteId: '',
            latitude: 20.967,
            longitude: -89.592
        },
        app: {
            sessionTtlMinutes: 480,
            demoMode: false
        }
    };

    window.APP_CONFIG = Object.assign({}, defaults, window.APP_CONFIG || {});
    window.APP_CONFIG.supabase = Object.assign({}, defaults.supabase, window.APP_CONFIG.supabase || {});
    window.APP_CONFIG.weather = Object.assign({}, defaults.weather, window.APP_CONFIG.weather || {});
    window.APP_CONFIG.app = Object.assign({}, defaults.app, window.APP_CONFIG.app || {});

    window.SUPABASE_URL = window.APP_CONFIG.supabase.url || '';
    window.SUPABASE_ANON_KEY = window.APP_CONFIG.supabase.anonKey || '';

    window.CONFIG = {
        supabase: window.APP_CONFIG.supabase,
        weather: window.APP_CONFIG.weather,
        app: window.APP_CONFIG.app
    };
})();
