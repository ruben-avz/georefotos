// GeoRefotos: visor de fotos georreferenciadas sobre la ortofoto del ICGC.

const CATALONIA_CENTER = [41.82, 1.86];
const DEFAULT_ZOOM = 8;

const map = L.map('map', { zoomControl: true }).setView(CATALONIA_CENTER, DEFAULT_ZOOM);

const baseLayers = buildBaseLayers();
const firstBaseLayerName = Object.keys(baseLayers)[0];
baseLayers[firstBaseLayerName].addTo(map);

const photosLayer = L.layerGroup().addTo(map);
L.control.layers(baseLayers, { Fotos: photosLayer }, { collapsed: false }).addTo(map);

const folderInput = document.getElementById('folder-input');
const selectFolderBtn = document.getElementById('select-folder-btn');
const statusEl = document.getElementById('status');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxClose = document.getElementById('lightbox-close');

let currentLightboxUrl = null;

selectFolderBtn.addEventListener('click', () => folderInput.click());
folderInput.addEventListener('change', (event) => handleFolderSelection(event.target.files));

lightboxClose.addEventListener('click', closeLightbox);
lightbox.addEventListener('click', (event) => {
  if (event.target === lightbox) closeLightbox();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !lightbox.hidden) closeLightbox();
});

async function handleFolderSelection(fileList) {
  const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
  if (files.length === 0) {
    statusEl.textContent = 'No se han encontrado imágenes en la carpeta seleccionada.';
    return;
  }

  photosLayer.clearLayers();
  statusEl.textContent = `Procesando ${files.length} imágenes...`;

  let located = 0;
  let skipped = 0;

  const bounds = [];

  for (const file of files) {
    const photo = await readPhoto(file);
    if (!photo) {
      skipped += 1;
      continue;
    }
    located += 1;
    bounds.push([photo.lat, photo.lon]);
    addPhotoMarker(photo);
  }

  statusEl.textContent = `${located} fotos ubicadas · ${skipped} sin datos GPS`;

  if (bounds.length > 0) {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 });
  }
}

async function readPhoto(file) {
  try {
    const exif = await exifr.parse(file, { tiff: true, exif: true, gps: true, translateValues: true });
    if (!exif || typeof exif.latitude !== 'number' || typeof exif.longitude !== 'number') {
      return null;
    }
    return {
      file,
      lat: exif.latitude,
      lon: exif.longitude,
      azimuth: typeof exif.GPSImgDirection === 'number' ? exif.GPSImgDirection : null,
      date: exif.DateTimeOriginal instanceof Date ? exif.DateTimeOriginal : null,
      make: exif.Make || '',
      model: exif.Model || '',
      thumbnail: null
    };
  } catch (err) {
    return null;
  }
}

function addPhotoMarker(photo) {
  const marker = L.marker([photo.lat, photo.lon], { icon: buildMarkerIcon(photo.azimuth) });
  marker.bindPopup(() => buildPopupContent(photo), { maxWidth: 260 });
  marker.addTo(photosLayer);
}

function buildMarkerIcon(azimuth) {
  const arrowHtml =
    azimuth != null
      ? `<div class="photo-marker__arrow" style="transform: translate(-50%, -100%) rotate(${azimuth}deg);"></div>`
      : '';
  return L.divIcon({
    className: 'photo-marker',
    html: `${arrowHtml}<div class="photo-marker__dot"></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14]
  });
}

function buildPopupContent(photo) {
  const container = document.createElement('div');
  container.className = 'popup';

  const img = document.createElement('img');
  img.className = 'popup__thumb';
  img.alt = photo.file.name;
  container.appendChild(img);

  if (photo.thumbnail) {
    img.src = photo.thumbnail;
  } else {
    img.classList.add('popup__thumb--loading');
    makeThumbnail(photo.file).then((url) => {
      photo.thumbnail = url;
      img.src = url;
      img.classList.remove('popup__thumb--loading');
    });
  }

  const info = document.createElement('dl');
  info.className = 'popup__info';
  addInfoRow(info, 'Archivo', photo.file.name);
  addInfoRow(info, 'Coordenadas', `${photo.lat.toFixed(6)}, ${photo.lon.toFixed(6)}`);
  addInfoRow(info, 'Fecha', photo.date ? photo.date.toLocaleString('es-ES') : 'Desconocida');
  addInfoRow(info, 'Dispositivo', `${photo.make} ${photo.model}`.trim() || 'Desconocido');
  if (photo.azimuth != null) {
    addInfoRow(info, 'Azimut', `${Math.round(photo.azimuth)}°`);
  }
  container.appendChild(info);

  const expandBtn = document.createElement('button');
  expandBtn.className = 'btn btn--small';
  expandBtn.textContent = 'Ver imagen completa';
  expandBtn.addEventListener('click', () => openLightbox(photo.file));
  container.appendChild(expandBtn);

  return container;
}

function addInfoRow(dl, label, value) {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;
  dl.appendChild(dt);
  dl.appendChild(dd);
}

async function makeThumbnail(file) {
  try {
    const bitmap = await createImageBitmap(file, { resizeWidth: 280, resizeQuality: 'medium' });
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch (err) {
    return URL.createObjectURL(file);
  }
}

function openLightbox(file) {
  if (currentLightboxUrl) URL.revokeObjectURL(currentLightboxUrl);
  currentLightboxUrl = URL.createObjectURL(file);
  lightboxImg.src = currentLightboxUrl;
  lightbox.hidden = false;
}

function closeLightbox() {
  lightbox.hidden = true;
  lightboxImg.src = '';
  if (currentLightboxUrl) {
    URL.revokeObjectURL(currentLightboxUrl);
    currentLightboxUrl = null;
  }
}
