// Lectura del sistema de monitoreo de lahares y huaicos del IGP (grd.igp.gob.pe/lahares-huaicos).
// Ver RESEARCH.md: la página consulta GET /<ruta>/medias y escucha eventos socket.io.
import { z } from "zod";
import { fallo } from "./errores.js";
import { type OpcionesHttp, pedir } from "./http.js";

export const BASE = process.env.IGP_HUAICOS_BASE || "https://grd.igp.gob.pe";
export const PORTAL = `${BASE}/lahares-huaicos/`;
/** Segmento ofuscado de la API, tomado del bundle del portal (octubre de 2026). Si cambia, se redescubre. */
export const RUTA_CONOCIDA = "Lq5aA7wpZ77tSYiPg7YmjHi3VnkSJ9pE";

/** Una estación transmite si su cámara envió una imagen hace menos de esto (en Lima llegan cada 1-2 min). */
export const MAX_MINUTOS_SIN_IMAGEN = 30;

const marcaTiempo = z
  .number()
  .refine((s) => s > 1_577_836_800 && s < 4_102_444_800, "marca de tiempo inválida");

export const EstacionIgp = z.looseObject({
  id_estacion: z.string().min(1),
  grupo: z.string().min(1),
  nombre_quebrada: z.string().min(1),
  nombre_estacion: z.string().min(1),
  localidades_cercanas: z
    .array(z.looseObject({ nombre: z.string(), distancia: z.number().nullable().optional() }))
    .nullable()
    .optional(),
  ultima_imagen: z.looseObject({ ruta_imagen: z.string(), actualizado_a: marcaTiempo }).nullable().optional(),
  ultima_alerta: z
    .looseObject({
      actividad_lahar: z.boolean(),
      arrivos: z.unknown().optional(),
      velocidad_lahar: z.number().nullable().optional(),
      altura_lahar: z.number().nullable().optional(),
      actualizado_a: marcaTiempo,
    })
    .nullable()
    .optional(),
});
export type EstacionIgp = z.infer<typeof EstacionIgp>;

const REGIONES: Record<string, string> = { lima: "Lima", piur: "Piura", areq: "Arequipa", huaraz: "Áncash" };

export type Estado = "activo" | "no_activo" | "sin_transmision" | "sin_datos_de_alerta";

const iso = (s: number) => new Date(s * 1000).toISOString();

/** Arribos estimados a localidades: el IGP los envía como lista (o, en versiones viejas, como objeto). */
function arribos(v: unknown): { localidad: string | null; hora_estimada: unknown }[] {
  const lista = Array.isArray(v) ? v : v && typeof v === "object" ? [v] : [];
  return lista.map((a: any) => ({
    localidad: a?.localidad ?? a?.nombre ?? null,
    hora_estimada: a?.hora_estimada ?? null,
  }));
}

export function normalizar(e: EstacionIgp, ahora: number, ruta = RUTA_CONOCIDA) {
  const prefijo = e.grupo.split("/")[0];
  const img = e.ultima_imagen?.actualizado_a;
  const minutosSinImagen = img ? Math.floor((ahora - img * 1000) / 60_000) : null;
  const transmite = minutosSinImagen !== null && minutosSinImagen <= MAX_MINUTOS_SIN_IMAGEN;
  const a = e.ultima_alerta;
  const estado: Estado = !transmite
    ? "sin_transmision"
    : !a
      ? "sin_datos_de_alerta"
      : a.actividad_lahar
        ? "activo"
        : "no_activo";
  return {
    id: e.id_estacion,
    estacion: e.nombre_estacion,
    quebrada: e.nombre_quebrada,
    region: REGIONES[prefijo] ?? prefijo,
    tipo: e.grupo.includes("lahar") ? ("lahar" as const) : ("huaico" as const),
    estado,
    transmite,
    minutos_desde_ultima_imagen: minutosSinImagen,
    ultima_imagen: img
      ? { fecha: iso(img), url: `${BASE}/${ruta}/media/${e.ultima_imagen?.ruta_imagen}` }
      : null,
    ultima_alerta: a
      ? {
          actividad: a.actividad_lahar,
          fecha: iso(a.actualizado_a),
          // Velocidad y altura solo tienen sentido con actividad (sin ella el IGP envía 1.0). Unidades no documentadas.
          velocidad: a.actividad_lahar ? (a.velocidad_lahar ?? null) : null,
          altura: a.actividad_lahar ? (a.altura_lahar ?? null) : null,
          arribos: arribos(a.arrivos),
        }
      : null,
    /** Si no transmite, lo último que se supo (puede ser "activo"). */
    ultimo_estado_conocido: a ? (a.actividad_lahar ? "activo" : "no_activo") : null,
    localidades_cercanas: (e.localidades_cercanas ?? []).map((l) => ({
      nombre: l.nombre,
      distancia_km: l.distancia ?? null,
    })),
  };
}
export type Estacion = ReturnType<typeof normalizar>;

/** Peor estado entre estaciones de una quebrada: activo > no_activo > sin datos > sin transmisión. */
export function estadoQuebrada(es: Estacion[]): Estado {
  if (es.some((e) => e.estado === "activo")) return "activo";
  if (es.some((e) => e.estado === "no_activo")) return "no_activo";
  if (es.some((e) => e.estado === "sin_datos_de_alerta")) return "sin_datos_de_alerta";
  return "sin_transmision";
}

export function leerEstaciones(json: unknown): EstacionIgp[] {
  const r = z.array(EstacionIgp).min(1).safeParse(json);
  if (!r.success)
    throw fallo(
      "FORMATO_INESPERADO",
      `Respuesta del IGP inesperada: ${z.prettifyError(r.error).slice(0, 300)}`,
    );
  return r.data;
}

/** Busca en el bundle del portal la ruta actual de la API (`https://grd.igp.gob.pe/<ruta>/medias`). */
export async function descubrirRuta(o: OpcionesHttp): Promise<string> {
  const html = (await pedir(PORTAL, o)).cuerpo;
  const js = /src="([^"]*\/assets\/index-[^"]+\.js)"/.exec(html)?.[1];
  if (!js) throw fallo("FORMATO_INESPERADO", "No se encontró el código del portal del IGP.");
  const bundle = (await pedir(new URL(js, PORTAL).href, o)).cuerpo;
  const ruta = /grd\.igp\.gob\.pe\/([A-Za-z0-9]{16,})\/medias/.exec(bundle)?.[1];
  if (!ruta) throw fallo("FORMATO_INESPERADO", "No se encontró la ruta de la API en el portal del IGP.");
  return ruta;
}

export async function estaciones(
  o: OpcionesHttp,
): Promise<{ crudo: EstacionIgp[]; obtenido_en: string; ruta: string }> {
  let ruta = RUTA_CONOCIDA;
  let r: Awaited<ReturnType<typeof pedir>>;
  try {
    r = await pedir(`${BASE}/${ruta}/medias`, o);
  } catch (e) {
    if (!/HTTP 404/.test((e as Error).message)) throw e;
    ruta = await descubrirRuta(o);
    r = await pedir(`${BASE}/${ruta}/medias`, o);
  }
  let json: unknown;
  try {
    json = JSON.parse(r.cuerpo);
  } catch (e) {
    throw fallo("FORMATO_INESPERADO", "El IGP no devolvió JSON.", e);
  }
  return { crudo: leerEstaciones(json), obtenido_en: r.obtenido_en, ruta };
}

export const sinTildes = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
