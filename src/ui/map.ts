import maplibregl from 'maplibre-gl';
import L from 'leaflet';
import type { AmenityFeature, LocationAudit, PropertyParcel, UnderwritingStrategy } from '../engine/types';
import { calcUnderwriting } from '../engine/underwriting';
import { escHtml } from '../engine/markdown';
import { geocodeWithGoogleMaps } from '../connectors/googleMaps';

const OPENFREEMAP_STYLES: Record<string, string> = {
  fiord: 'https://tiles.openfreemap.org/styles/fiord',
  dark: 'https://tiles.openfreemap.org/styles/dark',
  liberty: 'https://tiles.openfreemap.org/styles/liberty',
  positron: 'https://tiles.openfreemap.org/styles/positron',
};

const LEAFLET_TILE_STYLES: Record<
  string,
  { label: string; url: string; options: L.TileLayerOptions }
> = {
  esri_satellite: {
    label: 'Leaflet · Esri Satellite Aerial',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 19, attribution: '&copy; Esri World Imagery' },
  },
  opentopomap: {
    label: 'Leaflet · OpenTopoMap Contours',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    options: { maxZoom: 17, attribution: '&copy; OpenTopoMap' },
  },
  carto_dark: {
    label: 'Leaflet · Carto Dusk',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    options: { subdomains: 'abcd', maxZoom: 20, attribution: '&copy; OSM &copy; CARTO' },
  },
  osm_standard: {
    label: 'Leaflet · OSM Standard',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: { maxZoom: 19, attribution: '&copy; OpenStreetMap' },
  },
};

export interface MapStateCallbacks {
  getProperties: () => PropertyParcel[];
  getActiveIndex: () => number;
  getStrategy: () => UnderwritingStrategy;
  getLocationAudit: (id: string) => LocationAudit | undefined;
  setLocationAudit: (id: string, audit: LocationAudit) => void;
  onSelectProperty: (idx: number) => void;
  getGoogleMapsKey: () => string;
}

export class SpatialMapController {
  private map: maplibregl.Map | null = null;
  private mapMarkers: maplibregl.Marker[] = [];
  private leafletMap: L.Map | null = null;
  private leafletTileLayer: L.TileLayer | null = null;
  private leafletOverlayGroup: L.LayerGroup | null = null;
  private leafletMarkers: L.Marker[] = [];

  public mapStyle = 'fiord';
  public perspective: '2d' | 'iso' | 'street' = 'iso';
  public layers = { rings: true, heatmap: true };
  public visibleAmenities = { schools: true, transit: true, retail: true };

  constructor(private cb: MapStateCallbacks) {}

