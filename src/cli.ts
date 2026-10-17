import { accessSync, constants, mkdirSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };
import { renderDoctor, runDoctor } from "./agent/doctor.js";
import { detectMode, type EmitOptions, emit } from "./agent/json-mode.js";
import { emitNextSteps, type NextStep } from "./agent/next-steps.js";
import { ERRORES, exitCode, fallo } from "./errores.js";
import { AppError } from "./foundation/error-map.js";
import { DIR_CACHE, type OpcionesHttp } from "./http.js";
import {
  type Estacion,
  estaciones,
  estadoQuebrada,
  MAX_MINUTOS_SIN_IMAGEN,
  normalizar,
  PORTAL,
  sinTildes,
} from "./igp.js";

const CACHE_SEGUNDOS = 60;

const AVISO = [
  "Datos del sistema de monitoreo en tiempo real del IGP. 'activo' significa que el IGP detectó el descenso de un huaico o lahar en la quebrada.",
  `'sin_transmision' significa que la estación no envía datos hace más de ${MAX_MINUTOS_SIN_IMAGEN} minutos: su estado es DESCONOCIDO, no 'sin peligro'.`,
  "El IGP monitorea pocas quebradas: que una quebrada no aparezca no dice nada sobre su peligro.",
  "Ante un huaico, aléjate del cauce y sigue a la autoridad local e INDECI.",
];

const ETIQUETA: Record<string, string> = {
  activo: "ACTIVO",
  no_activo: "no activo",
  sin_transmision: "SIN TRANSMISIÓN (estado desconocido)",
  sin_datos_de_alerta: "transmite imagen, sin datos de alerta",
};

// ---------- Entradas ----------

const region = z.enum(["lima", "piura", "arequipa", "ancash"]).optional().describe("Filtrar por región");
const momento = z
  .string()
  .regex(/(Z|[+-]\d{2}:\d{2})$/, "ISO 8601 con zona horaria")
  .optional()
  .describe("Momento de referencia para calcular si cada estación transmite (por defecto, ahora)");
const sinCache = z.boolean().default(false).describe(`Ignorar la caché local (${CACHE_SEGUNDOS} s)`);

const ENTRADAS = {
  estaciones: z.strictObject({ region, momento, "sin-cache": sinCache }),
  quebrada: z.strictObject({
    nombre: z
      .string()
      .min(2)
      .describe("Nombre de la quebrada, p. ej. Huaycoloro (sin importar tildes ni mayúsculas)"),
    momento,
    "sin-cache": sinCache,
  }),
  schema: z.strictObject({ comando: z.enum(["estaciones", "quebrada", "schema", "doctor"]).optional() }),
  doctor: z.strictObject({ "sin-red": z.boolean().default(false) }),
};
type Comando = keyof typeof ENTRADAS;

const DESCRIPCIONES: Record<Comando, string> = {
  estaciones: "Estado de todas las quebradas que monitorea el IGP, agrupadas por quebrada.",
  quebrada:
    "Estado y detalle de una quebrada: estaciones, última imagen, última alerta, arribos y localidades.",
  schema: "Describe entradas y salidas (JSON Schema).",
  doctor: "Revisa la caché y que el IGP responda.",
};
const SALIDAS: Record<Comando, string> = {
  estaciones:
    "{ ok, momento, resumen: { activo, no_activo, sin_transmision, sin_datos_de_alerta }, quebradas: { quebrada, region, tipo, estado, estaciones: Estacion[] }[], fuente, aviso }",
  quebrada:
    "{ ok, momento, quebrada: { quebrada, region, tipo, estado, estaciones: Estacion[] }, fuente, aviso }",
  schema: "{ ok, comandos } o { ok, comando, descripcion, entrada, salida }",
  doctor: "{ ok, checks: { name, ok, detail }[] }",
};

