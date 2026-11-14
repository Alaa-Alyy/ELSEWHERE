import { useEffect, useRef, useState } from 'react';
import {
  Viewer, ImageryLayer, WebMapTileServiceImageryProvider, WebMercatorTilingScheme, Credit,
  Cartesian3, Cartesian2, Color, PolygonHierarchy, Rectangle, ScreenSpaceEventHandler,
  ScreenSpaceEventType, LabelStyle, VerticalOrigin, EllipsoidTerrainProvider, defined,
  DistanceDisplayCondition, CallbackProperty, ColorMaterialProperty, NearFarScalar,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { astronautSprite } from '../scene/astronaut.js';

const easeOutBounce = (x) => {
  const n1 = 7.5625; const d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
};

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

export default function EarthGlobe({ parents = [], items = [], detailsById = {}, selectedId, alternativeId, onSelect, landOn = null, onLanded }) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const onSelectRef = useRef(onSelect);
  const onLandedRef = useRef(onLanded);
  // astronaut landing animation state (read by Cesium CallbackProperty every frame)
  const hopRef = useRef({ from: null, to: null, t0: 0, dur: 1, landed: true, dustT0: 0 });
  const [imageryError, setImageryError] = useState(false);
  const [globeError, setGlobeError] = useState(null);
  onSelectRef.current = onSelect;
  onLandedRef.current = onLanded;

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

      // cartoon astronaut: falls from the sky onto the chosen window, hops between windows
      const sprite = astronautSprite();
      const hop = hopRef.current;
      const now = () => performance.now();
      const progress = () => Math.max(0, Math.min(1, (now() - hop.t0) / hop.dur));
      const where = () => {
        if (!hop.to) return Cartesian3.fromDegrees(0, 0, -1e7);
        const p = progress();
        if (!hop.from) {
          return Cartesian3.fromDegrees(hop.to.lon, hop.to.lat, 1.6e6 * (1 - easeOutBounce(p)));
        }
        let dlon = hop.to.lon - hop.from.lon;
        if (dlon > 180) dlon -= 360; else if (dlon < -180) dlon += 360;
        const e = p * p * (3 - 2 * p);
        const span = Math.hypot(dlon, hop.to.lat - hop.from.lat);
        const hmax = Math.min(2.5e6, 40000 * span + 60000);
        return Cartesian3.fromDegrees(hop.from.lon + dlon * e, hop.from.lat + (hop.to.lat - hop.from.lat) * e, 4 * hmax * p * (1 - p));
      };
      if (sprite) {
        viewer.entities.add({
          id: 'mm-astronaut',
          position: new CallbackProperty(where, false),
          billboard: {
            image: sprite, verticalOrigin: VerticalOrigin.BOTTOM, scale: 0.5,
            scaleByDistance: new NearFarScalar(2.0e5, 0.75, 2.0e7, 0.35),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      }
      viewer.entities.add({
        id: 'mm-dust',
        position: new CallbackProperty(() => (hop.to ? Cartesian3.fromDegrees(hop.to.lon, hop.to.lat) : Cartesian3.fromDegrees(0, 0, -1e7)), false),
        ellipse: {
          semiMajorAxis: new CallbackProperty(() => 2000 + 30000 * Math.min(1, (now() - hop.dustT0) / 900), false),
          semiMinorAxis: new CallbackProperty(() => 2000 + 30000 * Math.min(1, (now() - hop.dustT0) / 900), false),
          material: new ColorMaterialProperty(new CallbackProperty(() => Color.fromCssColorString('#ffd9a8')
            .withAlpha(hop.landed && hop.dustT0 ? Math.max(0, 0.6 * (1 - (now() - hop.dustT0) / 900)) : 0), false)),
          height: 0,
        },
      });
      viewer.scene.postRender.addEventListener(() => {
        if (!hop.landed && hop.to && progress() >= 1) {
          hop.landed = true;
          hop.dustT0 = now();
          onLandedRef.current?.();
        }
      });
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
    if (!items.length) hopRef.current.to = null;
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
          text: `#${idx + 1}${role}`, font: '600 14px sans-serif', fillColor: color,
          style: LabelStyle.FILL_AND_OUTLINE, outlineWidth: 3, outlineColor: Color.BLACK,
          verticalOrigin: VerticalOrigin.TOP, pixelOffset: new Cartesian2(0, 12),   // below, so the astronaut stays clear
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
    const pad = selectedId ? 1.1 : 1.5;   // show the window in its landscape context (imagery is ~1 km)
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

  // ---- astronaut lands on `landOn` (first time: falls from the sky; afterwards: hops)
  const landCenter = landOn ? (detailsById[landOn]?.item?.center || items.find((i) => i.candidate_id === landOn)?.center) : null;
  const landKey = landOn && landCenter ? `${landOn}@${landCenter.lat},${landCenter.lon}` : null;
  useEffect(() => {
    if (!landKey) return;
    const hop = hopRef.current;
    const instant = reduceMotion();
    hop.from = hop.to && hop.landed ? hop.to : null;
    hop.to = { lat: landCenter.lat, lon: landCenter.lon };
    hop.dur = instant ? 1 : hop.from ? 1500 : 1900;
    hop.t0 = performance.now() + (instant ? 0 : hop.from ? 250 : 600);
    hop.landed = false;
    hop.dustT0 = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landKey]);

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