  private createCircleCoords(lng: number, lat: number, radiusMeters: number): [number, number][] {
    const pts: [number, number][] = [];
    const dLat = radiusMeters / 111320;
    const dLng = radiusMeters / (111320 * Math.cos((lat * Math.PI) / 180));
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      pts.push([lng + Math.cos(a) * dLng, lat + Math.sin(a) * dLat]);
    }
    return pts;
  }

  public initOrRefresh(): void {
    const props = this.cb.getProperties();
    const active = props[this.cb.getActiveIndex()] || props[0];
    if (!active) return;

    const isVector = Boolean(OPENFREEMAP_STYLES[this.mapStyle]);
    const glEl = document.getElementById('openmap-canvas');
    const lfEl = document.getElementById('leaflet-map-canvas');
    const pill = document.getElementById('map-engine-pill');
    if (!glEl || !lfEl) return;

    if (isVector) {
      glEl.classList.remove('hidden');
      lfEl.classList.add('hidden');
      if (pill) pill.textContent = `MapLibre 3D · ${this.mapStyle}`;

      const pitch = this.perspective === '2d' ? 0 : this.perspective === 'street' ? 62 : 45;
      const bearing = this.perspective === '2d' ? 0 : -16;

      if (!this.map) {
        this.map = new maplibregl.Map({
          container: glEl,
          style: OPENFREEMAP_STYLES[this.mapStyle],
          center: [active.lng, active.lat],
          zoom: 13.5,
          pitch,
          bearing,
        });
        this.map.addControl(new maplibregl.NavigationControl(), 'top-right');
        this.map.on('load', () => {
          this.syncMarkers();
          this.applyOverlays();
        });
      } else {
        this.map.setStyle(OPENFREEMAP_STYLES[this.mapStyle]);
        this.map.once('styledata', () => this.applyOverlays());
        this.map.easeTo({ center: [active.lng, active.lat], pitch, bearing, duration: 500 });
        this.syncMarkers();
      }
      setTimeout(() => this.map?.resize(), 60);
    } else {
      glEl.classList.add('hidden');
      lfEl.classList.remove('hidden');
      const spec = LEAFLET_TILE_STYLES[this.mapStyle] || LEAFLET_TILE_STYLES.esri_satellite;
      if (pill) pill.textContent = spec.label;

      if (!this.leafletMap) {
        this.leafletMap = L.map(lfEl, { zoomControl: true }).setView([active.lat, active.lng], 14);
        this.leafletOverlayGroup = L.layerGroup().addTo(this.leafletMap);
      } else {
        this.leafletMap.setView([active.lat, active.lng], 14);
      }
      if (this.leafletTileLayer) {
        this.leafletMap.removeLayer(this.leafletTileLayer);
      }
      this.leafletTileLayer = L.tileLayer(spec.url, spec.options).addTo(this.leafletMap);
      this.syncMarkers();
      this.applyOverlays();
      setTimeout(() => this.leafletMap?.invalidateSize(), 60);
    }
  }

  public setPerspective(persp: '2d' | 'iso' | 'street'): void {
    this.perspective = persp;
    if (!OPENFREEMAP_STYLES[this.mapStyle]) {
      this.mapStyle = 'fiord';
      const sel = document.getElementById('map-style-select') as HTMLSelectElement | null;
      if (sel) sel.value = 'fiord';
      this.initOrRefresh();
      return;
    }
    const pitch = persp === '2d' ? 0 : persp === 'street' ? 62 : 45;
    const bearing = persp === '2d' ? 0 : -16;
    this.map?.easeTo({ pitch, bearing, duration: 450 });
  }

  public flyToActive(): void {
    const props = this.cb.getProperties();
    const p = props[this.cb.getActiveIndex()] || props[0];
    if (!p) return;
    if (OPENFREEMAP_STYLES[this.mapStyle] && this.map) {
      this.map.flyTo({ center: [p.lng, p.lat], zoom: 13.8 });
    } else if (this.leafletMap) {
      this.leafletMap.flyTo([p.lat, p.lng], 14);
    }
  }

  public syncMarkers(): void {
    const props = this.cb.getProperties();
    const activeIdx = this.cb.getActiveIndex();
    const strat = this.cb.getStrategy();

    // MapLibre markers
    this.mapMarkers.forEach((m) => m.remove());
    this.mapMarkers = [];
    if (this.map) {
      props.forEach((p, idx) => {
        const uw = calcUnderwriting(p, strat);
        const el = document.createElement('div');
        el.className = `dusk-pin ${idx === activeIdx ? 'active' : ''}`;
        el.style.background = idx === activeIdx ? '#9ba8ff' : '#252938';
        el.style.color = idx === activeIdx ? '#161822' : '#f3f2ee';
        el.textContent = String(idx + 1);
        el.addEventListener('click', () => this.cb.onSelectProperty(idx));

        const popup = new maplibregl.Popup({ offset: 20 }).setHTML(
          `<div style="font-size:12px"><strong>${escHtml(p.address)}</strong><br/>Cap ${uw.capRate.toFixed(
            2
          )}% · DSCR ${uw.dscr.toFixed(2)}x · IRR ${uw.irr10Yr.toFixed(1)}%</div>`
        );
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([p.lng, p.lat])
          .setPopup(popup)
          .addTo(this.map!);
        this.mapMarkers.push(marker);
      });
    }

    // Leaflet markers
    this.leafletMarkers.forEach((m) => m.remove());
    this.leafletMarkers = [];
    if (this.leafletMap) {
      props.forEach((p, idx) => {
        const uw = calcUnderwriting(p, strat);
        const icon = L.divIcon({
          className: 'dusk-leaflet-icon',
          html: `<div class="dusk-pin ${idx === activeIdx ? 'active' : ''}" style="background:${
            idx === activeIdx ? '#9ba8ff' : '#252938'
          };color:${idx === activeIdx ? '#161822' : '#f3f2ee'}">${idx + 1}</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });
        const marker = L.marker([p.lat, p.lng], { icon })
          .bindPopup(
            `<div style="font-size:12px"><strong>${escHtml(p.address)}</strong><br/>Cap ${uw.capRate.toFixed(
              2
            )}% · DSCR ${uw.dscr.toFixed(2)}x</div>`
          )
          .on('click', () => this.cb.onSelectProperty(idx))
          .addTo(this.leafletMap!);
        this.leafletMarkers.push(marker);
      });
    }
  }

  public applyOverlays(): void {
    const props = this.cb.getProperties();
    const active = props[this.cb.getActiveIndex()] || props[0];
    if (!active) return;
    const audit = this.cb.getLocationAudit(active.id);

    // MapLibre rings + POIs
    if (this.map && this.map.isStyleLoaded()) {
      const ringFeatures = this.layers.rings
        ? [800, 1600, 3200].map((r) => ({
            type: 'Feature' as const,
            properties: { radius: r },
            geometry: {
              type: 'LineString' as const,
              coordinates: this.createCircleCoords(active.lng, active.lat, r),
            },
          }))
        : [];
      const ringGeo = { type: 'FeatureCollection' as const, features: ringFeatures };

      if (this.map.getSource('trade-rings')) {
        (this.map.getSource('trade-rings') as maplibregl.GeoJSONSource).setData(ringGeo);
      } else {
        this.map.addSource('trade-rings', { type: 'geojson', data: ringGeo });
        this.map.addLayer({
          id: 'trade-rings-line',
          type: 'line',
          source: 'trade-rings',
          paint: { 'line-color': '#e5b887', 'line-width': 1.5, 'line-dasharray': [4, 3], 'line-opacity': 0.72 },
        });
      }

      const visibleFeats = (audit?.features || []).filter(
        (f) => this.visibleAmenities[f.properties.category]
      );
      const poiGeo = { type: 'FeatureCollection' as const, features: visibleFeats };
      if (this.map.getSource('overpass-pois')) {
        (this.map.getSource('overpass-pois') as maplibregl.GeoJSONSource).setData(poiGeo);
      } else {
        this.map.addSource('overpass-pois', { type: 'geojson', data: poiGeo });
        this.map.addLayer({
          id: 'overpass-pois-pts',
          type: 'circle',
          source: 'overpass-pois',
          paint: {
            'circle-radius': 5.5,
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#181b26',
            'circle-color': [
              'match',
              ['get', 'category'],
              'schools',
              '#7da0ff',
              'transit',
              '#64d8b4',
              '#f2b872',
            ],
          },
        });
      }
    }

    // Leaflet overlays
    if (this.leafletMap && this.leafletOverlayGroup) {
      this.leafletOverlayGroup.clearLayers();
      if (this.layers.rings) {
        [800, 1600, 3200].forEach((r) => {
          L.circle([active.lat, active.lng], {
            radius: r,
            color: '#e5b887',
            weight: 1.4,
            dashArray: '5 4',
            fillOpacity: this.layers.heatmap ? 0.04 : 0,
          }).addTo(this.leafletOverlayGroup!);
        });
      }
      (audit?.features || [])
        .filter((f) => this.visibleAmenities[f.properties.category])
        .forEach((f) => {
          const [lng, lat] = f.geometry.coordinates;
          const color =
            f.properties.category === 'schools'
              ? '#7da0ff'
              : f.properties.category === 'transit'
                ? '#64d8b4'
                : '#f2b872';
          L.circleMarker([lat, lng], {
            radius: 5.5,
            color: '#181b26',
            weight: 1.5,
            fillColor: color,
            fillOpacity: 0.9,
          })
            .bindPopup(`${escHtml(f.properties.name)} (${f.properties.distanceMi} mi)`)
            .addTo(this.leafletOverlayGroup!);
        });
    }
  }

  public async geocodeAddress(
    query: string
  ): Promise<{ lat: number; lng: number; label: string; provider: string } | null> {
    const clean = query.trim();
    if (!clean) return null;

    // 1. Optional Google Maps Geocoding if BYOK key configured
    const gKey = this.cb.getGoogleMapsKey();
    if (gKey) {
      const gRes = await geocodeWithGoogleMaps(clean, gKey);
      if (gRes) {
        return { lat: gRes.lat, lng: gRes.lng, label: gRes.formattedAddress, provider: 'Google Maps' };
      }
    }

    // 2. Photon OSM
    try {
      const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(clean)}&limit=1`);
      if (r.ok) {
        const d = await r.json();
        const f = d?.features?.[0];
        if (f?.geometry?.coordinates) {
          const [lng, lat] = f.geometry.coordinates;
          const p = f.properties || {};
          const label = [p.name, p.street, p.city, p.state].filter(Boolean).join(', ') || clean;
          return { lat: Number(lat), lng: Number(lng), label, provider: 'Photon OSM' };
        }
      }
    } catch {
      // Fallback to Nominatim
    }

    // 3. Nominatim OSM
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(clean)}`
      );
      if (r.ok) {
        const d = await r.json();
        if (d?.[0]) {
          return {
            lat: Number(d[0].lat),
            lng: Number(d[0].lon),
            label: String(d[0].display_name || clean),
            provider: 'Nominatim OSM',
          };
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  public async scanOverpassPOIs(radiusMeters: number): Promise<LocationAudit | null> {
    const props = this.cb.getProperties();
    const p = props[this.cb.getActiveIndex()] || props[0];
    if (!p) return null;

    const dLat = radiusMeters / 111320;
    const dLng = radiusMeters / (111320 * Math.cos((p.lat * Math.PI) / 180));
    const q = `[out:json][timeout:10][bbox:${(p.lat - dLat).toFixed(5)},${(p.lng - dLng).toFixed(
      5
    )},${(p.lat + dLat).toFixed(5)},${(p.lng + dLng).toFixed(
      5
    )}];(nwr["amenity"="school"];node["highway"="bus_stop"];node["railway"="station"];nwr["shop"="supermarket"];node["amenity"="restaurant"];node["amenity"="cafe"];);out center 120;`;

    try {
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: `data=${encodeURIComponent(q)}`,
      });
      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
      const data = await res.json();
      const feats: AmenityFeature[] = (data.elements || [])
        .map((el: { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }, i: number) => {
          const fLat = el.lat ?? el.center?.lat;
          const fLng = el.lon ?? el.center?.lon;
          if (!fLat || !fLng) return null;
          const t = el.tags || {};
          const cat: 'schools' | 'transit' | 'retail' =
            t.amenity === 'school'
              ? 'schools'
              : t.highway === 'bus_stop' || t.railway
                ? 'transit'
                : 'retail';
          const dist = Math.hypot((fLat - p.lat) * 69, (fLng - p.lng) * 55);
          return {
            type: 'Feature' as const,
            properties: {
              id: i,
              name: t.name || cat,
              category: cat,
              subtype: t.amenity || t.shop || 'stop',
              distanceMi: Number(dist.toFixed(2)),
            },
            geometry: { type: 'Point' as const, coordinates: [fLng, fLat] as [number, number] },
          };
        })
        .filter((x: AmenityFeature | null): x is AmenityFeature => x !== null);

      const counts = {
        schools: feats.filter((x) => x.properties.category === 'schools').length,
        transit: feats.filter((x) => x.properties.category === 'transit').length,
        retail: feats.filter((x) => x.properties.category === 'retail').length,
      };
      const score = Math.min(100, counts.schools * 10 + counts.transit * 8 + counts.retail * 4);
      const audit: LocationAudit = {
        score,
        tier: score >= 70 ? 'Prime Walkable' : score >= 45 ? 'Strong Suburban' : 'Car-Dependent',
        counts,
        features: feats,
      };
      this.cb.setLocationAudit(p.id, audit);
      this.applyOverlays();
      return audit;
    } catch {
      return null;
    }
  }
}
