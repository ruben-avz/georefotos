# GeoRefotos

Visor web para explorar fotos georreferenciadas sobre la ortofoto del ICGC (Institut Cartogràfic i Geològic de Catalunya).

Selecciona una carpeta de tu ordenador, lee los metadatos EXIF de cada foto en el propio navegador (nada se sube a ningún servidor) y muestra un punto en el mapa por cada foto con coordenadas GPS. Si la foto tiene azimut (dirección de captura), se dibuja también una flecha con esa orientación.

## Funcionalidades actuales

- Capa base: Servei de Mapa Base del ICGC, capa "orto" (WMTS). Dentro de Catalunya muestra la Ortofoto Territorial en alta resolución del ICGC; fuera de Catalunya (resto del mundo) completa el mosaico con imágenes de fondo de OpenMapTiles/OpenStreetMap para dar contexto al hacer zoom out.
- Selección de una carpeta local (y subcarpetas) de fotos, incluyendo HEIC/HEIF (fotos de iPhone/Samsung).
- Lectura de EXIF en el navegador con [exifr](https://github.com/MikeKovarik/exifr): coordenadas GPS, azimut (`GPSImgDirection`), fecha de captura y dispositivo (marca/modelo).
- Marcador por foto; flecha de orientación cuando hay azimut disponible.
- Al hacer clic en un marcador se abre una miniatura con: nombre de archivo, coordenadas, fecha y dispositivo. Las fotos HEIC/HEIF se convierten a JPEG al vuelo en el navegador (con [heic2any](https://github.com/alexcorvi/heic2any)) para poder mostrarlas, ya que ningún navegador basado en Chromium las decodifica de forma nativa.
- Botón "Ver imagen completa" que abre la foto original a tamaño completo.
- **Corrección de ubicación, sin tocar los originales**: botón "Corregir ubicación" en el popup que permite arrastrar el marcador a la posición correcta. Los cambios quedan marcados como pendientes (marcador naranja) y en caché local hasta guardarlos.
- Botón global "Guardar cambios" (solo visible si hay correcciones pendientes) que escribe la nueva ubicación en una **copia** dentro de una carpeta `editadas/` creada junto a las fotos originales — el archivo original nunca se modifica ni se borra:
  - **JPEG**: la copia lleva el mismo EXIF que el original con el bloque GPS reescrito (fecha, dispositivo, etc. se conservan).
  - **HEIC/HEIF**: como los navegadores no saben escribir EXIF en HEIC, la copia se genera como `.jpg` con un EXIF nuevo (fecha, dispositivo, GPS corregido, azimut).
  - Otros formatos (PNG, WebP...) no se pueden guardar todavía; se avisa en el estado si falla.
  - Si una foto ya tiene su copia corregida en `editadas/`, al reabrir la carpeta se detecta automáticamente y el marcador se muestra en la ubicación guardada (verde = corregida y guardada; naranja = corrección pendiente). Volver a corregirla **sobreescribe la misma copia**, no crea una nueva.
- Aviso del navegador al intentar cerrar la pestaña si hay correcciones sin guardar.
- Control deslizante en la barra superior para ajustar el tamaño de los puntos (x1 / x2 / x4), útil cuando hay muchas fotos juntas o pantallas de alta resolución.
- Arquitectura de capas preparada para añadir o combinar más capas base/superpuestas más adelante (ver `js/layers.js`).

## Cómo usarlo

No requiere instalación ni build. Solo abre [index.html](index.html) con doble clic y pulsa "Seleccionar carpeta...".

- En **Chrome o Edge**, la carpeta se abre con la File System Access API: permite guardar las correcciones de ubicación directamente en los archivos.
- En otros navegadores (**Brave, Firefox, Safari**) se usa el selector de carpeta clásico: la visualización funciona igual, pero **no se puede guardar** ninguna corrección (el botón "Corregir ubicación" no aparece). Brave bloquea la File System Access API a propósito (sin opción para reactivarla desde Shields ni `brave://flags`, a fecha de hoy), así que aunque es un navegador basado en Chromium se comporta como Firefox en este punto.

Si el navegador restringe la carga de imágenes locales al abrir el archivo directamente (`file://`), sirve la carpeta con un servidor local, por ejemplo con Python (ya viene instalado con el sistema en muchos casos):

```bash
python -m http.server 8000
```

Y abre `http://localhost:8000` en el navegador.

> Nota: los tiles del mapa base se cargan desde internet, así que se necesita conexión aunque las fotos se procesen localmente. Al alejar el zoom fuera de Catalunya es normal ver el resto del mundo con menor resolución (OpenMapTiles/OSM) y un cambio visible de textura justo en la frontera de Catalunya: es el propio comportamiento del Servei de Mapa Base del ICGC, no un error.

## Estructura del proyecto

```
georefotos/
├── index.html          # Punto de entrada
├── css/style.css        # Estilos (toolbar, marcadores, popup, visor)
└── js/
    ├── layers.js         # Configuración de capas del mapa (base layers)
    ├── exif-writer.js     # Genera la copia corregida en /editadas (GPS en EXIF, HEIC→JPEG)
    └── app.js              # Selección de carpeta, EXIF, marcadores, popup, edición, guardado
```

## Añadir nuevas capas

Las capas base se definen en [js/layers.js](js/layers.js) como una lista de objetos `{ id, label, url, options }`. Para añadir una nueva capa (por ejemplo el mapa topográfico del ICGC, OpenStreetMap o el Cadastre), basta con añadir una entrada nueva siguiendo el mismo esquema; el selector de capas de Leaflet la incorporará automáticamente. El array `OVERLAY_LAYERS` está reservado para capas superpuestas combinables (p. ej. Catastro) que se añadirán en el futuro.

## Hoja de ruta

- Capa del Mapa Topogràfic de l'ICGC.
- Capa OpenStreetMap.
- Capa del Cadastre (superpuesta, combinable con la ortofoto).
- Corrección manual del azimut (rotando la flecha) con el mismo mecanismo de guardado.
- Guardado de correcciones para formatos no-JPEG que no sean HEIC (PNG, WebP...).

## Compatibilidad

- **Visualización**: cualquier navegador reciente con soporte para selección de carpetas (Chrome, Edge, Brave, Firefox). Safari tiene soporte limitado.
- **Corrección y guardado de ubicación**: requiere un navegador con [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API). Funciona en **Chrome y Edge**. **No funciona en Brave** (lo bloquea deliberadamente, ver [issue #44411](https://github.com/brave/brave-browser/issues/44411)), ni en Firefox ni Safari (todavía no la implementan).
