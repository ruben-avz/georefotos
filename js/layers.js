// Configuración de capas base del mapa.
// Para añadir una nueva capa (mapa topogràfic ICGC, OSM, Cadastre...) basta con
// añadir un nuevo objeto a BASE_LAYERS siguiendo el mismo esquema, y buildBaseLayers()
// lo incorporará automáticamente al selector de capas de Leaflet.
//
// Ejemplo de capa futura (OpenStreetMap):
// {
//   id: 'osm',
//   label: 'OpenStreetMap',
//   url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
//   options: { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }
// }

const BASE_LAYERS = [
  {
    id: 'icgc-orto',
    label: 'Ortofoto ICGC',
    url: 'https://geoserveis.icgc.cat/servei/catalunya/mapa-base/wmts/orto/MON3857NW/{z}/{x}/{y}.png',
    options: {
      maxZoom: 20,
      minZoom: 5,
      attribution:
        '&copy; <a href="https://www.icgc.cat/" target="_blank" rel="noopener">Institut Cartogràfic i Geològic de Catalunya</a>'
    }
  }
];

// Capas superpuestas (overlays) que se pueden combinar con la capa base.
// De momento solo contiene el grupo de marcadores de fotos, que se añade en app.js.
const OVERLAY_LAYERS = [];

function buildBaseLayers() {
  const layers = {};
  BASE_LAYERS.forEach((cfg) => {
    layers[cfg.label] = L.tileLayer(cfg.url, cfg.options);
  });
  return layers;
}
