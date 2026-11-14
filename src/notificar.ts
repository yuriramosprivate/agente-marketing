import { config } from "./config";
import { enviarTexto } from "./whatsapp";
import type { Lead } from "./tools";

/**
 * Entrega do lead pronto. Dois destinos, ambos opcionais e independentes.
 *
 * 1. WhatsApp de quem vai atender -- o lead mastigado chega no celular da
 *    pessoa, sem ninguem precisar abrir painel nenhum.
 * 2. Webhook generico -- POST do lead em JSON para n8n, Make, Zapier, Trello ou
 *    o CRM que o negocio ja usa. E o ponto de encaixe: o cliente NAO troca de
 *    ferramenta, so passa a receber o lead qualificado dentro da que ele ja tem.
 *
 * Tudo aqui e best-effort: falhar em notificar nao pode derrubar o atendimento,
 * porque o lead ja esta registrado no log de qualquer forma.
 *
 * Generico de proposito: quem monta o texto da mensagem e tools.ts, que conhece
 * os campos do lead deste nicho. Aqui so entrega.
 */

async function avisarHumano(mensagem: string): Promise<void> {
  if (!config.humanoWhatsapp) return;
  await enviarTexto(config.humanoWhatsapp, mensagem);
}

async function dispararWebhook(lead: Record<string, unknown>, chatid: string): Promise<void> {
  if (!config.leadWebhookUrl) return;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(config.leadWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...lead,
        telefone: chatid.split("@")[0],
        empresa: config.empresaNome,
        registradoEm: new Date().toISOString(),
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) console.warn(`[notificar] webhook ${res.status} (ignorado)`);
    else console.log("[notificar] webhook entregue");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Dispara as notificacoes sem bloquear a resposta ao cliente.
 */
export function notificarLead(
  lead: Record<string, unknown>,
  mensagem: string,
  chatid: string
): void {
  void avisarHumano(mensagem).catch((e) =>
    console.warn("[notificar] whatsapp falhou (ignorado):", e instanceof Error ? e.message : e)
  );
  void dispararWebhook(lead, chatid).catch((e) =>
    console.warn("[notificar] webhook falhou (ignorado):", e instanceof Error ? e.message : e)
  );
}

/**
 * Envia o resumo do lead para o grupo de prospecção no WhatsApp.
 * Menciona @amor❤️ para alertar quem cuida dos leads.
 *
 * Best-effort: falha aqui nao afeta o atendimento.
 */
export function notificarGrupoLeads(lead: Lead, telefoneCliente: string): void {
  if (!config.leadsGroupJid || !config.uazapiUrl || !config.uazapiToken) return;

  const linhas = [
    "🎯 *Novo lead prospectado!*",
    "",
    `👤 *Cliente:* ${lead.nome}`,
    `📱 *WhatsApp:* ${telefoneCliente}`,
    lead.emailLead ? `📧 *E-mail:* ${lead.emailLead}` : "",
    `🏢 *Segmento:* ${lead.segmento}`,
    lead.temSite ? "🌐 *Site:* tem site" : "🌐 *Site:* ❌ sem site",
    `📱 *Redes:* ${lead.redesSociais}`,
    `💰 *Orçamento:* ${lead.orcamentoMensal}`,
    lead.melhorHorario !== "nao agendado"
      ? `📅 *Horário:* ${lead.melhorHorario}`
      : "",
    "",
    `@${config.amorWhatsapp} 👀`,
  ].filter((l) => l !== "");

  const texto = linhas.join("\n");
  const mentions = config.amorWhatsapp ? [`${config.amorWhatsapp}@s.whatsapp.net`] : [];

  void fetch(`${config.uazapiUrl}/send/text`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      token: config.uazapiToken,
    },
    body: JSON.stringify({
      chatid: config.leadsGroupJid,
      text: texto,
      mentions,
    }),
  })
    .then((r) => {
      if (!r.ok) console.warn(`[notificar] grupo ${r.status} (ignorado)`);
      else console.log("[notificar] grupo de leads notificado");
    })
    .catch((e) =>
      console.warn("[notificar] grupo falhou (ignorado):", e instanceof Error ? e.message : e)
    );
}
