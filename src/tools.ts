import type { FunctionDeclaration } from "@google/genai";
import { config } from "./config";
import { notificarLead } from "./notificar";
import { pausar } from "./pausa";
import {
  guardarLead,
  leadAnterior,
  moeda,
  preferir,
  ranquear,
  type Campo,
} from "./catalogo";
import type { Handler } from "./tool-runner";
import catalogoRaw from "./data/catalogo.json";

/**
 * A CAMADA DO NEGOCIO — Agência de Marketing Digital.
 *
 * Este arquivo, o prompt.ts e o data/catalogo.json são os únicos três que mudam
 * de um nicho para outro. Todo o resto do src/ atravessa sem tocar.
 */

export interface Pacote {
  pacote: string;
  categoria: string;
  descricao: string;
  inclui: string;
  preco: number;
  tipo: "mensal" | "unico";
  disponivel: boolean;
  destaque: boolean;
}

const TODOS = catalogoRaw as Pacote[];

/** Só o que está ativo chega ao modelo. */
const DISPONIVEIS = TODOS.filter((p) => p.disponivel);

/** Categorias disponíveis para o prompt não prometer o que não existe. */
export function categoriasDisponiveis(): string[] {
  const cats = new Set(DISPONIVEIS.map((p) => p.categoria));
  return Array.from(cats);
}

/** A pergunta que o `npm run check` usa para testar function calling. */
export function exemploDeBusca(): string {
  const p = DISPONIVEIS[0];
  return p ? `Quanto custa o pacote ${p.pacote}?` : "Quanto custa o pacote de tráfego?";
}

// ---------------------------------------------------------------------------
// Busca
// ---------------------------------------------------------------------------

function camposDe(p: Pacote): Campo[] {
  return [
    { valor: p.pacote,    peso: 6, pesoExato: 10, colado: true },
    { valor: p.categoria, peso: 5 },
    { valor: p.descricao, peso: 2 },
  ];
}

const LIMIAR = 5;

function ficha(p: Pacote) {
  return {
    pacote: p.pacote,
    categoria: p.categoria,
    descricao: p.descricao,
    inclui: p.inclui,
    preco: moeda(p.preco),
    tipo: p.tipo,
  };
}

function resumo(p: Pacote) {
  const sufixo = p.tipo === "mensal" ? "/mês" : " (único)";
  return { pacote: p.pacote, preco: `${moeda(p.preco)}${sufixo}` };
}

function sugestoes(): string[] {
  return DISPONIVEIS.slice()
    .sort((a, b) => Number(b.destaque) - Number(a.destaque))
    .slice(0, 3)
    .map((p) => p.pacote);
}

function buscarPacote(args: Record<string, unknown>) {
  const termo = typeof args.termo === "string" ? args.termo : "";
  if (!termo.trim()) {
    return { encontrado: false, motivo: "termo vazio", sugestoes: sugestoes() };
  }

  const { melhor, empatados } = ranquear(DISPONIVEIS, termo, camposDe, LIMIAR);

  if (!melhor) {
    return {
      encontrado: false,
      instrucao:
        "Não temos esse serviço no momento. Diga isso e ofereça as sugestões. Não invente preço.",
      sugestoes: sugestoes(),
    };
  }

  if (empatados.length > 1) {
    return {
      encontrado: true,
      ambiguo: true,
      instrucao: "Mais de um pacote bate. Pergunte qual deles o cliente quer.",
      opcoes: empatados.map(ficha),
    };
  }

  return { encontrado: true, ...ficha(melhor) };
}

function listarPacotes(args: Record<string, unknown>) {
  const categoria =
    typeof args.categoria === "string" && args.categoria.trim()
      ? args.categoria.trim()
      : undefined;

  const filtrados = DISPONIVEIS.filter(
    (p) => !categoria || p.categoria === categoria
  ).sort((a, b) => Number(b.destaque) - Number(a.destaque));

  if (filtrados.length === 0) {
    return {
      total: 0,
      pacotes: [],
      instrucao: "Nada disponível nessa categoria agora.",
    };
  }

  const amostra = filtrados.slice(0, 3);

  return {
    total: filtrados.length,
    mostrando: amostra.length,
    pacotes: amostra.map(resumo),
    instrucao:
      filtrados.length > 2
        ? `Temos ${filtrados.length} pacotes. Cite no máximo 2 e faça uma pergunta que estreite. Não liste todos.`
        : "Pode citar os dois.",
  };
}

// ---------------------------------------------------------------------------
// Lead
// ---------------------------------------------------------------------------

/**
 * `type` e não `interface` de propósito: um type alias de objeto é atribuível a
 * Record<string, unknown>, o que deixa este Lead entrar direto no store genérico
 * e no webhook, sem cast nenhum.
 */
export type Lead = {
  nome: string;
  segmento: string;
  temSite: boolean;
  redesSociais: string;
  orcamentoMensal: string;
  melhorHorario: string;
};

