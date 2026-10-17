# Limitaciones

- **Pocas quebradas.** El IGP monitorea 10 quebradas en todo el país; el resto de las ~2,200 zonas críticas no tiene sensores. Que una quebrada no aparezca no dice nada sobre su peligro.
- **Estaciones que no transmiten.** A octubre de 2026 solo transmiten las de Lima (Huaycoloro y Río Seco). Las demás se reportan `sin_transmision` (estado desconocido), con su último estado conocido.
- **Señal de vida = imagen de cámara.** Una estación cuya cámara funciona pero cuyo sensor falla aparecería como "transmitiendo". No hay forma de distinguirlo con los datos públicos.
- **Umbral de 30 minutos.** Una caída de transmisión de menos de 30 minutos no se detecta.
- **API no documentada.** Es el endpoint que usa el portal del IGP; puede cambiar sin aviso. Si cambia la ruta se redescubre; si cambia el formato, el resultado es `FORMATO_INESPERADO`.
- **Sin coordenadas** de estaciones: aún no se integra en riesgo-punto por distancia.
- **Caché de 60 s** y sondeo: para avisos al segundo hace falta el socket.io del IGP (ver RESEARCH.md).
- Velocidad, altura y arribos se reproducen como los envía el IGP; sus unidades no están documentadas.
- No es una alerta oficial ni una orden de evacuación: el sistema de alerta del IGP tiene sus propios canales (sirenas y autoridades locales).
