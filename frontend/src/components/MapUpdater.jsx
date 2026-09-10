import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';

export function MapUpdater({ selectedLocation }) {
  const map = useMap();
  const lastTargetRef = useRef(null);

  useEffect(() => {
    if (!selectedLocation || !Number.isFinite(selectedLocation.lat) || !Number.isFinite(selectedLocation.lon)) {
      return;
    }

    const key = `${selectedLocation.lat.toFixed(5)},${selectedLocation.lon.toFixed(5)},${selectedLocation.triggerSource || 'search'}`;
    if (lastTargetRef.current === key) {
      return; // Avoid duplicate flyTo/panTo on re-renders
    }
    lastTargetRef.current = key;

    const targetCoords = [selectedLocation.lat, selectedLocation.lon];

    // Casual map click / marker click: preserve current zoom context, do NOT force zoom 12
    if (selectedLocation.triggerSource === 'map_click' || selectedLocation.triggerSource === 'marker_click') {
      if (typeof map.panTo === 'function') {
        map.panTo(targetCoords, { animate: true, duration: 0.5 });
      }
      return;
    }

    // Search or router navigation: flyTo target coordinates
    if (typeof map.flyTo === 'function') {
      const currentZoom = typeof map.getZoom === 'function' ? map.getZoom() : 6;
      const targetZoom = Math.max(currentZoom, 12);
      map.flyTo(targetCoords, targetZoom, {
        animate: true,
        duration: 1.2
      });
    }
  }, [selectedLocation, map]);

  return null;
}