function leerParams(v: string | undefined): Record<string, unknown> {
  if (!v) return {};
  let p: unknown;
  try {
    p = JSON.parse(v.startsWith("@") ? readFileSync(v.slice(1), "utf8") : v);
  } catch (e) {
    throw fallo("PARAMS_INVALIDOS", `No se pudo leer --params ${v}.`, e);
  }
  if (!p || typeof p !== "object" || Array.isArray(p))
    throw fallo("PARAMS_INVALIDOS", "--params debe ser un objeto JSON.");
  return p as Record<string, unknown>;
}

const http = (e: { "sin-cache"?: boolean }): OpcionesHttp => ({
  cacheSegundos: e["sin-cache"] ? 0 : CACHE_SEGUNDOS,
});
const ahora = (e: { momento?: string }) => (e.momento ? Date.parse(e.momento) : Date.now());
const regionDe = (r: string) => sinTildes(r).replace("ancash", "ancash");

type Quebrada = { quebrada: string; region: string; tipo: string; estado: string; estaciones: Estacion[] };

function agrupar(es: Estacion[]): Quebrada[] {
  const porQuebrada = new Map<string, Estacion[]>();
  for (const e of es) porQuebrada.set(e.quebrada, [...(porQuebrada.get(e.quebrada) ?? []), e]);
  return [...porQuebrada.values()].map((g) => ({
    quebrada: g[0].quebrada,
    region: g[0].region,
    tipo: g[0].tipo,
    estado: estadoQuebrada(g),
    estaciones: g,
  }));
}

async function cargar(e: { "sin-cache"?: boolean; momento?: string }) {
  const r = await estaciones(http(e));
  const m = ahora(e);
  return {
    m,
    lista: r.crudo.map((x) => normalizar(x, m, r.ruta)),
    fuente: { url: PORTAL, obtenido_en: r.obtenido_en },
  };
}

/** "hace 3 min", "hace 5 h", "hace 130 días". */
export function hace(minutos: number): string {
  if (minutos < 120) return `hace ${minutos} min`;
  if (minutos < 48 * 60) return `hace ${Math.floor(minutos / 60)} h`;
  return `hace ${Math.floor(minutos / 1440)} días`;
}

function lineaQuebrada(q: Quebrada): string {
  const tx = q.estaciones.filter((e) => e.transmite).length;
  const min = Math.min(...q.estaciones.map((e) => e.minutos_desde_ultima_imagen ?? Number.POSITIVE_INFINITY));
  const out = [
    `${q.quebrada} (${q.region}, ${q.tipo}): ${ETIQUETA[q.estado]} — ${tx}/${q.estaciones.length} estaciones transmitiendo${Number.isFinite(min) ? `, última imagen ${hace(min)}` : ""}`,
  ];
  for (const e of q.estaciones.filter((x) => x.estado === "activo")) {
    out.push(
      `    ${e.estacion}: velocidad ${e.ultima_alerta?.velocidad ?? "?"}, altura ${e.ultima_alerta?.altura ?? "?"}`,
    );
    for (const a of e.ultima_alerta?.arribos ?? [])
      out.push(`      arribo estimado a ${a.localidad ?? "?"}: ${a.hora_estimada ?? "?"}`);
  }
  for (const e of q.estaciones.filter((x) => !x.transmite && x.ultimo_estado_conocido === "activo")) {
    out.push(
      `    ⚠ ${e.estacion} no transmite y su último estado conocido era ACTIVO (${e.ultima_alerta?.fecha}).`,
    );
  }
  return out.join("\n");
}

type Resultado = { valor: unknown; pasos?: NextStep[]; humano?: () => void; fallido?: boolean };

