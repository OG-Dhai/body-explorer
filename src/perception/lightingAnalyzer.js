export class LightingAnalyzer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 64;
    this.canvas.height = 48; // Downscaled for fast pixel processing
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  /**
   * Analyzes an ImageBitmap to determine lighting quality.
   * @param {ImageBitmap} bitmap
   * @returns {{ isTooDark: boolean, brightness: number }}
   */
  analyze(bitmap) {
    if (!bitmap) return { isTooDark: false, brightness: 100 };
    
    this.ctx.drawImage(bitmap, 0, 0, this.canvas.width, this.canvas.height);
    const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    const data = imageData.data;
    
    let totalBrightness = 0;
    const pixelCount = this.canvas.width * this.canvas.height;
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      // Fast perceived brightness (luminance approximation)
      const luminance = (r + r + b + g + g + g) / 6;
      totalBrightness += luminance;
    }
    
    const avgBrightness = totalBrightness / pixelCount;
    
    // Threshold: if average brightness is under 40 (out of 255), it's very dark.
    return {
      isTooDark: avgBrightness < 40,
      brightness: avgBrightness
    };
  }
}
