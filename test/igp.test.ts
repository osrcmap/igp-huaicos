import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type EstacionIgp, estadoQuebrada, leerEstaciones, normalizar, RUTA_CONOCIDA } from "../src/igp.js";

// Respuesta real de /medias capturada el 2026-10-17 a las 05:29 (hora de Perú).
const FX = join(import.meta.dir, "fixtures");
const crudo: EstacionIgp[] = leerEstaciones(JSON.parse(readFileSync(join(FX, "medias.json"), "utf8")));
const MOMENTO = "2026-10-17T05:30:00-05:00";
const T = Date.parse(MOMENTO);
const por = (id: string) => crudo.find((e) => e.id_estacion === id) as EstacionIgp;

/** Copia sintética de Huaycoloro1 en actividad (el IGP no tenía alertas activas al capturar). */
const activa = (minutosImagen = 1): EstacionIgp => ({
  ...structuredClone(por("Huaycoloro1")),
  ultima_imagen: { ruta_imagen: "x.png", actualizado_a: (T - minutosImagen * 60_000) / 1000 },
  ultima_alerta: {
    actividad_lahar: true,
    velocidad_lahar: 4.2,
    altura_lahar: 1.3,
    actualizado_a: (T - 60_000) / 1000,
    arrivos: [{ localidad: "Cajamarquilla", hora_estimada: "05:52" }],
  },
});

describe("normalizar", () => {
  test("Lima transmite y no está activa; Arequipa no transmite (estado desconocido)", () => {
    expect(normalizar(por("Huaycoloro1"), T)).toMatchObject({
      quebrada: "Huaycoloro",
      region: "Lima",
      tipo: "huaico",
      estado: "no_activo",
      transmite: true,
    });
    const areq = normalizar(por("AREQ_HRL_1"), T);
    expect([areq.estado, areq.tipo, areq.region]).toEqual(["sin_transmision", "lahar", "Arequipa"]);
  });

  test("límite de transmisión: 30 min sí, 31 min no", () => {
    expect(normalizar(activa(30), T).estado).toBe("activo");
    expect(normalizar(activa(31), T).estado).toBe("sin_transmision");
    expect(normalizar(activa(31), T).ultimo_estado_conocido).toBe("activo");
  });

  test("activa: velocidad, altura y arribos; inactiva: sin velocidad ni altura (el IGP envía 1.0)", () => {
    const a = normalizar(activa(), T);
    expect(a.ultima_alerta).toMatchObject({ actividad: true, velocidad: 4.2, altura: 1.3 });
    expect(a.ultima_alerta?.arribos).toEqual([{ localidad: "Cajamarquilla", hora_estimada: "05:52" }]);
    expect(normalizar(por("Huaycoloro1"), T).ultima_alerta).toMatchObject({ velocidad: null, altura: null });
  });

  test("estación sin alertas registradas pero con imagen reciente", () => {
    const e = {
      ...structuredClone(por("PIUR_CHQ_1")),
      ultima_imagen: { ruta_imagen: "x.png", actualizado_a: T / 1000 },
    };
    expect(normalizar(e, T).estado).toBe("sin_datos_de_alerta");
  });

  test("estado de la quebrada: basta una estación activa", () => {
    const es = [normalizar(por("Huaycoloro2"), T), normalizar(activa(), T)];
    expect(estadoQuebrada(es)).toBe("activo");
    expect(estadoQuebrada([normalizar(por("AREQ_HRL_1"), T)])).toBe("sin_transmision");
  });

  test("respuesta con otra forma → FORMATO_INESPERADO", () => {
    expect(() => leerEstaciones([{ id: 1 }])).toThrow(/inesperada/);
    expect(() => leerEstaciones([])).toThrow();
  });
});

// ---------- CLI contra un servidor local que imita al IGP ----------

let servidor: ReturnType<typeof Bun.serve>;
let base: string;
let modo: "normal" | "ruta-nueva" | "caido" | "activo" = "normal";
const RUTA_NUEVA = "OtraRutaOfuscadaDePrueba1234567";

