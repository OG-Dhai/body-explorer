import * as THREE from 'three';
import eventBus from '../core/eventBus.js';
import { PALETTE, toThreeColor } from '../core/palette.js';

const THREE_COLORS = Object.freeze({
  airySky: toThreeColor(PALETTE.airySky),
  explorerNavy: toThreeColor(PALETTE.explorerNavy),
  adventureGreen: toThreeColor(PALETTE.adventureGreen),
  sunnyApricot: toThreeColor(PALETTE.sunnyApricot),
  friendlyCoral: toThreeColor(PALETTE.friendlyCoral),
});

const BONE_CONNECTIONS = [
  // Torso
  [11, 12], [12, 24], [24, 23], [23, 11],
  // Left arm
  [11, 13], [13, 15],
  // Right arm
  [12, 14], [14, 16],
  // Left leg
  [23, 25], [25, 27],
  // Right leg
  [24, 26], [26, 28],
  // Hands detail
  [15, 17], [17, 19], [19, 21], [15, 21],
  [16, 18], [18, 20], [20, 22], [16, 22],
  // Feet detail
  [27, 29], [29, 31], [27, 31],
  [28, 30], [30, 32], [28, 32]
];

const HAND_JOINTS = [15, 16, 19, 20];

export class SceneManager {
  /** @param {HTMLElement} container */
  constructor(container) {
    this._container = container;

    this._scene = new THREE.Scene();
    
    const width = this._container.clientWidth || 800;
    const height = this._container.clientHeight || 600;
    this._camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 10);
    this._camera.position.set(0, 0, 2.5);

    this._renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this._renderer.setClearColor(THREE_COLORS.airySky, 0); // Fully transparent
    this._renderer.setSize(width, height);
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._container.appendChild(this._renderer.domElement);

    const ambientLight = new THREE.AmbientLight(THREE_COLORS.airySky, 0.6);
    this._scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(THREE_COLORS.airySky, 0.8);
    dirLight.position.set(0, 5, 5);
    this._scene.add(dirLight);

    // Materials - using Toon for child-friendly look
    this._defaultMaterial = new THREE.MeshToonMaterial({ color: THREE_COLORS.friendlyCoral });
    this._handMaterial = new THREE.MeshToonMaterial({ color: THREE_COLORS.sunnyApricot });
    this._targetMaterial = new THREE.MeshToonMaterial({ color: THREE_COLORS.friendlyCoral });

    this._baseRadius = 0.035;
    this._sphereGeometry = new THREE.SphereGeometry(this._baseRadius, 16, 16);

    this._spheres = [];
    for (let i = 0; i < 33; i++) {
      const mesh = new THREE.Mesh(this._sphereGeometry, this._defaultMaterial);
      mesh.visible = false;
      this._scene.add(mesh);
      this._spheres.push(mesh);
    }

    const points = [];
    for (let i = 0; i < BONE_CONNECTIONS.length * 2; i++) {
      points.push(new THREE.Vector3());
    }
    this._lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
    this._lineMaterial = new THREE.LineBasicMaterial({ color: THREE_COLORS.explorerNavy, linewidth: 3 });
    this._skeletonLines = new THREE.LineSegments(this._lineGeometry, this._lineMaterial);
    this._scene.add(this._skeletonLines);

