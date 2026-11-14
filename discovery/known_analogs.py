"""Well-known terrestrial Moon/Mars analog areas, used only to LABEL results.

A result far from every entry is labelled "not in our list of well-known analog sites". That is
NOT a claim of first discovery: the list is short and hand-made from widely cited analog sites.
Coordinates are approximate area centres; radius_km is a generous area extent.
"""
from __future__ import annotations

import math

KNOWN_ANALOGS = [
    ("Atacama Desert (Chile)", -24.5, -69.25, 350),
    ("Death Valley (USA)", 36.3, -116.9, 120),
    ("Mojave Desert / Fort Irwin (USA)", 35.1, -116.3, 150),
    ("Utah MDRS / San Rafael Swell (USA)", 38.4, -110.8, 120),
    ("Meteor Crater / San Francisco Volcanic Field (USA)", 35.3, -111.4, 120),
    ("Haughton Crater, Devon Island (Canada)", 75.4, -89.7, 100),
    ("Iceland highlands", 64.9, -18.5, 300),
    ("Hawaii (Mauna Kea / Kilauea)", 19.7, -155.5, 200),
    ("Pinacate (Mexico)", 31.8, -113.5, 80),
    ("Rio Tinto (Spain)", 37.7, -6.6, 60),
    ("Svalbard (Norway)", 78.5, 16.0, 250),
    ("McMurdo Dry Valleys (Antarctica)", -77.5, 162.0, 200),
    ("Lonar Crater (India)", 19.98, 76.51, 40),
    ("Craters of the Moon (USA)", 43.4, -113.5, 80),
    ("Lanzarote (Spain)", 29.0, -13.6, 60),
    ("Wadi Rum (Jordan)", 29.6, 35.4, 80),
    ("Harrat Khaybar (Saudi Arabia)", 25.7, 39.9, 80),
    ("Qaidam Basin (China)", 37.5, 94.5, 300),
    ("Dhofar (Oman)", 18.5, 54.5, 150),
    ("Pilbara (Australia)", -21.5, 119.0, 250),
]


def _km(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371.0088 * math.asin(math.sqrt(min(h, 1.0)))


def nearest_known_analog(lat: float, lon: float) -> dict | None:
    """The known analog area containing (lat, lon), or None."""
    best = None
    for name, la, lo, r in KNOWN_ANALOGS:
        d = _km(lat, lon, la, lo)
        if d <= r and (best is None or d < best["distance_km"]):
            best = {"name": name, "distance_km": round(d, 1)}
    return best
