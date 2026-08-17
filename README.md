# GeoRefotos

Visor web para explorar fotos georreferenciadas sobre la ortofoto del ICGC (Institut Cartogràfic i Geològic de Catalunya).

Selecciona una carpeta de tu ordenador, lee los metadatos EXIF de cada foto en el propio navegador (nada se sube a ningún servidor) y muestra un punto en el mapa por cada foto con coordenadas GPS. Si la foto tiene azimut (dirección de captura), se dibuja también una flecha con esa orientación.

## Funcionalidades actuales

- Capa base: Servei de Mapa Base del ICGC, capa "orto" (WMTS). Dentro de Catalunya muestra la Ortofoto Territorial en alta resolución del ICGC; fuera de Catalunya (resto del mundo) completa el mosaico con imágenes de fondo de OpenMapTiles/OpenStreetMap para dar contexto al hacer zoom out.
- Selección de una carpeta local (y subcarpetas) de fotos.
- Lectura de EXIF en el navegador con [exifr](https://github.com/MikeKovarik/exifr): coordenadas GPS, azimut (`GPSImgDirection`), fecha de captura y dispositivo (marca/modelo).
- Marcador por foto; flecha de orientación cuando hay azimut disponible.
- Al hacer clic en un marcador se abre una miniatura con: nombre de archivo, coordenadas, fecha y dispositivo.
- Botón "Ver imagen completa" que abre la foto original a tamaño completo.
- Arquitectura de capas preparada para añadir o combinar más capas base/superpuestas más adelante (ver `js/layers.js`).

## Cómo usarlo

No requiere instalación ni build. Solo abre [index.html](index.html) con doble clic (Chrome, Edge o Firefox recomendados) y pulsa "Seleccionar carpeta...".

Si el navegador restringe la carga de imágenes locales al abrir el archivo directamente (`file://`), sirve la carpeta con un servidor local, por ejemplo con Python (ya viene instalado con el sistema en muchos casos):

```bash
python -m http.server 8000
```

Y abre `http://localhost:8000` en el navegador.

> Nota: los tiles del mapa base se cargan desde internet, así que se necesita conexión aunque las fotos se procesen localmente. Al alejar el zoom fuera de Catalunya es normal ver el resto del mundo con menor resolución (OpenMapTiles/OSM) y un cambio visible de textura justo en la frontera de Catalunya: es el propio comportamiento del Servei de Mapa Base del ICGC, no un error.

## Estructura del proyecto

```
georefotos/
├── index.html        # Punto de entrada
├── css/style.css      # Estilos (toolbar, marcadores, popup, visor)
├── js/layers.js        # Configuración de capas del mapa (base layers)
└── js/app.js           # Lógica: selección de carpeta, EXIF, marcadores, popup, visor
```

## Añadir nuevas capas

Las capas base se definen en [js/layers.js](js/layers.js) como una lista de objetos `{ id, label, url, options }`. Para añadir una nueva capa (por ejemplo el mapa topográfico del ICGC, OpenStreetMap o el Cadastre), basta con añadir una entrada nueva siguiendo el mismo esquema; el selector de capas de Leaflet la incorporará automáticamente. El array `OVERLAY_LAYERS` está reservado para capas superpuestas combinables (p. ej. Catastro) que se añadirán en el futuro.

## Hoja de ruta

- Capa del Mapa Topogràfic de l'ICGC.
- Capa OpenStreetMap.
- Capa del Cadastre (superpuesta, combinable con la ortofoto).
- Corrección manual de la ubicación de una foto arrastrando el marcador.
- Corrección manual del azimut (rotando la flecha).
- Escritura de las correcciones de vuelta al EXIF del archivo original. El navegador no puede reescribir EXIF de forma fiable, así que esta parte probablemente se resuelva con un pequeño script en Python (p. ej. con `piexif` o `Pillow`) que el usuario ejecute localmente sobre la carpeta de fotos.

## Compatibilidad

Requiere un navegador con soporte para selección de carpetas (`webkitdirectory`): Chrome, Edge y Firefox recientes. Safari tiene soporte limitado.
