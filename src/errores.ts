import { AppError, type ErrorMap } from "./foundation/error-map.js";

export const ERRORES = {
  ARGS_INVALIDOS: {
    name: "ArgsInvalidos",
    human: "Parámetros inválidos.",
    hint: "Revisa los parámetros con `igp-huaicos schema <comando>`.",
  },
  COMANDO_DESCONOCIDO: {
    name: "ComandoDesconocido",
    human: "Comando desconocido.",
    hint: "Comandos: estaciones, quebrada, schema, doctor. Usa `igp-huaicos --help`.",
  },
  PARAMS_INVALIDOS: {
    name: "ParamsInvalidos",
    human: "No se pudo leer --params.",
    hint: "--params acepta un objeto JSON en línea o @ruta/al/archivo.json.",
  },
  NO_ENCONTRADO: {
    name: "NoEncontrado",
    human: "No hay una quebrada monitoreada con ese nombre.",
    hint: "Usa `igp-huaicos estaciones` para ver las quebradas que monitorea el IGP.",
  },
  FUENTE_NO_DISPONIBLE: {
    name: "FuenteNoDisponible",
    human: "No se pudo consultar al IGP.",
    hint: "No se puede saber el estado de las quebradas. Revisa https://grd.igp.gob.pe/lahares-huaicos/ y sigue a las autoridades locales.",
  },
  FORMATO_INESPERADO: {
    name: "FormatoInesperado",
    human: "El IGP cambió el formato de su publicación.",
    hint: "No se puede saber el estado de las quebradas. Revisa https://grd.igp.gob.pe/lahares-huaicos/ y reporta un issue.",
  },
  ERROR_INTERNO: {
    name: "ErrorInterno",
    human: "Error inesperado.",
    hint: "Abre un issue con el comando exacto que corriste.",
  },
} satisfies ErrorMap;

export type Codigo = keyof typeof ERRORES;

export const exitCode = (code: string) =>
  ["ARGS_INVALIDOS", "COMANDO_DESCONOCIDO", "PARAMS_INVALIDOS"].includes(code) ? 2 : 1;

export const fallo = (code: Codigo, detalle?: string, causa?: unknown) =>
  new AppError(code, detalle ? { ...ERRORES[code], human: detalle } : ERRORES[code], causa);
