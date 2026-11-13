import { useEffect, useRef, useState } from 'react';
import {
  Viewer, ImageryLayer, WebMapTileServiceImageryProvider, WebMercatorTilingScheme, Credit,
  Cartesian3, Cartesian2, Color, PolygonHierarchy, Rectangle, ScreenSpaceEventHandler,
  ScreenSpaceEventType, LabelStyle, VerticalOrigin, EllipsoidTerrainProvider, defined,
  DistanceDisplayCondition,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

// NASA GIBS (Worldview) WMTS, no token required. Display imagery only - not the analysis data.
const GIBS_URL = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{TileMatrix}/{TileRow}/{TileCol}.jpeg';

const ACCENT = Color.fromCssColorString('#f2a541');
const ALT = Color.fromCssColorString('#7cc4ff');
const OTHER = Color.fromCssColorString('#e8edf5');

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function ringDegrees(footprint) {
  const ring = footprint?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 4) return null;
  return ring.flatMap(([lon, lat]) => [lon, lat]);
}

export default function EarthGlobe({ parents = [], items = [], detailsById = {}, selectedId, alternativeId, onSelect }) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const onSelectRef = useRef(onSelect);
  const [imageryError, setImageryError] = useState(false);
  const [globeError, setGlobeError] = useState(null);
  onSelectRef.current = onSelect;

  // ---- one Viewer for the lifetime of the component
  useEffect(() => {
    let viewer;
    let handler;
    try {
      const provider = new WebMapTileServiceImageryProvider({
        url: GIBS_URL,
        layer: 'BlueMarble_ShadedRelief_Bathymetry',
        style: 'default',
        format: 'image/jpeg',
        tileMatrixSetID: 'GoogleMapsCompatible_Level8',
        tilingScheme: new WebMercatorTilingScheme(),
        maximumLevel: 8,
        credit: new Credit('Imagery: NASA EOSDIS GIBS / Worldview, Blue Marble Shaded Relief and Bathymetry'),
      });
      provider.errorEvent.addEventListener(() => setImageryError(true));

      viewer = new Viewer(containerRef.current, {
        baseLayer: new ImageryLayer(provider),
        terrainProvider: new EllipsoidTerrainProvider(),
        baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
        navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: false,
        infoBox: false, selectionIndicator: false,
      });
      viewer.scene.globe.enableLighting = false;
      viewer.scene.skyAtmosphere.show = true;
      viewer.camera.setView({ destination: Cartesian3.fromDegrees(-40, 28, 22000000) });

      handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((click) => {
        const picked = viewer.scene.pick(click.position);
        const id = defined(picked) && picked.id?.id;
        if (typeof id === 'string' && id.startsWith('earth-') && !id.startsWith('parent:')) {
          onSelectRef.current?.(id);
        }
      }, ScreenSpaceEventType.LEFT_CLICK);
      viewerRef.current = viewer;
    } catch (err) {
      setGlobeError(err?.message || 'WebGL not available');
    }
    return () => {
      handler?.destroy();
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  // ---- parent coverage outlines (faint, labeled)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    for (const p of parents) {
      const eid = `parent:${p.id}`;
      if (viewer.entities.getById(eid)) continue;
      const deg = ringDegrees(p.footprint);
      if (!deg) continue;
      viewer.entities.add({
        id: eid,
        polyline: { positions: Cartesian3.fromDegreesArray(deg), width: 1.5, material: OTHER.withAlpha(0.55) },
        position: Cartesian3.fromDegrees(p.center.lon, p.center.lat),
        label: {
          text: `${p.name} (searched parent region)`, font: '13px sans-serif', fillColor: OTHER,
          style: LabelStyle.FILL_AND_OUTLINE, outlineWidth: 3, outlineColor: Color.BLACK,
          verticalOrigin: VerticalOrigin.BOTTOM, pixelOffset: new Cartesian2(0, -60),
          distanceDisplayCondition: new DistanceDisplayCondition(0, 4.0e6),
        },
      });
    }
    viewer.scene.requestRender();
  }, [parents]);

  // ---- candidate footprints/centers; entity id === candidate_id
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const wanted = new Set(items.map((i) => i.candidate_id));
    for (const e of [...viewer.entities.values]) {
      if (e.id.startsWith('earth-') && !wanted.has(e.id)) viewer.entities.remove(e);
    }
    items.forEach((it, idx) => {
      const rec = detailsById[it.candidate_id]?.item;
      const deg = ringDegrees(rec?.footprint);
      if (!rec || !deg) return;
      const isSel = it.candidate_id === selectedId;
      const isAlt = it.candidate_id === alternativeId;
      const color = isSel ? ACCENT : isAlt ? ALT : OTHER;
      const role = isSel ? ' SELECTED' : isAlt ? ' ALTERNATIVE' : '';
      const existing = viewer.entities.getById(it.candidate_id);
      if (existing) viewer.entities.remove(existing);
      viewer.entities.add({
        id: it.candidate_id,
        polygon: {
          hierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArray(deg.slice(0, -2))),
          material: color.withAlpha(isSel ? 0.35 : 0.18),
          height: 0,
        },
        polyline: { positions: Cartesian3.fromDegreesArray(deg), width: isSel ? 3 : 2, material: color },
        position: Cartesian3.fromDegrees(rec.center.lon, rec.center.lat),
        point: { pixelSize: isSel ? 10 : 7, color, outlineColor: Color.BLACK, outlineWidth: 1 },
        label: {
          text: `#${idx + 1}${role}`, font: '14px sans-serif', fillColor: color,
          style: LabelStyle.FILL_AND_OUTLINE, outlineWidth: 3, outlineColor: Color.BLACK,
          verticalOrigin: VerticalOrigin.BOTTOM, pixelOffset: new Cartesian2(0, -14),
        },
      });
    });
    viewer.scene.requestRender();
  }, [items, detailsById, selectedId, alternativeId]);

  // ---- short fly-to on selection (or to the result set when first shown)
  const firstId = items[0]?.candidate_id;
  const flyKey = selectedId || (firstId ? `set:${items.map((i) => i.candidate_id).join(',')}` : null);
  const flyReady = selectedId ? !!detailsById[selectedId]?.item : items.every((i) => detailsById[i.candidate_id]?.item);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !flyKey || !flyReady) return;
    const recs = (selectedId ? [selectedId] : items.map((i) => i.candidate_id))
      .map((id) => detailsById[id]?.item).filter(Boolean);
    const pts = recs.flatMap((r) => r.footprint?.coordinates?.[0] || []);
    if (!pts.length) return;
    const lons = pts.map((p) => p[0]);
    const lats = pts.map((p) => p[1]);
    const pad = selectedId ? 0.25 : 1.5;
    const w = Math.min(...lons); const e = Math.max(...lons);
    const s = Math.min(...lats); const n = Math.max(...lats);
    const duration = reduceMotion() ? 0 : 1.5;
    if (e - w > 40) {
      // Results on different continents: show the whole hemisphere around them.
      viewer.camera.flyTo({ destination: Cartesian3.fromDegrees((w + e) / 2, (s + n) / 2, 17000000), duration });
    } else {
      viewer.camera.flyTo({ destination: Rectangle.fromDegrees(w - pad, s - pad, e + pad, n + pad), duration });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyKey, flyReady]);

  return (
    <div className="globe-wrap">
      <div ref={containerRef} className="globe" />
      <div className="globe-note small">
        Display imagery: NASA GIBS Blue Marble. It may differ from the SRTM elevation data used for analysis.
        Only Earth candidate windows are drawn here.
      </div>
      {(imageryError || globeError) && (
        <div className="globe-error" role="alert">
          {globeError ? `3D globe unavailable (${globeError}).` : 'Map imagery could not be loaded.'} The candidate cards and evidence still work.
        </div>
      )}
    </div>
  );
}
