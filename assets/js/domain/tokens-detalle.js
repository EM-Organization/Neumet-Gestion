// Medidas del «Detalle de vehículo» (docs/22, neumet-web-tokens.json). Los colores NO van aquí: viven en las variables CSS
// `--est-*` de assets/css/tokens.css, para que el SVG y el HTML los tomen de un solo lugar. Solo dominio: sin DOM.
export const TOKENS = Object.freeze({
  tireNode: Object.freeze({ strokePx: 2, selectedStrokePx: 3, focusOutlinePx: 3, focusOutlineOffsetPx: 2, dimOpacity: 0.35 }),
  flag: Object.freeze({ badgeDiameterPx: 16, ringPx: 2, overlapIntoTirePx: 4 }),
  chip: Object.freeze({ height: 32, radius: 16, paddingX: 12, gap: 6, gapBetweenChips: 8, borderPx: 1.5, tagHeight: 28 }),
  chart: Object.freeze({
    heightPx: 220, yTickStepMm: 4, headroomAboveBuenMm: 4, plotInsetXPx: 24, bandLabelMinHeightPx: 20, bandLabelInsetPx: 8,
    linePx: 2, pointRadiusPx: 5, lastPointRadiusPx: 6, pointRingPx: 2,
  }),
  // TODO(neumet-web: TODO-BREAKPOINTS): ancho a partir del cual la pantalla pasa a una columna (el CSS usa este mismo valor).
  layout: Object.freeze({ stickyTopOffsetPx: 16, singleColumnBelowPx: 1024 }),
});
