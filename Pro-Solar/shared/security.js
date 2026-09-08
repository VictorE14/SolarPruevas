(function () {
    const SESSION_KEY = 'crode_solar_session';
    const DEFAULT_TTL_MS = ((window.APP_CONFIG && window.APP_CONFIG.app && window.APP_CONFIG.app.sessionTtlMinutes) || 480) * 60 * 1000;

    function normalizeSession(rawSession) {
        if (!rawSession || !rawSession.user) return null;
        if (!rawSession.expiresAt || Number(rawSession.expiresAt) <= Date.now()) {
            clearSession();
            return null;
        }
        return rawSession;
    }

    function readSession() {
        try {
            const sessionStorageValue = sessionStorage.getItem(SESSION_KEY);
            if (!sessionStorageValue) return null;
            return normalizeSession(JSON.parse(sessionStorageValue));
        } catch (error) {
            clearSession();
            return null;
        }
    }

    function writeSession(user) {
        if (!user || !user.id) return null;
        const session = {
            user: {
                ...user,
                password_hash: undefined
            },
            expiresAt: Date.now() + DEFAULT_TTL_MS
        };

        try {
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
        } catch (error) {
            console.warn('No se pudo guardar la sesión en sessionStorage:', error);
        }

        return session;
    }

    function clearSession() {
        sessionStorage.removeItem(SESSION_KEY);
        localStorage.removeItem('usuarioActual');
    }

    function getUser() {
        const session = readSession();
        return session ? session.user : null;
    }

    function isValid() {
        return Boolean(getUser());
    }

    window.CRODE_SESSION = {
        read: readSession,
        write: writeSession,
        clear: clearSession,
        getUser,
        isValid
    };
})();
