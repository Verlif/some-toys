/**
 * English (en-US) language pack
 */
window.App = window.App || {};
window.App.locales = window.App.locales || {};

window.App.locales['en-US'] = {
  meta: {
    name: 'English'
  },
  app: {
    title: 'Image Theme Color Replacer',
    subtitle: 'Extract · Recolor · Click to locate'
  },
  action: {
    pixelPreview: 'Pixel preview',
    pixelPreviewTip: 'Keep hard pixel edges when zoomed in, without smoothing',
    reupload: 'Change image',
    download: 'Download',
    fitWindow: 'Fit window',
    resetView: 'Reset view',
    resetAll: 'Reset all'
  },
  theme: {
    toggleToLight: 'Switch to light theme',
    toggleToDark: 'Switch to dark theme'
  },
  lang: {
    label: 'Language'
  },
  pane: {
    source: 'Original',
    preview: 'Preview',
    colors: 'Dominant colors'
  },
  zoomHint: 'Wheel to zoom · Drag to pan · Click to locate · Double-click to reset',
  tolerance: {
    label: 'Tolerance',
    value: '{{value}} <span class="den">/ 255</span>',
    tip: 'Measured as <b>per-channel RGB difference</b>, range 0 – 255. 0 = exact match only; higher values recolor more similar colors. The color list updates when you release the mouse.'
  },
  merge: {
    label: 'Merge similar colors',
    sub: 'Treat dominant colors within tolerance as one group'
  },
  color: {
    merged: '{{count}} merged',
    groups: '{{count}} groups',
    colors: '{{count}} colors',
    restore: 'Restore original color',
    exclude: 'Exclude this color'
  },
  footer: {
    elapsed: 'Time'
  },
  upload: {
    title: 'Click to upload an image',
    hint: 'Or drop an image here · Ctrl/⌘ + V to paste'
  },
  error: {
    loadFailed: 'Failed to read the image. Please try another one.'
  },
  download: {
    filename: 'recolored-{{width}}x{{height}}.png'
  }
};
