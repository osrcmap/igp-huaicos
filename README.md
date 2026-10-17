# igp-huaicos

Estado **en vivo** de las quebradas que monitorea el Instituto Geofísico del Perú (IGP) con sensores y cámaras: huaicos en Lima (Huaycoloro, Río Seco), Piura (Limón) y Áncash (Cojup), y lahares en Arequipa (Huarangal, Huarangueros, Venezuela, San Lázaro, Pastores, El Pato). CLI *agent-first*, parte del conjunto para El Niño 2026-2027 junto a [`peligros-pe`](https://github.com/osrcmap/peligros-pe), [`avisos-pe`](https://github.com/osrcmap/avisos-pe) y [`riesgo-punto`](https://github.com/osrcmap/riesgo-punto).

> **Lo más importante:** una estación que no transmite tiene estado **desconocido**, no "sin peligro". igp-huaicos nunca la reporta como "no activo".

## Uso

```bash
npm i -g @osrcmap/igp-huaicos

igp-huaicos estaciones                 # todas las quebradas
igp-huaicos estaciones --region lima
igp-huaicos quebrada huaycoloro        # detalle: estaciones, última imagen, última alerta, localidades
```

```text
Quebradas monitoreadas por el IGP:
Huarangal (Arequipa, lahar): SIN TRANSMISIÓN (estado desconocido) — 0/2 estaciones transmitiendo, última imagen hace 130 días
...
Rio Seco (Lima, huaico): no activo — 2/2 estaciones transmitiendo, última imagen hace 0 min
Huaycoloro (Lima, huaico): no activo — 2/2 estaciones transmitiendo, última imagen hace 0 min
```

### Estados

| Estado | Significado |
|---|---|
| `activo` | El IGP detectó el descenso de un huaico o lahar. Se incluyen velocidad, altura y arribos estimados a localidades si el IGP los envía |
| `no_activo` | La estación transmite y no hay actividad |
| `sin_transmision` | Sin imagen hace más de 30 minutos: **estado desconocido**. Se informa `ultimo_estado_conocido` |
| `sin_datos_de_alerta` | Transmite imagen pero el IGP no publica alertas para esa estación |

Una quebrada está `activo` si cualquiera de sus estaciones lo está.

### Para agentes

- JSON por defecto cuando stdout no es una terminal (`--json` lo fuerza); `schema <comando>` da el JSON Schema.
- `--momento <ISO>` fija el instante de referencia (útil para reproducir); `--sin-cache` ignora la caché de 60 s.
- Errores: `{ "ok": false, "code", "error", "hint" }`. `FUENTE_NO_DISPONIBLE` y `FORMATO_INESPERADO` significan "no se sabe el estado", nunca "sin actividad".
- Ver [`SKILL.md`](SKILL.md).

## Cómo funciona

Lee el mismo endpoint JSON que usa el portal [grd.igp.gob.pe/lahares-huaicos](https://grd.igp.gob.pe/lahares-huaicos/). Su ruta incluye un segmento ofuscado; si el IGP la cambia, igp-huaicos la redescubre leyendo el código del portal. Detalles en [`RESEARCH.md`](RESEARCH.md); límites en [`LIMITATIONS.md`](LIMITATIONS.md).

## Desarrollo

```bash
bun install
bun test                   # fixture real del IGP + servidor local; casos de actividad sintéticos
bun run typecheck && bun run lint
bun run build && node scripts/humo.mjs
```

## Licencia

Código: MIT. Los datos de monitoreo son del IGP; atribúyelos al IGP y enlaza su portal.
