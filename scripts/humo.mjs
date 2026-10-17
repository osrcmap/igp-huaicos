// Prueba de humo del paquete compilado (dist/cli.js) con el Node que la ejecute (>= 20). Sin red:
// un servidor local imita al IGP con test/fixtures/medias.json. Corre sobre una copia aislada
// (sin node_modules) para detectar si el bundle deja de ser autónomo.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raiz = new URL("..", import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8"));
const medias = readFileSync(join(raiz, "test/fixtures/medias.json"));
const aislado = mkdtempSync(join(tmpdir(), "igp-huaicos-humo-"));
for (const f of ["dist", "package.json"]) cpSync(join(raiz, f), join(aislado, f), { recursive: true });

const servidor = createServer((req, res) => {
  if (req.url?.endsWith("/medias")) return res.end(medias);
  res.statusCode = 404;
  res.end();
});
await new Promise((ok) => servidor.listen(0, ok));
const env = {
  ...process.env,
  IGP_HUAICOS_BASE: `http://localhost:${servidor.address().port}`,
  XDG_CACHE_HOME: mkdtempSync(join(tmpdir(), "igp-huaicos-cache-")),
};

// Hijo asíncrono: spawnSync bloquearía al servidor de este mismo proceso.
const correr = (...args) =>
  new Promise((ok) => {
    const h = spawn(process.execPath, [join(aislado, "dist/cli.js"), ...args, "--json"], { env });
    let out = "";
    h.stdout.on("data", (d) => (out += d));
    h.on("close", (code) => {
      assert.ok(out.trim(), `sin salida para: ${args.join(" ")}`);
      ok({ code, json: JSON.parse(out) });
    });
  });

try {
  assert.equal((await correr("--version")).json.version, pkg.version);
  const r = await correr("estaciones", "--momento", "2026-10-17T05:30:00-05:00");
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.resumen, { activo: 0, no_activo: 2, sin_transmision: 8, sin_datos_de_alerta: 0 });
  assert.equal((await correr("quebrada", "nada")).json.code, "NO_ENCONTRADO");
  console.log(`humo ok: node ${process.version}, ${pkg.name}@${pkg.version}`);
} finally {
  servidor.close();
}
