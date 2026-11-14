import { useEffect, useRef, useState } from 'react';
import {
  Viewer, ImageryLayer, UrlTemplateImageryProvider, GeographicTilingScheme, Credit, Ellipsoid,
  Cartesian3, Cartesian2, Color, PolygonHierarchy, ScreenSpaceEventHandler, ScreenSpaceEventType,
  LabelStyle, VerticalOrigin, EllipsoidTerrainProvider, Math as CMath, CallbackProperty, NearFarScalar,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { astronautSprite } from '../scene/astronaut.js';

// Spheres used by the analysis data (MOLA 3396.19 km, LOLA 1737.4 km), so clicked latitudes are
// planetocentric exactly like the pipeline expects. Imagery: NASA Solar System Treks WMTS (no token).
export const PLANETS = {
  mars: {
    radius: 3396190,
    url: 'https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg',
    maxLevel: 7,
    credit: 'Imagery: NASA Mars Trek, Viking MDIM 2.1 colour mosaic (232 m)',
  },
  moon: {
    radius: 1737400,
    url: 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{y}/{x}.jpg',
    maxLevel: 7,
    credit: 'Imagery: NASA Moon Trek, LRO WAC global mosaic',
  },
};

const ACCENT = Color.fromCssColorString('#f2a541');
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** 3D Moon/Mars globe. Click to place a pin; shows the measured 20 km footprint. Never shows Earth data. */
export default function PlanetGlobe({ body, pin, markers = [], onPick, disabled, scanning = false }) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const ellRef = useRef(null);
  const onPickRef = useRef(onPick);
  const disabledRef = useRef(disabled);
  const [imageryError, setImageryError] = useState(false);
  const [globeError, setGlobeError] = useState(null);
  onPickRef.current = onPick;
  disabledRef.current = disabled;

  useEffect(() => {
    const cfg = PLANETS[body];
    const ellipsoid = new Ellipsoid(cfg.radius, cfg.radius, cfg.radius);
    ellRef.current = ellipsoid;
    // Entity geometry helpers fall back to Ellipsoid.default; switch it while this globe is mounted
    // (only one globe is ever mounted) and restore Earth's WGS84 on unmount.
    const previousDefault = Ellipsoid.default;
    Ellipsoid.default = ellipsoid;
    let viewer;
    let handler;
    setImageryError(false);
    try {
      const provider = new UrlTemplateImageryProvider({
        url: cfg.url,
        tilingScheme: new GeographicTilingScheme({ ellipsoid, numberOfLevelZeroTilesX: 2, numberOfLevelZeroTilesY: 1 }),
        maximumLevel: cfg.maxLevel,
        credit: new Credit(cfg.credit),
      });
      provider.errorEvent.addEventListener(() => setImageryError(true));
      viewer = new Viewer(containerRef.current, {
        ellipsoid,
        baseLayer: new ImageryLayer(provider),
        terrainProvider: new EllipsoidTerrainProvider({ ellipsoid }),
        baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
        navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: false,
        infoBox: false, selectionIndicator: false, skyAtmosphere: false,
      });
      viewer.scene.globe.showGroundAtmosphere = false;
      viewer.scene.globe.enableLighting = false;
      if (viewer.scene.sun) viewer.scene.sun.show = false;
      if (viewer.scene.moon) viewer.scene.moon.show = false;
      viewer.camera.setView({ destination: Cartesian3.fromDegrees(body === 'mars' ? 77 : 0, body === 'mars' ? 18 : 0, cfg.radius * 3, ellipsoid) });
      handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((click) => {
        if (disabledRef.current) return;
        const cart = viewer.camera.pickEllipsoid(click.position, ellipsoid);
        if (!cart) return;
        const c = ellipsoid.cartesianToCartographic(cart);
        onPickRef.current?.(CMath.toDegrees(c.latitude), CMath.toDegrees(c.longitude));
      }, ScreenSpaceEventType.LEFT_CLICK);
      viewerRef.current = viewer;
    } catch (err) {
      setGlobeError(err?.message || 'WebGL not available');
    }
    return () => {
      handler?.destroy();
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
      Ellipsoid.default = previousDefault;
    };
  }, [body]);

  // quick-pick markers (named places) + the measured pin footprint
  useEffect(() => {
    const viewer = viewerRef.current;
    const ellipsoid = ellRef.current;
    if (!viewer || !ellipsoid) return;
    viewer.entities.removeAll();
    for (const m of markers) {
      viewer.entities.add({
        id: `place:${m.name}`,
        position: Cartesian3.fromDegrees(m.lon, m.lat, 0, ellipsoid),
        point: { pixelSize: 6, color: Color.WHITE.withAlpha(0.85), outlineColor: Color.BLACK, outlineWidth: 1 },
        label: { text: m.name, font: '12px sans-serif', fillColor: Color.WHITE, style: LabelStyle.FILL_AND_OUTLINE,
          outlineWidth: 3, outlineColor: Color.BLACK, verticalOrigin: VerticalOrigin.BOTTOM, pixelOffset: new Cartesian2(0, -8) },
      });
    }
    if (pin) {
      const ring = pin.footprint?.coordinates?.[0] || [];
      const deg = ring.flatMap(([lo, la]) => [lo, la]);
      viewer.entities.add({
        id: `pin:${pin.id}`,
        position: Cartesian3.fromDegrees(pin.center.lon, pin.center.lat, 0, ellipsoid),
        point: { pixelSize: 10, color: ACCENT, outlineColor: Color.BLACK, outlineWidth: 1 },
        label: { text: 'PIN (20 km window)', font: '600 13px sans-serif', fillColor: ACCENT, style: LabelStyle.FILL_AND_OUTLINE,
          outlineWidth: 3, outlineColor: Color.BLACK, verticalOrigin: VerticalOrigin.TOP, pixelOffset: new Cartesian2(0, 12) },
        ...(deg.length >= 8 ? {
          polygon: { hierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArray(deg.slice(0, -2), ellipsoid)),
            material: ACCENT.withAlpha(0.3), height: 0 },
          polyline: { positions: Cartesian3.fromDegreesArray(deg, ellipsoid), width: 2, material: ACCENT },
        } : {}),
      });
      viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(pin.center.lon, pin.center.lat, 250000, ellipsoid),
        duration: reduceMotion() ? 0 : 1.5,
      });
      // the astronaut drops onto the pinned window
      const sprite = astronautSprite();
      if (sprite) {
        const t0 = performance.now() + (reduceMotion() ? -5000 : 900);
        viewer.entities.add({
          id: 'mm-astronaut',
          position: new CallbackProperty(() => {
            const p = Math.max(0, Math.min(1, (performance.now() - t0) / 1300));
            const h = 180000 * (1 - p) ** 2 + Math.abs(Math.sin(p * Math.PI * 3)) * 4000 * (1 - p);
            return Cartesian3.fromDegrees(pin.center.lon, pin.center.lat, h, ellipsoid);
          }, false),
          billboard: { image: sprite, verticalOrigin: VerticalOrigin.BOTTOM, scale: 0.5,
            scaleByDistance: new NearFarScalar(1.0e5, 0.8, 1.0e7, 0.3), disableDepthTestDistance: Number.POSITIVE_INFINITY },
        });
      }
    }
  }, [pin, markers, body]);

  return (
    <div className={`globe-wrap ${scanning ? 'scanning' : ''}`}>
      <div ref={containerRef} className="globe" />
      {scanning && (
        <div className="scan-hud" role="status">
          <div className="scan-sweep" />
          <div className="scan-text">
            <b>Scanning terrain</b>
            <span>slope classes · relief · local roughness</span>
            <span className="muted">reading NASA {body === 'mars' ? 'MOLA' : 'LOLA'} elevation for a 20 km window</span>
          </div>
        </div>
      )}
      <div className="globe-note small">
        {body === 'mars' ? 'Mars' : 'Moon'} in 3D (NASA Trek imagery). Click anywhere to pin a 20 km window; its terrain is
        measured from {body === 'mars' ? 'MOLA' : 'LOLA'} elevation before searching Earth.
      </div>
      {(imageryError || globeError) && (
        <div className="globe-error" role="alert">
          {globeError ? `3D globe unavailable (${globeError}).` : 'Planet imagery could not be loaded.'} You can still use the named places in the panel.
        </div>
      )}
    </div>
  );
}