async function cmdEstaciones(e: z.infer<typeof ENTRADAS.estaciones>): Promise<Resultado> {
  const { m, lista, fuente } = await cargar(e);
  const filtradas = e.region ? lista.filter((x) => regionDe(x.region) === e.region) : lista;
  const quebradas = agrupar(filtradas);
  const resumen = { activo: 0, no_activo: 0, sin_transmision: 0, sin_datos_de_alerta: 0 };
  for (const q of quebradas) resumen[q.estado as keyof typeof resumen]++;
  const valor = { ok: true, momento: new Date(m).toISOString(), resumen, quebradas, fuente, aviso: AVISO };
  const pasos: NextStep[] = quebradas
    .filter((q) => q.estado === "activo")
    .map((q) => ({
      command: `igp-huaicos quebrada "${q.quebrada}"`,
      description: "Detalle de la quebrada activa",
    }));
  const humano = () => {
    const out = ["Quebradas monitoreadas por el IGP:"];
    for (const q of quebradas) out.push(lineaQuebrada(q));
    out.push("", `Fuente: ${fuente.url} (consultado ${fuente.obtenido_en})`);
    for (const a of AVISO) out.push(`! ${a}`);
    process.stdout.write(`${out.join("\n")}\n`);
  };
  return { valor, pasos, humano };
}

async function cmdQuebrada(e: z.infer<typeof ENTRADAS.quebrada>): Promise<Resultado> {
  const { m, lista, fuente } = await cargar(e);
  const buscado = sinTildes(e.nombre).replace(/^(quebrada|qda\.?)\s+/, "");
  const q = agrupar(lista).find((x) => sinTildes(x.quebrada) === buscado);
  if (!q) throw fallo("NO_ENCONTRADO", `El IGP no monitorea una quebrada llamada "${e.nombre}".`);
  const valor = { ok: true, momento: new Date(m).toISOString(), quebrada: q, fuente, aviso: AVISO };
  const humano = () => {
    const out = [lineaQuebrada(q)];
    for (const s of q.estaciones) {
      out.push(
        `  • ${s.estacion}: ${ETIQUETA[s.estado]}; última imagen ${s.ultima_imagen?.fecha ?? "nunca"}; última alerta ${s.ultima_alerta?.fecha ?? "sin datos"}`,
      );
    }
    const locs = q.estaciones.flatMap((s) => s.localidades_cercanas);
    if (locs.length)
      out.push(`  Localidades aguas abajo: ${[...new Set(locs.map((l) => l.nombre))].join("; ")}`);
    for (const a of AVISO) out.push(`! ${a}`);
    process.stdout.write(`${out.join("\n")}\n`);
  };
  return { valor, humano };
}

function cmdSchema(e: z.infer<typeof ENTRADAS.schema>): Resultado {
  if (!e.comando) {
    return {
      valor: {
        ok: true,
        comandos: Object.entries(DESCRIPCIONES).map(([nombre, descripcion]) => ({ nombre, descripcion })),
        estados: ETIQUETA,
      },
    };
  }
  return {
    valor: {
      ok: true,
      comando: e.comando,
      descripcion: DESCRIPCIONES[e.comando],
      entrada: z.toJSONSchema(ENTRADAS[e.comando], { io: "input" }),
      salida: SALIDAS[e.comando],
    },
  };
}

const chequeo = (name: string, fn: () => Promise<{ ok: boolean; detail: string }>) => async () => {
  try {
    return { name, ...(await fn()) };
  } catch (err) {
    return { name, ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
};

async function cmdDoctor(e: z.infer<typeof ENTRADAS.doctor>): Promise<Resultado> {
  const checks = [
    chequeo("cache", async () => {
      try {
        mkdirSync(DIR_CACHE, { recursive: true });
        accessSync(DIR_CACHE, constants.W_OK);
        return { ok: true, detail: DIR_CACHE };
      } catch (err) {
        return { ok: true, detail: `sin caché (${(err as Error).message}); se consultará siempre` };
      }
    }),
  ];
  if (!e["sin-red"]) {
    checks.push(
      chequeo("igp", async () => {
        const { lista } = await cargar({ "sin-cache": true });
        const tx = lista.filter((x) => x.transmite).length;
        return { ok: true, detail: `${lista.length} estaciones leídas; ${tx} transmitiendo ahora` };
      }),
    );
  }
  const r = await runDoctor(checks);
  return { valor: r, fallido: !r.ok };
}

const AYUDA = `igp-huaicos ${pkg.version} — estado en vivo de las quebradas que monitorea el IGP

Uso:
  igp-huaicos estaciones [--region lima|piura|arequipa|ancash]
  igp-huaicos quebrada <nombre>          (p. ej. Huaycoloro)
  igp-huaicos schema [comando]
  igp-huaicos doctor [--sin-red]

Flags globales: --json, --params <json|@archivo>, --momento <ISO>, --sin-cache, -h/--help, --version

Estados: activo, no_activo, sin_transmision (estado DESCONOCIDO), sin_datos_de_alerta.
`;

function parsear(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      region: { type: "string" },
      momento: { type: "string" },
      "sin-cache": { type: "boolean" },
      "sin-red": { type: "boolean" },
      json: { type: "boolean" },
      params: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean" },
    },
  });
}

