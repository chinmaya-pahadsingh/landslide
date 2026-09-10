import React, { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import { Plus, Minus, RotateCcw, Layers } from 'lucide-react';
import './MapFloatingControls.css';

const MAP_CENTER = [26.20, 92.93];
const DEFAULT_ZOOM = 6;

export function MapFloatingControls({ onReset, onToggleBasemap, activeBasemap }) {
  const map = useMap();
  const controlsRef = useRef(null);

  useEffect(() => {
    const el = controlsRef.current;
    if (!el) return;

    // Use Leaflet's built-in DomEvent isolation
    try {
      import('leaflet').then((L) => {
        const leaflet = L.default || L;
        if (leaflet?.DomEvent) {
          leaflet.DomEvent.disableClickPropagation(el);
          leaflet.DomEvent.disableScrollPropagation(el);
        }
      }).catch(() => {});
    } catch {}

    if (typeof window !== 'undefined' && window.L?.DomEvent) {
      try {
        window.L.DomEvent.disableClickPropagation(el);
        window.L.DomEvent.disableScrollPropagation(el);
      } catch {}
    }
  }, []);

  const handleZoomIn = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.nativeEvent) {
      e.nativeEvent.stopImmediatePropagation?.();
      e.nativeEvent.stopPropagation?.();
    }
    if (typeof map.zoomIn === 'function') {
      map.zoomIn();
    }
  };

  const handleZoomOut = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.nativeEvent) {
      e.nativeEvent.stopImmediatePropagation?.();
      e.nativeEvent.stopPropagation?.();
    }
    if (typeof map.zoomOut === 'function') {
      map.zoomOut();
    }
  };

  const handleRecenter = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.nativeEvent) {
      e.nativeEvent.stopImmediatePropagation?.();
      e.nativeEvent.stopPropagation?.();
    }
    if (typeof map.flyTo === 'function') {
      map.flyTo(MAP_CENTER, DEFAULT_ZOOM, {
        animate: true,
        duration: 1.0
      });
    }
    if (onReset) {
      onReset();
    }
  };

  const handleToggle = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.nativeEvent) {
      e.nativeEvent.stopImmediatePropagation?.();
      e.nativeEvent.stopPropagation?.();
    }
    if (onToggleBasemap) {
      onToggleBasemap();
    }
  };

  return (
    <div 
      ref={controlsRef}
      className="map-floating-controls"
      role="toolbar" 
      aria-label="Map navigation controls"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button 
        type="button" 
        className="map-control-btn" 
        onClick={handleZoomIn} 
        aria-label="Zoom in"
        title="Zoom in (+)"
      >
        <Plus size={16} />
      </button>

      <button 
        type="button" 
        className="map-control-btn" 
        onClick={handleZoomOut} 
        aria-label="Zoom out"
        title="Zoom out (-)"
      >
        <Minus size={16} />
      </button>

      <div className="map-control-divider" />

      <button 
        type="button" 
        className="map-control-btn" 
        onClick={handleRecenter} 
        aria-label="Reset map view"
        title="Recenter to regional extent"
      >
        <RotateCcw size={15} />
      </button>

      {onToggleBasemap && (
        <button 
          type="button" 
          className={`map-control-btn ${activeBasemap === 'satellite' ? 'active' : ''}`} 
          onClick={handleToggle} 
          aria-label="Toggle map layer"
          title={activeBasemap === 'satellite' ? 'Active: Satellite Imagery (Click for OpenStreetMap)' : 'Active: OpenStreetMap Standard (Click for Satellite Imagery)'}
        >
          <Layers size={15} />
        </button>
      )}
    </div>
  );
}
