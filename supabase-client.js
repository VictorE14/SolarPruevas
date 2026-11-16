// supabase-client.js
// Load Supabase SDK from CDN and create window.db with required methods.
// Uses mock data when no credentials are provided.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL = "https://nojpqnclmhztwwwjqxeh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5vanBxbmNsbWh6dHd3d2pxeGVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyOTI5NjMsImV4cCI6MjEwMDg2ODk2M30.VbgGn_QWdZvF4mYRbU_Vg1Zi_O-JMMbSrWMsmsdx5vw";

// Exponer variables globales para shared/supabase.js
if (typeof window !== "undefined") {
  window.SUPABASE_URL = SUPABASE_URL;
  window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
}

let client = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// Export a supabase object compatible with shared/supabase.js
if (typeof window !== "undefined") {
  window.supabase = {
    // Returns the already‑created client (or null)
    createClient: () => client,
  };
}

// -----------------------------------------------------------------
// Define window.db with the methods that script.js expects
// -----------------------------------------------------------------
if (client) {
  // Real Supabase client implementation
  window.db = {
    async getAllInversores() {
      const { data, error } = await client.from("inversores").select("*");
      if (error) throw error;
      return data;
    },
    async getInversoresByUsuario(usuarioId) {
      const { data, error } = await client
        .from("inversores")
        .select("*")
        .eq("usuario_id", usuarioId);
      if (error) throw error;
      return data;
    },
    async getUltimaLectura(inversorId) {
      const now = new Date();
      return {
        timestamp: now.toISOString(),
        potencia_ac: Math.random() * 5 + 1,
        energia_dia: Math.random() * 30 + 10,
        estado_operativo: "online",
      };
    },
    async getLecturasByInversor(inversorId, limit = 100) {
      const now = Date.now();
      const lecturas = [];
      for (let i = 0; i < limit; i++) {
        const ts = new Date(now - i * 60 * 1000).toISOString();
        lecturas.push({
          timestamp: ts,
          potencia_ac: Math.random() * 5 + 1,
          energia_dia: Math.random() * 30 + 10,
        });
      }
      return lecturas;
    },
    async getOwnNotificationSettings(userId, emailFallback = "") {
      const { data, error } = await client
        .from('preferencias_notificaciones')
        .select('email_destino,whatsapp_numero,email_habilitado,whatsapp_habilitado,whatsapp_consentimiento')
        .eq('usuario_id', userId)
        .maybeSingle();
      if (error) throw error;
      return {
        email_destino: data?.email_destino || emailFallback,
        whatsapp_numero: data?.whatsapp_numero || "",
        email_habilitado: data?.email_habilitado ?? true,
        whatsapp_habilitado: data?.whatsapp_habilitado ?? false,
        whatsapp_consentimiento: data?.whatsapp_consentimiento ?? false,
      };
    },
    async saveOwnNotificationSettings(userId, settings) {
      const { error } = await client
        .from('preferencias_notificaciones')
        .upsert({
          usuario_id: userId,
          email_destino: settings.email_destino || null,
          whatsapp_numero: settings.whatsapp_numero || null,
          email_habilitado: settings.email_habilitado,
          whatsapp_habilitado: settings.whatsapp_habilitado,
          whatsapp_consentimiento: settings.whatsapp_consentimiento,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'usuario_id' });
      if (error) throw error;
      return settings;
    },
    async evaluarAlertasInversor(_inv, _lect) {
      // Placeholder – implement alert logic in production.
      return;
    },
  };
} else {
  // -----------------------------------------------------------------
  // MOCK MODE – used when Supabase credentials are missing.
  // -----------------------------------------------------------------
  console.warn("⚠️ Supabase no está configurado – usando datos mock.");
  const mockInversores = [
    {
      id: "inv-001",
      nombre: "Inversor 1",
      marca: "Growatt",
      modelo: "GW10K",
      ubicacion: "Planta A",
      estado: "online",
    },
    {
      id: "inv-002",
      nombre: "Inversor 2",
      marca: "Huawei",
      modelo: "SUN2000",
      ubicacion: "Planta B",
      estado: "warning",
    },
  ];
  window.db = {
    async getAllInversores() {
      await new Promise(r => setTimeout(r, 200));
      return mockInversores;
    },
    async getInversoresByUsuario(_uid) {
      await new Promise(r => setTimeout(r, 200));
      return mockInversores;
    },
    async getUltimaLectura(_id) {
      const now = new Date();
      return {
        timestamp: now.toISOString(),
        potencia_ac: Math.random() * 5 + 1,
        energia_dia: Math.random() * 30 + 10,
        estado_operativo: "online",
      };
    },
    async getLecturasByInversor(_id, limit = 100) {
      const now = Date.now();
      const lecturas = [];
      for (let i = 0; i < limit; i++) {
        const ts = new Date(now - i * 60 * 1000).toISOString();
        lecturas.push({
          timestamp: ts,
          potencia_ac: Math.random() * 5 + 1,
          energia_dia: Math.random() * 30 + 10,
        });
      }
      return lecturas;
    },
    async evaluarAlertasInversor(_inv, _lect) {
      return;
    },
    // Mock notification settings methods
    async getOwnNotificationSettings(_userId, emailFallback = "") {
      return {
        email_destino: emailFallback,
        whatsapp_numero: "",
        email_habilitado: true,
        whatsapp_habilitado: false,
        whatsapp_consentimiento: false,
      };
    },
    async saveOwnNotificationSettings(_userId, settings) {
      return settings;
    },
  };
}
