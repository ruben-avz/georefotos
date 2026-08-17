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
const saveChangesBtn = document.getElementById('save-changes-btn');
const markerScaleInput = document.getElementById('marker-scale');
const markerScaleLabel = document.getElementById('marker-scale-label');
const statusEl = document.getElementById('status');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxClose = document.getElementById('lightbox-close');

let currentLightboxUrl = null;
let photos = [];
let hasWriteAccess = false; // true solo si la carpeta se abrió con File System Access API
let currentRootName = '';
let rootDirHandle = null;
let editadasDirHandle = null; // carpeta "editadas" dentro de la carpeta seleccionada

const MARKER_SCALES = [1, 2, 4];
const BASE_ICON_SIZE = 28;
const BASE_DOT_SIZE = 12;
const BASE_ARROW_SIDE = 6;
const BASE_ARROW_LENGTH = 14;
let markerScale = MARKER_SCALES[Number(markerScaleInput.value)];

markerScaleInput.addEventListener('input', () => {
  markerScale = MARKER_SCALES[Number(markerScaleInput.value)];
  markerScaleLabel.textContent = `x${markerScale}`;
  photos.forEach((photo) => photo.marker.setIcon(buildMarkerIcon(photo)));
});

// El File.type del navegador no es fiable para HEIC/HEIF en Windows (suele venir vacío),
// así que además de mirar el MIME se filtra por extensión.
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif', 'bmp', 'tif', 'tiff'];

function getExtensionFromName(name) {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

function getExtension(file) {
  return getExtensionFromName(file.name);
}

function isImageFile(file) {
  return file.type.startsWith('image/') || IMAGE_EXTENSIONS.includes(getExtension(file));
}

function isHeicFile(file) {
  const ext = getExtension(file);
  return ext === 'heic' || ext === 'heif' || file.type === 'image/heic' || file.type === 'image/heif';
}

// Las copias corregidas viven en una carpeta "editadas" junto a los originales; se
// excluye de la lista de fotos para no contarla como una carpeta más de originales.
function isInsideEditedFolder(relativePath) {
  return relativePath.split('/').slice(0, -1).includes(EDITED_FOLDER_NAME);
}

selectFolderBtn.addEventListener('click', selectFolder);
folderInput.addEventListener('change', (event) => {
  hasWriteAccess = false;
  currentRootName = '';
  rootDirHandle = null;
  editadasDirHandle = null;
  const items = Array.from(event.target.files)
    .filter(isImageFile)
    .filter((file) => !isInsideEditedFolder(file.webkitRelativePath || file.name))
    .map((file) => ({ file, handle: null, dirHandle: null, relativePath: file.webkitRelativePath || file.name }));
  handleFileList(items);
  folderInput.value = '';
});

saveChangesBtn.addEventListener('click', saveAllChanges);

lightboxClose.addEventListener('click', closeLightbox);
lightbox.addEventListener('click', (event) => {
  if (event.target === lightbox) closeLightbox();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !lightbox.hidden) closeLightbox();
});

window.addEventListener('beforeunload', (event) => {
  if (hasPendingChanges()) {
    event.preventDefault();
    event.returnValue = '';
  }
});

async function selectFolder() {
  if (window.showDirectoryPicker) {
    let dirHandle;
    try {
      dirHandle = await window.showDirectoryPicker();
    } catch (err) {
      return; // el usuario ha cancelado el selector
    }
    if (hasPendingChanges() && !confirm('Hay correcciones de ubicación sin guardar que se perderán. ¿Continuar?')) {
      return;
    }
    hasWriteAccess = true;
    currentRootName = dirHandle.name;
    rootDirHandle = dirHandle;
    try {
      editadasDirHandle = await dirHandle.getDirectoryHandle(EDITED_FOLDER_NAME, { create: false });
    } catch (err) {
      editadasDirHandle = null; // todavía no existe: se creará en el primer guardado
    }
    statusEl.textContent = 'Buscando fotos...';
    try {
      const entries = await collectImageEntries(dirHandle);
      const items = [];
      for (const entry of entries) {
        items.push({ file: await entry.handle.getFile(), handle: entry.handle, dirHandle: entry.dirHandle, relativePath: entry.relativePath });
      }
      await handleFileList(items);
    } catch (err) {
      console.error(err);
      statusEl.textContent = 'No se ha podido leer la carpeta seleccionada.';
    }
  } else {
    if (hasPendingChanges() && !confirm('Hay correcciones de ubicación sin guardar que se perderán. ¿Continuar?')) {
      return;
    }
    folderInput.click();
  }
}

