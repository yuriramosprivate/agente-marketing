/**
 * Script de configuração ONE-TIME do Google Calendar.
 *
 * Uso:
 *   npx tsx scripts/setup-google.ts
 *
 * Pré-requisitos:
 *   1. No .env: GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET preenchidos
 *   2. No Google Cloud Console: OAuth 2.0 credencial do tipo "Aplicativo da Web"
 *      com redirect URI = http://localhost:3100/callback
 *
 * O script abre o navegador (ou imprime a URL), você autoriza,
 * e ele imprime o GOOGLE_REFRESH_TOKEN para colar no Railway.
 */

import "dotenv/config";
import http from "node:http";
import { google } from "googleapis";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const REDIRECT = "http://localhost:3100/callback";
const SCOPES = ["https://www.googleapis.com/auth/calendar.events"];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "\nERRO: GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET devem estar no .env\n" +
    "Crie as credenciais em: https://console.cloud.google.com/apis/credentials\n" +
    "Tipo: 'Aplicativo da Web', Redirect URI: http://localhost:3100/callback\n"
  );
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
  prompt: "consent",
});

console.log("\n==================================================");
console.log("Acesse essa URL no navegador para autorizar:\n");
console.log(authUrl);
console.log("\n==================================================\n");

// Tenta abrir automaticamente no Windows
try {
  const { exec } = await import("node:child_process");
  exec(`start "" "${authUrl}"`);
} catch {}

// Servidor local para capturar o callback
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost:3100");
  const code = url.searchParams.get("code");

  if (!code) {
    res.end("Nenhum code recebido. Tente novamente.");
    return;
  }

  res.end("Autorizado! Pode fechar esta aba e voltar para o terminal.");

  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log("\n✅ SUCESSO! Adicione ao Railway Variables:\n");
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log(`GOOGLE_CLIENT_ID=${CLIENT_ID}`);
    console.log(`GOOGLE_CLIENT_SECRET=${CLIENT_SECRET}`);
    console.log(`GOOGLE_CALENDAR_ID=yuriramosdotrafego@gmail.com`);
    console.log("\n(Nunca commite essas chaves no git!)\n");
  } catch (e) {
    console.error("Erro ao trocar code por token:", e);
  }

  server.close();
});

server.listen(3100, () => {
  console.log("Aguardando callback do Google em http://localhost:3100/callback ...\n");
});