/** O texto que chega no WhatsApp de quem vai atender. */
function formatarParaHumano(lead: Lead, telefoneCliente: string): string {
  const linhas = [
    "*Lead qualificado — Marketing Digital*",
    "",
    `Cliente: ${lead.nome}`,
    `WhatsApp: ${telefoneCliente}`,
    `Segmento: ${lead.segmento}`,
    lead.temSite ? "Site: tem site" : "Site: ❌ sem site (oportunidade!)",
    `Redes sociais: ${lead.redesSociais}`,
    `Orçamento mensal: ${lead.orcamentoMensal}`,
    `Melhor horário: ${lead.melhorHorario}`,
    "",
    "Pode assumir a conversa.",
  ];
  return linhas.join("\n");
}

function registrarLead(args: Record<string, unknown>, chatid: string) {
  const anterior = leadAnterior<Lead>(chatid);

  const temSite =
    typeof args.temSite === "boolean"
      ? args.temSite
      : anterior?.temSite ?? false;

  const lead: Lead = {
    nome: preferir(String(args.nome ?? ""), anterior?.nome, "nao informado"),
    segmento: preferir(String(args.segmento ?? ""), anterior?.segmento, "nao informado"),
    temSite,
    redesSociais: preferir(
      String(args.redesSociais ?? ""),
      anterior?.redesSociais,
      "nao informado"
    ),
    orcamentoMensal: preferir(
      String(args.orcamentoMensal ?? ""),
      anterior?.orcamentoMensal,
      "nao informado"
    ),
    melhorHorario: preferir(
      String(args.melhorHorario ?? ""),
      anterior?.melhorHorario,
      "nao agendado"
    ),
  };

  guardarLead(chatid, lead);

  const titulo = anterior ? "LEAD ATUALIZADO" : "LEAD QUALIFICADO";
  console.log(
    `\n===== ${titulo} =====\n` +
      JSON.stringify({ ...lead, registradoEm: new Date().toISOString() }, null, 2) +
      "\n============================\n"
  );

  const telefone = chatid.split("@")[0] ?? chatid;
  notificarLead(lead, formatarParaHumano(lead, telefone), chatid);

  if (config.pausarAposLead) {
    pausar(chatid, config.pausaAposLeadMin * 60_000, "lead registrado, humano assumiu");
  }

  if (anterior) {
    return {
      ok: true,
      jaRegistrado: true,
      instrucao:
        "Esse lead JÁ estava registrado e foi atualizado. NÃO registre de novo. " +
        "Só responda o cliente normalmente.",
    };
  }

  return {
    ok: true,
    instrucao:
      "Lead registrado. Avise que o consultor assume a conversa em instantes. Não pergunte mais nada.",
  };
}

// ---------------------------------------------------------------------------
// Declarações para o Gemini
// ---------------------------------------------------------------------------

export const declaracoes: FunctionDeclaration[] = [
  {
    name: "buscarPacote",
    description:
      "Busca um pacote de marketing pelo nome ou tipo de serviço. Use quando o cliente citar um serviço específico. Única fonte de preço válida.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        termo: {
          type: "string",
          description:
            "O que o cliente falou. Ex: 'tráfego pago', 'gestão de redes', 'landing page'.",
        },
      },
      required: ["termo"],
    },
  },
  {
    name: "listarPacotes",
    description:
      "Mostra os pacotes disponíveis com o total. Use quando o cliente não souber o que quer ou pedir opções. Retorna poucos itens de propósito: cite no máximo 2 na sua mensagem.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        categoria: {
          type: "string",
          description:
            "Filtro opcional por categoria. Ex: 'trafego', 'redes', 'combo', 'site'. Omita para trazer todos.",
        },
      },
    },
  },
  {
    name: "registrarLead",
    description:
      "Registra o lead qualificado e passa para o consultor humano. Chame quando tiver nome, segmento, se tem site, redes sociais, orçamento e melhor horário. Só chame depois de perguntar o horário e ouvir a resposta.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Nome do responsável ou da empresa." },
        segmento: {
          type: "string",
          description: "Ramo do negócio. Ex: 'ótica', 'academia', 'farmácia'.",
        },
        temSite: {
          type: "boolean",
          description: "Se o negócio já tem site.",
        },
        redesSociais: {
          type: "string",
          description:
            "Instagram, Facebook ou outros que o negócio usa. Ex: 'Instagram @loja', 'não tem'.",
        },
        orcamentoMensal: {
          type: "string",
          description:
            "Quanto o negócio pode investir por mês em marketing. Com as palavras do cliente. Ex: 'uns R$ 1.000', 'até R$ 1.500'.",
        },
        melhorHorario: {
          type: "string",
          description:
            "Dia e horário para a reunião que o CLIENTE confirmou. Ex: 'quinta à tarde', 'sexta-feira 28/11, manhã'. Omita se ele recusou ou não respondeu.",
        },
      },
      required: ["nome", "segmento", "temSite", "redesSociais", "orcamentoMensal"],
    },
  },
];

export const handlers: Record<string, Handler> = {
  buscarPacote,
  listarPacotes,
  registrarLead,
};
