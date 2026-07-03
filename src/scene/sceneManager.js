import * as THREE from 'three';
import eventBus from '../core/eventBus.js';

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

    // Create scene
    this._scene = new THREE.Scene();
    
    // Create camera
    const width = this._container.clientWidth || 800;
    const height = this._container.clientHeight || 600;
    this._camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 10);
    this._camera.position.set(0, 0, 2.5);

    // Create renderer
    this._renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this._renderer.setClearColor(0x000000, 0); // Fully transparent
    this._renderer.setSize(width, height);
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._container.appendChild(this._renderer.domElement);

    // Setup lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this._scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(0, 5, 5);
    this._scene.add(dirLight);

    // Materials - using Toon for child-friendly look
    this._defaultMaterial = new THREE.MeshToonMaterial({ color: 0xFF6B9D }); // Warm coral
    this._handMaterial = new THREE.MeshToonMaterial({ color: 0xFFD93D }); // Bright yellow
    this._targetMaterial = new THREE.MeshToonMaterial({ color: 0xFF5722 }); // Red-orange

    // Spheres for joints
    this._baseRadius = 0.035;
    this._sphereGeometry = new THREE.SphereGeometry(this._baseRadius, 16, 16);
    this._targetGeometry = new THREE.SphereGeometry(this._baseRadius * 2, 16, 16);

    this._spheres = [];
    for (let i = 0; i < 33; i++) {
      const mesh = new THREE.Mesh(this._sphereGeometry, this._defaultMaterial);
      mesh.visible = false;
      this._scene.add(mesh);
      this._spheres.push(mesh);
    }

    // Lines for bones
    const points = [];
    for (let i = 0; i < BONE_CONNECTIONS.length * 2; i++) {
      points.push(new THREE.Vector3());
    }
    this._lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
    this._lineMaterial = new THREE.LineBasicMaterial({ color: 0x887799, linewidth: 3 }); // Soft warm gray
    this._skeletonLines = new THREE.LineSegments(this._lineGeometry, this._lineMaterial);
    this._scene.add(this._skeletonLines);

    // Hold progress ring
    this._ringMaterial = new THREE.MeshBasicMaterial({ 
      color: 0x4CAF50, 
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

    // Color definitions for lerping
    this._colorCold = new THREE.Color(0xFF5722); // Red-orange
    this._colorHot = new THREE.Color(0x4CAF50);  // Bright green

    // Game state
    this._targetJoints = [];
    this._holdProgress = 0;

    // Resize listener
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
    eventBus.on('game:newQuestion', ({ question }) => {
      this._targetJoints = question.indices;
      this._holdProgress = 0;
    });

    eventBus.on('detection:progress', ({ progress }) => {
      this._holdProgress = progress;
    });

    eventBus.on('game:stateChange', ({ state }) => {
      if (state === 'idle') {
        this._targetJoints = [];
        this._holdProgress = 0;
      }
    });
    
    eventBus.on('game:complete', () => {
        this._targetJoints = [];
        this._holdProgress = 0;
    });
  }

  /**
   * @param {Array} worldLandmarks
   * @param {number|null} currentDistance
   * @param {number} [dynamicThreshold=0.5] — adaptive hitbox size for visual normalization
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
    const targetCenters = [];

    for (let i = 0; i < 33; i++) {
      const sphere = this._spheres[i];
      const lm = worldLandmarks[i];
      
      if (lm) {
        sphere.position.set(-lm.x, -lm.y, lm.z);
        sphere.visible = true;

        sphere.scale.set(1, 1, 1);
        sphere.geometry = this._sphereGeometry;

        if (this._targetJoints.includes(i)) {
          sphere.material = this._targetMaterial;
          sphere.geometry = this._targetGeometry;
          sphere.scale.set(pulseScale, pulseScale, pulseScale);
          targetCenters.push(sphere.position.clone());
        } else if (HAND_JOINTS.includes(i)) {
          sphere.material = this._handMaterial;
        } else {
          sphere.material = this._defaultMaterial;
        }
      } else {
        sphere.visible = false;
      }
    }
    
    // Update rings based on hold progress
    for (let i = 0; i < this._rings.length; i++) {
      const ring = this._rings[i];
      if (this._holdProgress > 0.01 && i < targetCenters.length) {
        ring.visible = true;
        ring.position.copy(targetCenters[i]);
        // Face the camera
        ring.quaternion.copy(this._camera.quaternion);
        // Animate geometry based on progress
        ring.geometry.dispose();
        ring.geometry = new THREE.RingGeometry(0.1, 0.12, 32, 1, 0, Math.PI * 2 * this._holdProgress);
      } else {
        ring.visible = false;
      }
    }

    // Update lines
    const positions = this._lineGeometry.attributes.position.array;
    let index = 0;
    for (const [a, b] of BONE_CONNECTIONS) {
      const pA = worldLandmarks[a];
      const pB = worldLandmarks[b];

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
    this._sphereGeometry.dispose();
    this._targetGeometry.dispose();
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