async function collectImageEntries(dirHandle, relativePath = '') {
  const results = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === 'directory' && name === EDITED_FOLDER_NAME) continue;
    const entryPath = relativePath ? `${relativePath}/${name}` : name;
    if (handle.kind === 'file') {
      if (IMAGE_EXTENSIONS.includes(getExtensionFromName(name))) {
        results.push({ handle, dirHandle, relativePath: entryPath });
      }
    } else if (handle.kind === 'directory') {
      results.push(...(await collectImageEntries(handle, entryPath)));
    }
  }
  return results;
}

async function handleFileList(items) {
  if (items.length === 0) {
    statusEl.textContent = 'No se han encontrado imágenes en la carpeta seleccionada.';
    return;
  }

  photosLayer.clearLayers();
  photos = [];
  updateSaveButton();
  statusEl.textContent = `Procesando ${items.length} imágenes...`;

  let located = 0;
  let skipped = 0;
  const bounds = [];

  for (const item of items) {
    const photo = await readPhoto(item);
    if (!photo) {
      skipped += 1;
      continue;
    }
    located += 1;
    photos.push(photo);
    addPhotoMarker(photo);
    restorePendingFromCache(photo);
    bounds.push([photo.dirty ? photo.editedLat : photo.lat, photo.dirty ? photo.editedLon : photo.lon]);
  }

  const writeNote = hasWriteAccess
    ? ''
    : window.showDirectoryPicker
      ? ' · corrección de ubicación no disponible en este navegador'
      : ' · corrección de ubicación no disponible (usa Chrome o Edge; Brave y Firefox la bloquean)';
  statusEl.textContent = `${located} fotos ubicadas · ${skipped} sin datos GPS${writeNote}`;

  if (bounds.length > 0) {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 });
  }
  updateSaveButton();
}

async function readPhoto(item) {
  try {
    const exif = await exifr.parse(item.file, { tiff: true, exif: true, gps: true, translateValues: true });
    if (!exif || typeof exif.latitude !== 'number' || typeof exif.longitude !== 'number') {
      return null;
    }
    const photo = {
      file: item.file,
      handle: item.handle,
      dirHandle: item.dirHandle,
      relativePath: item.relativePath,
      originalLat: exif.latitude,
      originalLon: exif.longitude,
      lat: exif.latitude,
      lon: exif.longitude,
      editedLat: null,
      editedLon: null,
      dirty: false,
      editing: false,
      hasSavedEdit: false,
      azimuth: typeof exif.GPSImgDirection === 'number' ? exif.GPSImgDirection : null,
      date: exif.DateTimeOriginal instanceof Date ? exif.DateTimeOriginal : null,
      make: exif.Make || '',
      model: exif.Model || '',
      thumbnail: null,
      displayBlob: null,
      marker: null
    };
    await applySavedEditIfExists(photo);
    return photo;
  } catch (err) {
    return null;
  }
}

// Si ya existe una copia corregida en /editadas para esta foto, se usa su ubicación
// como la ubicación "vigente" (la original nunca se toca, se conserva en photo.originalLat/Lon).
async function applySavedEditIfExists(photo) {
  if (!editadasDirHandle) return;
  try {
    const name = editedFileName(photo.relativePath);
    const fileHandle = await editadasDirHandle.getFileHandle(name);
    const editedFile = await fileHandle.getFile();
    const editedExif = await exifr.parse(editedFile, { gps: true });
    if (editedExif && typeof editedExif.latitude === 'number') {
      photo.lat = editedExif.latitude;
      photo.lon = editedExif.longitude;
      photo.hasSavedEdit = true;
    }
  } catch (err) {
    // No existe copia editada todavía para esta foto: es el caso normal.
  }
}

function addPhotoMarker(photo) {
  const marker = L.marker([photo.lat, photo.lon], { icon: buildMarkerIcon(photo) });
  marker.bindPopup(() => buildPopupContent(photo), { maxWidth: 260 });
  marker.on('dragend', () => onMarkerDragEnd(photo));
  marker.addTo(photosLayer);
  photo.marker = marker;
}

