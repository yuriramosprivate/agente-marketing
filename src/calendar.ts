import { google } from "googleapis";
import { config } from "./config";

/**
 * Agenda um evento no Google Calendar do consultor e envia convite ao lead.
 *
 * Requer: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN no env.
 * Se qualquer var estiver ausente, retorna sem fazer nada (best-effort).
 */
export async function agendarNoCalendar(params: {
  tituloReuniao: string;
  horarioIso: string; // "2026-11-20T09:00:00"
  emailLead: string;
  nomeContato: string;
  resumo: string;
}): Promise<void> {
  if (!config.googleClientId || !config.googleClientSecret || !config.googleRefreshToken) {
    console.warn("[calendar] credenciais do Google ausentes -- evento nao criado");
    return;
  }

  const auth = new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret
  );
  auth.setCredentials({ refresh_token: config.googleRefreshToken });

  const calendar = google.calendar({ version: "v3", auth });

  const inicio = new Date(params.horarioIso);
  const fim = new Date(inicio.getTime() + 60 * 60 * 1000); // +1h

  const evento = {
    summary: params.tituloReuniao,
    description: params.resumo,
    start: { dateTime: inicio.toISOString(), timeZone: config.timezone },
    end: { dateTime: fim.toISOString(), timeZone: config.timezone },
    attendees: [
      { email: config.googleCalendarId, responseStatus: "accepted" },
      { email: params.emailLead },
    ],
    conferenceData: {
      createRequest: {
        requestId: `lead-${Date.now()}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  };

  const resp = await calendar.events.insert({
    calendarId: config.googleCalendarId || "primary",
    requestBody: evento,
    conferenceDataVersion: 1,
    sendUpdates: "all",
  });

  const link = resp.data.htmlLink ?? "(sem link)";
  const meet = resp.data.conferenceData?.entryPoints?.[0]?.uri ?? "";
  console.log(`[calendar] evento criado: ${link}`);
  if (meet) console.log(`[calendar] Google Meet: ${meet}`);
}
