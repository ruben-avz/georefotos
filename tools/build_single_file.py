#!/usr/bin/env python3
"""Empaqueta GeoRefotos (index.html + css/js locales) en un único HTML autocontenido.

Los CDN externos (Leaflet, exifr, heic2any, piexifjs) se dejan como <link>/<script> remotos:
la app ya necesita internet para los tiles del mapa, así que embeberlos no aporta nada y
solo infla mucho el archivo. Solo se incrustan los ficheros propios del proyecto (css/js).

Uso:
    python tools/build_single_file.py [ruta_salida.html]

Sin argumentos, genera georefotos.bundle.html en la raíz del proyecto.
"""

import re
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
INDEX_HTML = PROJECT_ROOT / "index.html"

LINK_RE = re.compile(r'<link\s+rel="stylesheet"\s+href="([^"]+)"\s*/?>')
SCRIPT_RE = re.compile(r'<script\s+src="([^"]+)"\s*></script>')


def is_local(url):
    return not url.startswith(("http://", "https://"))


def inline_stylesheets(html):
    def replace(match):
        href = match.group(1)
        if not is_local(href):
            return match.group(0)
        css = (PROJECT_ROOT / href).read_text(encoding="utf-8")
        return f"<style>\n{css}\n</style>"

    return LINK_RE.sub(replace, html)


def inline_scripts(html):
    def replace(match):
        src = match.group(1)
        if not is_local(src):
            return match.group(0)
        js = (PROJECT_ROOT / src).read_text(encoding="utf-8")
        return f"<script>\n{js}\n</script>"

    return SCRIPT_RE.sub(replace, html)


def build(output_path):
    html = INDEX_HTML.read_text(encoding="utf-8")
    html = inline_stylesheets(html)
    html = inline_scripts(html)
    output_path.write_text(html, encoding="utf-8")
    size_kb = output_path.stat().st_size / 1024
    print(f"Generado {output_path} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else PROJECT_ROOT / "georefotos.bundle.html"
    build(output)
