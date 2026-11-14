"""Build the small equirectangular planet textures used by the cinematic space scene (display only).

Sources (no login): NASA Solar System Treks WMTS (Mars Viking MDIM 2.1 colour mosaic, Moon LRO WAC mosaic)
and NASA GIBS WMS (Earth Blue Marble shaded relief + bathymetry). These are decorative textures for the
cartoon space scene; they are never used for analysis.

    python scripts/fetch_textures.py        ->  frontend/public/textures/{earth,moon,mars}.jpg
"""
from __future__ import annotations

import io
import urllib.request
from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parents[1] / "frontend" / "public" / "textures"
UA = {"User-Agent": "MissionMatch-texture-fetch/1.0"}
TREK = {
    # Viking MDIM 2.1 true-colour mosaic (looks like Mars; the MOLA colour map is an elevation legend)
    "mars": "https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg",
    "moon": "https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{y}/{x}.jpg",
}
GIBS = ("https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0"
        "&LAYERS=BlueMarble_ShadedRelief_Bathymetry&STYLES=&CRS=EPSG:4326&BBOX=-90,-180,90,180"
        "&WIDTH=2048&HEIGHT=1024&FORMAT=image/jpeg")


def get(url: str) -> Image.Image:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return Image.open(io.BytesIO(r.read())).convert("RGB")


def trek(url: str, z: int = 2) -> Image.Image:
    # Geographic tiling scheme with 2x1 tiles at level 0 -> (2*2^z) x (2^z) tiles of 256 px.
    nx, ny = 2 * 2 ** z, 2 ** z
    out = Image.new("RGB", (nx * 256, ny * 256))
    for y in range(ny):
        for x in range(nx):
            out.paste(get(url.format(z=z, y=y, x=x)).resize((256, 256)), (x * 256, y * 256))
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for body, url in TREK.items():
        trek(url).save(OUT / f"{body}.jpg", quality=86)
        print("wrote", OUT / f"{body}.jpg")
    get(GIBS).save(OUT / "earth.jpg", quality=86)
    print("wrote", OUT / "earth.jpg")


if __name__ == "__main__":
    main()
