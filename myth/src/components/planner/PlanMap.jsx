// A small Leaflet map: the route, the places on the plan and (live) you.
// Leaflet loads on demand so the rest of the app never pays for it; if it
// fails to load, the map area just stays a quiet placeholder.
import { useEffect, useRef, useState } from 'react';
import { Text } from '@mantine/core';
import 'leaflet/dist/leaflet.css';

export default function PlanMap({ route, markers = [], pos = null, height = 260 }) {
  const el = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const [L, setL] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    import('leaflet').then((mod) => { if (alive) setL(mod.default ?? mod); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!L || !el.current || mapRef.current) return undefined;
    const map = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    return () => { map.remove(); mapRef.current = null; layerRef.current = null; };
  }, [L]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    const bounds = [];
    if (route?.geometry?.length) {
      const line = route.geometry.map((p) => [p.lat, p.lon]);
      L.polyline(line, { color: '#0f766e', weight: 4, opacity: 0.85 }).addTo(layer);
      bounds.push(...line);
    }
    markers.forEach((m) => {
      if (m.lat == null) return;
      L.circleMarker([m.lat, m.lon], { radius: m.radius ?? 6, color: '#fff', weight: 1.5, fillColor: m.color ?? '#12a150', fillOpacity: 0.95 })
        .bindTooltip(m.label ?? '', { direction: 'top', offset: [0, -6] })
        .addTo(layer);
      bounds.push([m.lat, m.lon]);
    });
    if (pos) {
      L.circleMarker([pos.lat, pos.lon], { radius: 9, color: '#fff', weight: 2, fillColor: '#e03131', fillOpacity: 1 }).bindTooltip('You', { permanent: true, direction: 'right', offset: [8, 0] }).addTo(layer);
      bounds.push([pos.lat, pos.lon]);
    }
    if (bounds.length > 1) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 13 });
    else if (bounds.length === 1) map.setView(bounds[0], 12);
    setTimeout(() => map.invalidateSize(), 50);
  }, [L, route, markers, pos]);

  return (
    <div className="pl-map" style={{ height }}>
      {failed ? <Text fz={12.5} c="dimmed" p="md">Map unavailable offline.</Text> : <div ref={el} style={{ height: '100%', width: '100%' }} />}
    </div>
  );
}
