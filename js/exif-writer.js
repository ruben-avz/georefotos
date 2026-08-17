// GeoRefotos: escritura de la corrección de ubicación en una copia editada.
//
// Los originales nunca se modifican. Cada corrección se guarda como una copia en la
// carpeta "editadas" (dentro de la carpeta seleccionada): JPEG con el bloque GPS del EXIF
// reescrito (se conserva el resto de metadatos), o HEIC/HEIF convertido a JPEG con un EXIF
// nuevo (fecha, dispositivo, GPS, azimut), ya que los navegadores no saben escribir EXIF
// dentro de un contenedor HEIC. Ediciones sucesivas de la misma foto sobreescriben la misma
// copia editada (el nombre de archivo destino es siempre el mismo, derivado de la ruta del
// original).

const EDITED_FOLDER_NAME = 'editadas';

function editedFileName(relativePath) {
  const flat = relativePath.replace(/\//g, '__');
  const ext = getExtensionFromName(flat);
  if (ext === 'heic' || ext === 'heif') {
    return `${flat.slice(0, -(ext.length + 1))}.jpg`;
  }
  return flat;
}

function decimalToDmsRational(value) {
  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  const minutesFloat = (abs - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  const seconds = Math.round((minutesFloat - minutes) * 60 * 100);
  return [[degrees, 1], [minutes, 1], [seconds, 100]];
}

function buildGpsIfd(lat, lon, azimuth) {
  const gps = {
    [piexif.GPSIFD.GPSVersionID]: [2, 3, 0, 0],
    [piexif.GPSIFD.GPSLatitudeRef]: lat >= 0 ? 'N' : 'S',
    [piexif.GPSIFD.GPSLatitude]: decimalToDmsRational(lat),
    [piexif.GPSIFD.GPSLongitudeRef]: lon >= 0 ? 'E' : 'W',
    [piexif.GPSIFD.GPSLongitude]: decimalToDmsRational(lon)
  };
  if (azimuth != null) {
    gps[piexif.GPSIFD.GPSImgDirectionRef] = 'T';
    gps[piexif.GPSIFD.GPSImgDirection] = [Math.round(azimuth * 100), 100];
  }
  return gps;
}

function formatExifDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}:${pad(date.getMonth() + 1)}:${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataURLToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/data:(.*?);base64/)[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function buildJpegExportBlob(photo) {
  const dataUrl = await blobToDataURL(photo.file);
  let exifObj;
  try {
    exifObj = piexif.load(dataUrl);
  } catch (err) {
    exifObj = { '0th': {}, Exif: {}, GPS: {}, '1st': {}, thumbnail: null };
  }
  exifObj.GPS = buildGpsIfd(photo.editedLat, photo.editedLon, photo.azimuth);
  const exifBytes = piexif.dump(exifObj);
  const newDataUrl = piexif.insert(exifBytes, dataUrl);
  return dataURLToBlob(newDataUrl);
}

async function buildHeicExportBlob(photo) {
  const jpegBlob = await getDisplayableBlob(photo);
  const dataUrl = await blobToDataURL(jpegBlob);

  const exifObj = { '0th': {}, Exif: {}, GPS: {}, '1st': {}, thumbnail: null };
  if (photo.make) exifObj['0th'][piexif.ImageIFD.Make] = photo.make;
  if (photo.model) exifObj['0th'][piexif.ImageIFD.Model] = photo.model;
  if (photo.date) exifObj.Exif[piexif.ExifIFD.DateTimeOriginal] = formatExifDate(photo.date);
  exifObj.GPS = buildGpsIfd(photo.editedLat, photo.editedLon, photo.azimuth);

  const exifBytes = piexif.dump(exifObj);
  const newDataUrl = piexif.insert(exifBytes, dataUrl);
  return dataURLToBlob(newDataUrl);
}

async function savePhotoLocation(photo, editadasDirHandle) {
  const ext = getExtension(photo.file);
  let blob;
  if (ext === 'heic' || ext === 'heif') {
    blob = await buildHeicExportBlob(photo);
  } else if (ext === 'jpg' || ext === 'jpeg') {
    blob = await buildJpegExportBlob(photo);
  } else {
    throw new Error(`Formato .${ext} no soportado para guardar la corrección`);
  }

  const targetName = editedFileName(photo.relativePath);
  const fileHandle = await editadasDirHandle.getFileHandle(targetName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  photo.hasSavedEdit = true;
}
