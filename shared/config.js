(function () {
    const defaults = {
        supabase: {
            // IMPORTANTE: la clave publishable/anónima es pública y puede ir en el frontend.
            // Nunca agregues service_role_key ni secretos aquí.
            url: 'https://nojpqnclmhztwwwjqxeh.supabase.co',
            anonKey: 'sb_publishable_c1dQXRr2bI5BwuZ2O2WViw_YVTxEs1M'
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
