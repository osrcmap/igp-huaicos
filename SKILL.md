---
name: igp-huaicos
description: Estado en vivo de las quebradas con sensores del IGP en el Perú (huaicos en Huaycoloro, Río Seco, Limón, Cojup; lahares en Arequipa). Úsalo cuando alguien pregunte si está bajando un huaico o lahar en una de esas quebradas, o por el monitoreo del IGP.
---

# igp-huaicos

```bash
igp-huaicos estaciones --json            # todas (antepone npx @osrcmap/ si no está instalado)
igp-huaicos quebrada huaycoloro --json   # una quebrada
```

## Cómo responder

- `activo`: el IGP detectó el descenso de un huaico o lahar. Dilo primero, con los `arribos` estimados si existen, y recomienda alejarse del cauce y seguir a la autoridad local.
- `no_activo`: la estación transmite y no hay actividad en ese momento.
- `sin_transmision`: **estado desconocido**. Nunca lo presentes como "sin peligro". Menciona `ultimo_estado_conocido` y cuándo fue la última imagen.
- Cita la hora de consulta (`fuente.obtenido_en`) y el portal del IGP.
- Si la quebrada no está en la lista, el IGP no la monitorea: eso no significa que sea segura.

## Errores

`FUENTE_NO_DISPONIBLE` / `FORMATO_INESPERADO`: no se sabe el estado. Dilo así y remite a https://grd.igp.gob.pe/lahares-huaicos/.
