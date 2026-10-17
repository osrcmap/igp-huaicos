# Investigación de la fuente

Portal: https://grd.igp.gob.pe/lahares-huaicos/ (aplicación Vue; verificado el 17 de octubre de 2026).

## API

- `GET https://grd.igp.gob.pe/Lq5aA7wpZ77tSYiPg7YmjHi3VnkSJ9pE/medias` devuelve un arreglo JSON con todas las estaciones. El segmento largo está fijo en el bundle del portal (`/lahares-huaicos/assets/index-*.js`); igp-huaicos lo redescubre si responde 404.
- Imágenes de cámara: `…/media/<ultima_imagen.ruta_imagen>`.
- Tiempo real: socket.io en `wss://grd.igp.gob.pe` con `path: "/Lq5aA7wpZ77tSYiPg7YmjHi3VnkSJ9pE/socket.io"` y solo transporte websocket. Eventos: `lima/huaycos/image`, `piur/huaycos/image`, `areq/lahares/image` y sus equivalentes `…/alert`. Cada evento trae un objeto de estación (mismo formato que `/medias`) que se fusiona con el anterior. igp-huaicos aún no lo usa (sondeo con caché de 60 s); sería la base para avisos instantáneos en un bot.

## Formato de una estación

```json
{
  "id_estacion": "Huaycoloro1",
  "grupo": "lima/huaycos",
  "nombre_quebrada": "Huaycoloro",
  "nombre_estacion": "Huaycoloro 1",
  "localidades_cercanas": [{ "nombre": "Cajamarquilla", "distancia": 9, "codigo": "P02" }],
  "ultima_imagen": { "ruta_imagen": "Huaycoloro1/….png", "actualizado_a": 1792240000.0 },
  "ultima_alerta": { "actividad_lahar": false, "arrivos": [], "velocidad_lahar": 1.0, "altura_lahar": 1.0, "actualizado_a": 1790171236.5 }
}
```

- `actualizado_a` en segundos Unix (con decimales).
- `actividad_lahar` se usa también para huaicos. Sin actividad, `velocidad_lahar` y `altura_lahar` valen 1.0 (marcador, no medida). No hay unidades documentadas.
- `arrivos`: la página lo trata a veces como lista de `{ localidad|nombre, hora_estimada }` y a veces como objeto; igp-huaicos acepta ambos.
- Cojup (Huaraz) y Limón (Piura) no traen `ultima_alerta`.
- **No hay coordenadas** de las estaciones: no se pueden cruzar por distancia con un punto.

## Estado observado (17/10/2026, 05:29)

| Quebrada | Estaciones | Última imagen | Última alerta |
|---|---|---|---|
| Huaycoloro (Lima) | 2 | minutos | 23/09/2026, no activa |
| Río Seco (Lima) | 2 | minutos | 23/09/2026, no activa |
| Arequipa (6 quebradas) | 9 | enero–junio 2026 | marzo–mayo 2026 |
| Cojup (Áncash) | 1 | julio 2026 | sin alertas |
| Limón (Piura) | 1 | abril 2026 | sin alertas |

Solo las estaciones de Lima transmiten. Por eso la "señal de vida" es la imagen de cámara (llega cada 1-2 minutos): la última alerta solo cambia cuando hay un evento.

**Río Seco del IGP** es la quebrada de Lurigancho junto al Radio Observatorio de Jicamarca (sus localidades son las mismas que las de Huaycoloro: Jicamarca a 1-2 km, Cajamarquilla, La Atarjea). Coincide con la zona del INGEMMET "Quebrada Silencio, Quebrada Colca, Quebrada Río Seco" (-11.9521, -76.8748), en el sistema de Huaycoloro.

## Pendiente

- Coordenadas oficiales de cada estación (pedirlas al IGP) para integrarlo en riesgo-punto por distancia.
- Usar el socket.io para avisos instantáneos.
- Confirmar con el IGP unidades de velocidad y altura, el formato de `arrivos` y el calendario de operación de cada estación.