beforeAll(() => {
  servidor = Bun.serve({
    port: 0,
    fetch(req) {
      const p = new URL(req.url).pathname;
      if (modo === "caido") return new Response("error", { status: 500 });
      const ruta = modo === "ruta-nueva" ? RUTA_NUEVA : RUTA_CONOCIDA;
      if (p === `/${ruta}/medias`) {
        const datos =
          modo === "activo" ? crudo.map((e) => (e.id_estacion === "Huaycoloro1" ? activa() : e)) : crudo;
        return Response.json(datos);
      }
      if (p === "/lahares-huaicos/") {
        return new Response(
          '<script type="module" crossorigin src="/lahares-huaicos/assets/index-abc.js"></script>',
        );
      }
      if (p === "/lahares-huaicos/assets/index-abc.js") {
        return new Response(`const c="https://grd.igp.gob.pe/${ruta}/medias";`);
      }
      return new Response("no", { status: 404 });
    },
  });
  base = `http://localhost:${servidor.port}`;
});
afterAll(() => servidor.stop(true));

async function correr(...args: string[]) {
  const proc = Bun.spawn([process.execPath, join(import.meta.dir, "../src/bin.ts"), ...args, "--json"], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, IGP_HUAICOS_BASE: base, XDG_CACHE_HOME: mkdtempSync(join(tmpdir(), "igp-")) },
  });
  const out = (await new Response(proc.stdout).text()).trim();
  return { code: await proc.exited, json: JSON.parse(out) };
}

describe("cli", () => {
  test("estaciones: resumen por quebrada", async () => {
    modo = "normal";
    const { code, json } = await correr("estaciones", "--momento", MOMENTO);
    expect(code).toBe(0);
    expect(json.resumen).toEqual({ activo: 0, no_activo: 2, sin_transmision: 8, sin_datos_de_alerta: 0 });
    expect(json.aviso.join(" ")).toContain("DESCONOCIDO");
  });

  test("filtro por región", async () => {
    modo = "normal";
    const { json } = await correr("estaciones", "--region", "lima", "--momento", MOMENTO);
    expect(json.quebradas.map((q: any) => q.quebrada)).toEqual(["Rio Seco", "Huaycoloro"]);
  });

  test("quebrada sin importar tildes ni mayúsculas, y sin comillas", async () => {
    modo = "normal";
    const { json } = await correr("quebrada", "Río", "seco", "--momento", MOMENTO);
    expect(json.quebrada.estaciones.map((e: any) => e.id)).toEqual(["Rioseco1", "Rioseco2"]);
  });

  test("quebrada activa con arribos", async () => {
    modo = "activo";
    const { json } = await correr("quebrada", "huaycoloro", "--momento", MOMENTO);
    expect(json.quebrada.estado).toBe("activo");
    expect(json.quebrada.estaciones[0].ultima_alerta.arribos[0].localidad).toBe("Cajamarquilla");
  });

  test("si el IGP cambia la ruta de su API, se redescubre desde el portal", async () => {
    modo = "ruta-nueva";
    const { code, json } = await correr("estaciones", "--momento", MOMENTO);
    expect(code).toBe(0);
    expect(json.quebradas.length).toBe(10);
    expect(json.quebradas[0].estaciones[0].ultima_imagen.url).toContain(RUTA_NUEVA);
  }, 30_000); // reintentos con espera

  test("IGP caído → FUENTE_NO_DISPONIBLE (nunca 'no activo')", async () => {
    modo = "caido";
    const { code, json } = await correr("estaciones");
    expect([code, json.code]).toEqual([1, "FUENTE_NO_DISPONIBLE"]);
    expect(json.hint).toContain("No se puede saber el estado");
  }, 30_000); // reintentos con espera

  test("quebrada no monitoreada → NO_ENCONTRADO", async () => {
    modo = "normal";
    expect((await correr("quebrada", "Santo Domingo")).json.code).toBe("NO_ENCONTRADO");
  });
});