async function main(argv: string[]) {
  let parsed: ReturnType<typeof parsear>;
  try {
    parsed = parsear(argv);
  } catch (err) {
    throw fallo("ARGS_INVALIDOS", err instanceof Error ? err.message : String(err), err);
  }
  const { values, positionals } = parsed;
  const opts: EmitOptions = { json: values.json };
  if (values.version) return emit({ ok: true, version: pkg.version }, opts, (v) => console.log(v.version));
  const comando = positionals[0];
  if (values.help || !comando) return void process.stdout.write(AYUDA);
  if (!(comando in ENTRADAS)) throw fallo("COMANDO_DESCONOCIDO", `Comando desconocido: ${comando}.`);
  const cmd = comando as Comando;

  const { json: _j, params, help: _h, version: _v, ...flags } = values;
  const crudo: Record<string, unknown> = { ...leerParams(params) };
  for (const [k, v] of Object.entries(flags)) if (v !== undefined) crudo[k] = v;
  const posicional: Partial<Record<Comando, string>> = { quebrada: "nombre", schema: "comando" };
  if (positionals.length > 1) {
    const clave = posicional[cmd];
    if (!clave) throw fallo("ARGS_INVALIDOS", `Argumentos de más: ${positionals.slice(1).join(" ")}`);
    crudo[clave] = positionals.slice(1).join(" "); // "Rio Seco" puede venir sin comillas
  }
  const entrada = ENTRADAS[cmd].safeParse(crudo);
  if (!entrada.success) throw fallo("ARGS_INVALIDOS", z.prettifyError(entrada.error));
  const e: any = entrada.data;

  const r =
    cmd === "estaciones"
      ? await cmdEstaciones(e)
      : cmd === "quebrada"
        ? await cmdQuebrada(e)
        : cmd === "schema"
          ? cmdSchema(e)
          : await cmdDoctor(e);
  if (cmd === "doctor") renderDoctor(r.valor as any, opts);
  else emit(r.valor, opts, r.humano ? () => r.humano?.() : undefined);
  emitNextSteps(r.pasos ?? [], opts);
  if (r.fallido) process.exitCode = 1;
}

/** Punto de entrada (lo llama src/bin.ts). Nunca lanza: todo error sale estructurado con su exit code. */
export async function ejecutar(argv: string[]): Promise<void> {
  try {
    await main(argv);
  } catch (err: unknown) {
    const appErr =
      err instanceof AppError
        ? err
        : new AppError(
            "ERROR_INTERNO",
            { ...ERRORES.ERROR_INTERNO, human: err instanceof Error ? err.message : String(err) },
            err,
          );
    if (detectMode({ json: argv.includes("--json") }) === "json") {
      process.stdout.write(`${JSON.stringify(appErr.toJSON())}\n`);
    } else {
      process.stderr.write(`✗ ${appErr.human}\n${appErr.hint ? `  ${appErr.hint}\n` : ""}`);
    }
    process.exitCode = exitCode(appErr.code);
  }
}