function buildMarkerIcon(photo) {
  const iconSize = BASE_ICON_SIZE * markerScale;
  const dotSize = BASE_DOT_SIZE * markerScale;
  const arrowSide = BASE_ARROW_SIDE * markerScale;
  const arrowLength = BASE_ARROW_LENGTH * markerScale;

  const arrowHtml =
    photo.azimuth != null
      ? `<div class="photo-marker__arrow" style="border-left-width: ${arrowSide}px; border-right-width: ${arrowSide}px; border-bottom-width: ${arrowLength}px; transform: translate(-50%, -100%) rotate(${photo.azimuth}deg);"></div>`
      : '';
  let dotClass = 'photo-marker__dot';
  if (photo.editing) dotClass += ' photo-marker__dot--editing';
  else if (photo.dirty) dotClass += ' photo-marker__dot--dirty';
  else if (photo.hasSavedEdit) dotClass += ' photo-marker__dot--saved-edit';
  return L.divIcon({
    className: 'photo-marker',
    html: `${arrowHtml}<div class="${dotClass}" style="width: ${dotSize}px; height: ${dotSize}px;"></div>`,
    iconSize: [iconSize, iconSize],
    iconAnchor: [iconSize / 2, iconSize / 2],
    popupAnchor: [0, -iconSize / 2]
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
    makeThumbnail(photo).then((url) => {
      if (!url) {
        img.replaceWith(buildThumbnailErrorPlaceholder());
        return;
      }
      photo.thumbnail = url;
      img.src = url;
      img.classList.remove('popup__thumb--loading');
    });
  }

  const info = document.createElement('dl');
  info.className = 'popup__info';
  addInfoRow(info, 'Archivo', photo.file.name);
  const shownLat = photo.dirty ? photo.editedLat : photo.lat;
  const shownLon = photo.dirty ? photo.editedLon : photo.lon;
  const suffix = photo.dirty ? ' (sin guardar)' : photo.hasSavedEdit ? ' (corregida)' : '';
  addInfoRow(info, 'Coordenadas', `${shownLat.toFixed(6)}, ${shownLon.toFixed(6)}${suffix}`);
  if (photo.dirty || photo.hasSavedEdit) {
    addInfoRow(info, 'Original', `${photo.originalLat.toFixed(6)}, ${photo.originalLon.toFixed(6)}`);
  }
  addInfoRow(info, 'Fecha', photo.date ? photo.date.toLocaleString('es-ES') : 'Desconocida');
  addInfoRow(info, 'Dispositivo', `${photo.make} ${photo.model}`.trim() || 'Desconocido');
  if (photo.azimuth != null) {
    addInfoRow(info, 'Azimut', `${Math.round(photo.azimuth)}°`);
  }
  container.appendChild(info);

  const actions = document.createElement('div');
  actions.className = 'popup__actions';

  const expandBtn = document.createElement('button');
  expandBtn.className = 'btn btn--small';
  expandBtn.type = 'button';
  expandBtn.textContent = 'Ver imagen completa';
  expandBtn.addEventListener('click', () => openLightbox(photo));
  actions.appendChild(expandBtn);

  if (hasWriteAccess) {
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn--small btn--secondary';
    editBtn.type = 'button';
    editBtn.textContent = photo.editing ? 'Cancelar corrección' : 'Corregir ubicación';
    editBtn.addEventListener('click', () => toggleEditLocation(photo));
    actions.appendChild(editBtn);

    if (photo.dirty) {
      const undoBtn = document.createElement('button');
      undoBtn.className = 'btn btn--small btn--secondary';
      undoBtn.type = 'button';
      undoBtn.textContent = 'Deshacer corrección';
      undoBtn.addEventListener('click', () => {
        undoEdit(photo);
        photo.marker.closePopup();
      });
      actions.appendChild(undoBtn);
    }
  }

  container.appendChild(actions);

  if (photo.editing) {
    const hint = document.createElement('p');
    hint.className = 'popup__hint';
    hint.textContent = 'Arrastra el marcador en el mapa hasta la posición correcta.';
    container.appendChild(hint);
  }

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

function buildThumbnailErrorPlaceholder() {
  const div = document.createElement('div');
  div.className = 'popup__thumb popup__thumb--error';
  div.textContent = 'Vista previa no disponible';
  return div;
}

// Los navegadores basados en Chromium no decodifican HEIC/HEIF de forma nativa,
// así que esos formatos se convierten a JPEG una vez (con heic2any) y se reutiliza
// el resultado tanto para la miniatura como para la imagen a tamaño completo y el guardado.
async function getDisplayableBlob(photo) {
  if (photo.displayBlob) return photo.displayBlob;
  let blob = photo.file;
  if (isHeicFile(photo.file)) {
    blob = await heic2any({ blob: photo.file, toType: 'image/jpeg', quality: 0.85 });
    if (Array.isArray(blob)) blob = blob[0];
  }
  photo.displayBlob = blob;
  return blob;
}

async function makeThumbnail(photo) {
  try {
    const blob = await getDisplayableBlob(photo);
    const bitmap = await createImageBitmap(blob, { resizeWidth: 280, resizeQuality: 'medium' });
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch (err) {
    return null;
  }
}

async function openLightbox(photo) {
  lightbox.hidden = false;
  lightboxImg.removeAttribute('src');
  lightboxImg.alt = 'Cargando imagen...';

  try {
    const blob = await getDisplayableBlob(photo);
    if (currentLightboxUrl) URL.revokeObjectURL(currentLightboxUrl);
    currentLightboxUrl = URL.createObjectURL(blob);
    lightboxImg.src = currentLightboxUrl;
    lightboxImg.alt = photo.file.name;
  } catch (err) {
    lightboxImg.alt = 'No se ha podido cargar la imagen a tamaño completo.';
  }
}

function closeLightbox() {
  lightbox.hidden = true;
  lightboxImg.removeAttribute('src');
  if (currentLightboxUrl) {
    URL.revokeObjectURL(currentLightboxUrl);
    currentLightboxUrl = null;
  }
}

// --- Corrección de ubicación ---

function toggleEditLocation(photo) {
  photo.editing = !photo.editing;
  photo.marker.dragging[photo.editing ? 'enable' : 'disable']();
  photo.marker.setIcon(buildMarkerIcon(photo));
  photo.marker.getPopup().update();
  statusEl.textContent = photo.editing
    ? 'Arrastra el marcador a la ubicación correcta y suéltalo.'
    : `${photos.length} fotos cargadas`;
}

function onMarkerDragEnd(photo) {
  const pos = photo.marker.getLatLng();
  photo.editedLat = pos.lat;
  photo.editedLon = pos.lng;
  photo.dirty = true;
  photo.editing = false;
  photo.marker.dragging.disable();
  photo.marker.setIcon(buildMarkerIcon(photo));
  if (photo.marker.getPopup() && photo.marker.getPopup().isOpen()) {
    photo.marker.getPopup().update();
  }
  saveDirtyCache();
  updateSaveButton();
  statusEl.textContent = 'Ubicación corregida (sin guardar). Pulsa "Guardar cambios" para escribirla en el archivo.';
}

function undoEdit(photo) {
  photo.editedLat = null;
  photo.editedLon = null;
  photo.dirty = false;
  photo.marker.setLatLng([photo.lat, photo.lon]);
  photo.marker.setIcon(buildMarkerIcon(photo));
  saveDirtyCache();
  updateSaveButton();
}

function hasPendingChanges() {
  return photos.some((p) => p.dirty);
}

function updateSaveButton() {
  const dirtyCount = photos.filter((p) => p.dirty).length;
  if (dirtyCount > 0) {
    saveChangesBtn.hidden = false;
    saveChangesBtn.textContent = `Guardar cambios (${dirtyCount})`;
  } else {
    saveChangesBtn.hidden = true;
  }
}

function cacheKey() {
  return `georefotos:pending:${currentRootName}`;
}

function saveDirtyCache() {
  if (!currentRootName) return;
  const dirty = photos
    .filter((p) => p.dirty)
    .map((p) => ({ relativePath: p.relativePath, lat: p.editedLat, lon: p.editedLon }));
  if (dirty.length > 0) {
    localStorage.setItem(cacheKey(), JSON.stringify(dirty));
  } else {
    localStorage.removeItem(cacheKey());
  }
}

function restorePendingFromCache(photo) {
  if (!currentRootName) return;
  try {
    const raw = localStorage.getItem(cacheKey());
    if (!raw) return;
    const list = JSON.parse(raw);
    const match = list.find((e) => e.relativePath === photo.relativePath);
    if (match) {
      photo.editedLat = match.lat;
      photo.editedLon = match.lon;
      photo.dirty = true;
      photo.marker.setLatLng([match.lat, match.lon]);
      photo.marker.setIcon(buildMarkerIcon(photo));
    }
  } catch (err) {
    localStorage.removeItem(cacheKey());
  }
}

async function saveAllChanges() {
  const dirty = photos.filter((p) => p.dirty);
  if (dirty.length === 0) return;

  if (!editadasDirHandle) {
    try {
      editadasDirHandle = await rootDirHandle.getDirectoryHandle(EDITED_FOLDER_NAME, { create: true });
    } catch (err) {
      console.error(err);
      statusEl.textContent = 'No se ha podido crear la carpeta "editadas".';
      return;
    }
  }

  saveChangesBtn.disabled = true;
  let done = 0;
  let failed = 0;

  for (const photo of dirty) {
    statusEl.textContent = `Guardando ${done + failed + 1}/${dirty.length}...`;
    try {
      await savePhotoLocation(photo, editadasDirHandle);
      photo.lat = photo.editedLat;
      photo.lon = photo.editedLon;
      photo.editedLat = null;
      photo.editedLon = null;
      photo.dirty = false;
      photo.marker.setIcon(buildMarkerIcon(photo));
      done += 1;
    } catch (err) {
      console.error('No se pudo guardar la corrección de', photo.relativePath, err);
      failed += 1;
    }
  }

  saveDirtyCache();
  updateSaveButton();
  saveChangesBtn.disabled = false;
  statusEl.textContent =
    failed > 0
      ? `Guardado en /editadas: ${done} foto(s) ok, ${failed} con error (revisa la consola del navegador).`
      : `Guardado en /editadas: ${done} foto(s).`;
}
