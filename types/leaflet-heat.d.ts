declare module "leaflet.heat" {
  import * as L from "leaflet";

  interface HeatLayerOptions {
    radius?: number;
    blur?: number;
    maxZoom?: number;
    max?: number;
    minOpacity?: number;
    gradient?: { [key: number]: string };
  }

  function heatLayer(
    latlngs: [number, number, number][],
    options?: HeatLayerOptions,
  ): L.Layer;
}

declare namespace L {
  function heatLayer(
    latlngs: [number, number, number][],
    options?: any,
  ): L.Layer;
}
