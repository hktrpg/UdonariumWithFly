/** True when the browser can create a WebGL2 context (required by three.js r163+). */
export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const attrs = {
      failIfMajorPerformanceCaveat: false,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
      powerPreference: 'high-performance' as WebGLPowerPreference,
    };
    const gl = canvas.getContext('webgl2', attrs) as WebGL2RenderingContext | null;
    if (!gl) return false;
    const lose = gl.getExtension('WEBGL_lose_context');
    lose?.loseContext();
    return true;
  } catch {
    return false;
  }
}
