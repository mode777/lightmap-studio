import { createStudio, decodeHdr, QUALITY_PRESETS } from "../../dist/index.js";

const surface = {
  createStudio,
  decodeHdr,
  preset: QUALITY_PRESETS.preview.atlasSize
};
document.body.textContent = JSON.stringify(surface);