    this._ringMaterial = new THREE.MeshBasicMaterial({ 
      color: THREE_COLORS.adventureGreen,
      side: THREE.DoubleSide, 
      transparent: true,
      opacity: 0.8 
    });
    // Create multiple rings in case target is multiple joints (like head = 0,7,8)
    this._rings = [];
    for(let i=0; i<3; i++) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.12, 32), this._ringMaterial);
      ring.visible = false;
      this._scene.add(ring);
      this._rings.push(ring);
    }

    this._colorCold = new THREE.Color(THREE_COLORS.friendlyCoral);
    this._colorHot = new THREE.Color(THREE_COLORS.adventureGreen);

    this._targetJoints = [];
    this._holdProgress = 0;
    this._targetCenters = [];

    this._resizeHandler = () => {
      const w = this._container.clientWidth;
      const h = this._container.clientHeight;
      this._renderer.setSize(w, h);
      this._camera.aspect = w / h;
      this._camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', this._resizeHandler);
    this._resizeHandler();

    this._bindEvents();
  }

  _bindEvents() {
    this._onGameNewQuestion = ({ question }) => {
      this._targetJoints = question.indices;
      this._holdProgress = 0;
    };

    this._onDetectionProgress = ({ progress }) => {
      this._holdProgress = progress;
    };

    this._onGameStateChange = ({ state }) => {
      if (state === 'idle') {
        this._targetJoints = [];
        this._holdProgress = 0;
      }
    };
    
    this._onGameComplete = () => {
      this._targetJoints = [];
      this._holdProgress = 0;
    };

    eventBus.on('game:newQuestion', this._onGameNewQuestion);
    eventBus.on('detection:progress', this._onDetectionProgress);
    eventBus.on('game:stateChange', this._onGameStateChange);
    eventBus.on('game:complete', this._onGameComplete);
  }

  /**
   * @param {Array} worldLandmarks
   * @param {number|null} currentDistance
   * @param {number} [dynamicThreshold=0.5]: adaptive hitbox size for visual normalization
   */
  update(worldLandmarks, currentDistance, dynamicThreshold) {
    if (!worldLandmarks || worldLandmarks.length < 33) {
      for (const sphere of this._spheres) sphere.visible = false;
      for (const ring of this._rings) ring.visible = false;
      this._skeletonLines.visible = false;
      this._renderer.render(this._scene, this._camera);
      return;
    }

    this._skeletonLines.visible = true;

    // Hot/cold normalized against the dynamic threshold
    const maxVisualDist = dynamicThreshold || 0.5;
    let t = 0;
    let pulseScale = 1;
    
    if (currentDistance !== null && currentDistance !== undefined) {
      t = Math.max(0, Math.min(1, 1 - (currentDistance / maxVisualDist)));
      const pulseAmplitude = t * 0.3; 
      pulseScale = 1 + Math.sin(Date.now() * 0.01) * pulseAmplitude;
    }

    this._targetMaterial.color.lerpColors(this._colorCold, this._colorHot, t);

    // Track active target centers for ring placement
    this._targetCenters.length = 0;

    for (let i = 0; i < 33; i++) {
      const sphere = this._spheres[i];
      const lm = worldLandmarks[i];
      
      if (lm) {
        sphere.position.set(-lm.x, -lm.y, lm.z);
        sphere.visible = true;

        if (this._targetJoints.includes(i)) {
          sphere.material = this._targetMaterial;
          sphere.scale.set(2 * pulseScale, 2 * pulseScale, 2 * pulseScale);
          this._targetCenters.push(sphere.position);
        } else if (HAND_JOINTS.includes(i)) {
          sphere.material = this._handMaterial;
          sphere.scale.set(1, 1, 1);
        } else {
          sphere.material = this._defaultMaterial;
          sphere.scale.set(1, 1, 1);
        }
      } else {
        sphere.visible = false;
      }
    }
    
    for (let i = 0; i < this._rings.length; i++) {
      const ring = this._rings[i];
      if (this._holdProgress > 0.01 && i < this._targetCenters.length) {
        ring.visible = true;
        ring.position.copy(this._targetCenters[i]);
        ring.quaternion.copy(this._camera.quaternion);
        // Animate draw range to fill the arc (0 to 32 segments, 6 indices per segment)
        const segmentsToDraw = Math.max(1, Math.floor(this._holdProgress * 32));
        ring.geometry.setDrawRange(0, segmentsToDraw * 6);
      } else {
        ring.visible = false;
      }
    }

    const positions = this._lineGeometry.attributes.position.array;
    let index = 0;
    for (let i = 0; i < BONE_CONNECTIONS.length; i++) {
      const conn = BONE_CONNECTIONS[i];
      const pA = worldLandmarks[conn[0]];
      const pB = worldLandmarks[conn[1]];

      if (pA && pB) {
        positions[index++] = -pA.x;
        positions[index++] = -pA.y;
        positions[index++] = pA.z;

        positions[index++] = -pB.x;
        positions[index++] = -pB.y;
        positions[index++] = pB.z;
      } else {
        positions[index++] = 0; positions[index++] = 0; positions[index++] = 0;
        positions[index++] = 0; positions[index++] = 0; positions[index++] = 0;
      }
    }
    this._lineGeometry.attributes.position.needsUpdate = true;

    this._renderer.render(this._scene, this._camera);
  }

  dispose() {
    window.removeEventListener('resize', this._resizeHandler);
    eventBus.off('game:newQuestion', this._onGameNewQuestion);
    eventBus.off('detection:progress', this._onDetectionProgress);
    eventBus.off('game:stateChange', this._onGameStateChange);
    eventBus.off('game:complete', this._onGameComplete);
    this._sphereGeometry.dispose();
    this._lineGeometry.dispose();
    this._defaultMaterial.dispose();
    this._handMaterial.dispose();
    this._targetMaterial.dispose();
    this._lineMaterial.dispose();
    this._ringMaterial.dispose();
    
    this._scene.remove(this._skeletonLines);
    for (const sphere of this._spheres) this._scene.remove(sphere);
    for (const ring of this._rings) this._scene.remove(ring);

    this._renderer.dispose();
    if (this._renderer.domElement.parentNode) {
      this._renderer.domElement.parentNode.removeChild(this._renderer.domElement);
    }
  }
}
