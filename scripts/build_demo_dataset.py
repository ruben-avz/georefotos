#!/usr/bin/env python3
"""Genera el dataset de demo público de GeoRefotos a partir de fotos HEIC propias.

Lee HEIC con GPS de una carpeta de origen (no versionada: son fotos personales),
los convierte a JPEG optimizados para web y reescribe su EXIF con el mínimo
imprescindible para la demo (GPS, azimut, fecha y dispositivo). Como las fotos
de origen no traen azimut de cámara, se les asigna uno sintético variado para
que la demo pueda mostrar las flechas de orientación. Además, a dos fotos se
les introduce deliberadamente un error (una de posición, otra de azimut) para
poder mostrar el flujo de corrección en la demo.

Uso:
    python scripts/build_demo_dataset.py <carpeta_con_heic> [--output demo]

Requiere: pillow-heif, piexif (pip install pillow-heif piexif).
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from math import cos, radians, sin
from pathlib import Path

import piexif
import pillow_heif
from PIL import Image

MAX_SIDE = 1600
JPEG_QUALITY = 85
METERS_PER_DEGREE_LAT = 111320.0

# Azimuts sintéticos variados (grados, 0=Norte, sentido horario), uno por foto en
# orden cronológico de nombre de archivo. Si hay más fotos que valores, se repite
# el ciclo.
SYNTHETIC_AZIMUTHS = [15, 95, 250, 340, 60, 190, 120, 300]

# Índices (0-based, sobre la lista de fotos con GPS ordenada por nombre) que
# reciben un error deliberado en la demo. Elegidos para las 8 fotos de
# sample.zip: la 3ª foto (demo_03) recibe un error de posición, la 7ª
# (demo_07) un error de azimut; el resto queda con sus valores reales.
LOCATION_ERROR_INDEX = 2
LOCATION_ERROR_DISTANCE_M = 32.0
LOCATION_ERROR_BEARING_DEG = 70.0

AZIMUTH_ERROR_INDEX = 6
AZIMUTH_ERROR_DELTA_DEG = 112.0


def offset_latlon(lat, lon, distance_m, bearing_deg):
    """Desplaza (lat, lon) `distance_m` metros en dirección `bearing_deg` (0=N, horario)."""
    bearing = radians(bearing_deg)
    dlat = (distance_m * cos(bearing)) / METERS_PER_DEGREE_LAT
    meters_per_degree_lon = METERS_PER_DEGREE_LAT * cos(radians(lat))
    dlon = (distance_m * sin(bearing)) / meters_per_degree_lon
    return lat + dlat, lon + dlon


def decimal_to_dms_rational(value):
    value = abs(value)
    degrees = int(value)
    minutes_float = (value - degrees) * 60
    minutes = int(minutes_float)
    seconds = (minutes_float - minutes) * 60
    return [(degrees, 1), (minutes, 1), (int(round(seconds * 10000)), 10000)]


def read_source_exif(heif):
    """Extrae lat/lon/fecha/marca/modelo del EXIF embebido en el HEIC de origen."""
    exif_bytes = heif.info.get("exif")
    if not exif_bytes:
        return None
    if exif_bytes[:6] == b"Exif\x00\x00":
        exif_bytes = exif_bytes[6:]
    exif_dict = piexif.load(exif_bytes)
    gps = exif_dict.get("GPS") or {}
    if piexif.GPSIFD.GPSLatitude not in gps or piexif.GPSIFD.GPSLongitude not in gps:
        return None

    def dms_to_deg(dms, ref):
        d, m, s = (part[0] / part[1] for part in dms)
        val = d + m / 60 + s / 3600
        if ref in (b"S", b"W", "S", "W"):
            val = -val
        return val

    lat = dms_to_deg(gps[piexif.GPSIFD.GPSLatitude], gps[piexif.GPSIFD.GPSLatitudeRef])
    lon = dms_to_deg(gps[piexif.GPSIFD.GPSLongitude], gps[piexif.GPSIFD.GPSLongitudeRef])
    make = exif_dict["0th"].get(piexif.ImageIFD.Make)
    model = exif_dict["0th"].get(piexif.ImageIFD.Model)
    date = exif_dict["Exif"].get(piexif.ExifIFD.DateTimeOriginal) or exif_dict["0th"].get(
        piexif.ImageIFD.DateTime
    )
    return {
        "lat": lat,
        "lon": lon,
        "make": make.decode("ascii", "ignore") if make else None,
        "model": model.decode("ascii", "ignore") if model else None,
        "date": date.decode("ascii", "ignore") if date else None,
    }


def build_minimal_exif(lat, lon, azimuth_deg, date_str, make, model):
    gps_ifd = {
        piexif.GPSIFD.GPSVersionID: [2, 3, 0, 0],
        piexif.GPSIFD.GPSLatitudeRef: "N" if lat >= 0 else "S",
        piexif.GPSIFD.GPSLatitude: decimal_to_dms_rational(lat),
        piexif.GPSIFD.GPSLongitudeRef: "E" if lon >= 0 else "W",
        piexif.GPSIFD.GPSLongitude: decimal_to_dms_rational(lon),
        piexif.GPSIFD.GPSImgDirectionRef: "T",
        piexif.GPSIFD.GPSImgDirection: [round(azimuth_deg * 100) % 36000, 100],
    }
    zeroth_ifd = {}
    if make:
        zeroth_ifd[piexif.ImageIFD.Make] = make
    if model:
        zeroth_ifd[piexif.ImageIFD.Model] = model
    exif_ifd = {}
    if date_str:
        exif_ifd[piexif.ExifIFD.DateTimeOriginal] = date_str
    exif_dict = {"0th": zeroth_ifd, "Exif": exif_ifd, "GPS": gps_ifd, "1st": {}, "thumbnail": None}
    return piexif.dump(exif_dict)


def resize_max_side(img, max_side):
    w, h = img.size
    if max(w, h) <= max_side:
        return img
    scale = max_side / max(w, h)
    return img.resize((round(w * scale), round(h * scale)), Image.LANCZOS)


def process(input_dir: Path, output_dir: Path):
    photos_dir = output_dir / "photos"
    photos_dir.mkdir(parents=True, exist_ok=True)

    candidates = []
    heic_paths = sorted({p.resolve() for p in input_dir.iterdir() if p.suffix.lower() == ".heic"})
    for path in heic_paths:
        heif = pillow_heif.open_heif(str(path), convert_hdr_to_8bit=True)
        source = read_source_exif(heif)
        if source is None:
            print(f"  omitida (sin GPS): {path.name}")
            continue
        candidates.append((path, heif, source))

    if not candidates:
        print("No se ha encontrado ningún HEIC con GPS en la carpeta de origen.", file=sys.stderr)
        sys.exit(1)

    manifest_photos = []
    for index, (path, heif, source) in enumerate(candidates):
        out_name = f"demo_{index + 1:02d}.jpg"
        reference_azimuth = SYNTHETIC_AZIMUTHS[index % len(SYNTHETIC_AZIMUTHS)]

        demo_lat, demo_lon = source["lat"], source["lon"]
        demo_azimuth = reference_azimuth
        error = None

        if index == LOCATION_ERROR_INDEX:
            demo_lat, demo_lon = offset_latlon(
                source["lat"], source["lon"], LOCATION_ERROR_DISTANCE_M, LOCATION_ERROR_BEARING_DEG
            )
            error = {
                "type": "location",
                "distance_m": LOCATION_ERROR_DISTANCE_M,
                "bearing_deg": LOCATION_ERROR_BEARING_DEG,
            }
        elif index == AZIMUTH_ERROR_INDEX:
            demo_azimuth = (reference_azimuth + AZIMUTH_ERROR_DELTA_DEG) % 360
            error = {"type": "azimuth", "delta_deg": AZIMUTH_ERROR_DELTA_DEG}

        img = Image.frombytes(heif.mode, heif.size, heif.data, "raw")
        if img.mode != "RGB":
            img = img.convert("RGB")
        img = resize_max_side(img, MAX_SIDE)

        exif_bytes = build_minimal_exif(
            demo_lat, demo_lon, demo_azimuth, source["date"], source["make"], source["model"]
        )
        out_path = photos_dir / out_name
        img.save(out_path, "JPEG", quality=JPEG_QUALITY, optimize=True, exif=exif_bytes)

        manifest_photos.append(
            {
                "file": out_name,
                "reference": {
                    "lat": round(source["lat"], 6),
                    "lon": round(source["lon"], 6),
                    "azimuth_deg": reference_azimuth,
                },
                "embedded_in_jpg": {
                    "lat": round(demo_lat, 6),
                    "lon": round(demo_lon, 6),
                    "azimuth_deg": round(demo_azimuth, 1),
                },
                "error": error,
            }
        )
        note = f" -> ERROR {error['type']}" if error else ""
        print(f"  {path.name} -> {out_name}{note}")

    manifest = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "source": "sample.zip (fotos personales del autor, no incluidas en el repositorio)",
        "notes": (
            "Todas las fotos traían GPS pero sin GPSImgDirection; el azimut de referencia "
            "de cada foto es sintético. 'embedded_in_jpg' son los valores realmente escritos "
            "en el EXIF del JPEG de demo (los que lee la app); 'reference' son los valores "
            "correctos. Solo una foto tiene error de posición y solo otra tiene error de "
            "azimut; el resto coincide con su referencia."
        ),
        "photos": manifest_photos,
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nManifest: {manifest_path}")

    total_bytes = sum(f.stat().st_size for f in photos_dir.glob("*.jpg")) + manifest_path.stat().st_size
    print(f"Fotos procesadas: {len(manifest_photos)}")
    print(f"Tamaño total del dataset: {total_bytes / 1024:.1f} KB")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_dir", type=Path, help="Carpeta con los HEIC de origen (sample.zip descomprimido)")
    parser.add_argument("--output", type=Path, default=Path("demo"), help="Carpeta de salida (por defecto: demo/)")
    args = parser.parse_args()
    process(args.input_dir, args.output)


if __name__ == "__main__":
    main()
