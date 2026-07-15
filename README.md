# Body Explorer 3D

An interactive, educational computer-vision game designed to help children learn body awareness in a fun, gamified way.

## Features
- **Offline-First PWA**: Can be played entirely offline with no cloud dependencies once installed.
- **Privacy-First Tracking**: Uses local WebAssembly (MediaPipe) for pose tracking. No camera data ever leaves the device.
- **60 FPS Rendering**: Highly optimized Three.js rendering overlay.
- **Bilingual**: Supports English and German, complete with localized voice-overs.
- **Dynamic Difficulty**: Adjusts hitboxes based on the child's body size and dynamically filters occluded targets (e.g. feet out of frame).

## Installation & Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Run Development Server:**
   ```bash
   npm run dev
   ```

3. **Build for Production:**
   ```bash
   npm run build
   ```

4. **Preview Production Build:**
   ```bash
   npm run preview
   ```

## Development & Debugging

**Debug Mode:**
Add `?debug=true` to the URL (e.g., `http://localhost:5173/?debug=true`).
This enables:
- A live FPS and frame-drop tracker in the top-left corner.
- A floating debug panel to manually skip levels, trigger states, or bypass gameplay phases.

## Testing

- **Unit Tests:** Run `npm run test:unit` to test core engine logic (spatial math, scoring, hold detection).
- **E2E Tests:** Run `npm run test:e2e` for a headless Puppeteer verification test (requires a running dev server).

## Known Limitations
- **Lighting Requirements:** The app requires a decently lit room. Backlighting or extreme darkness will heavily degrade pose tracking. A built-in lighting analyzer will warn users if lighting is poor.
- **Camera Visibility:** The child needs to be reasonably far back so the camera can see their upper body or full body. Targets not visible will be skipped.
- **Mobile Browsers:** Service Workers and WASM binaries require modern browsers. iOS Safari may require specific settings for WebGL and Camera permissions.
