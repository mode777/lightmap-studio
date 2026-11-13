/**
 * Viewport: three.js renderer, orbit controls, viewport-only lighting, and
 * the albedo/AO display modes. The lights live in the viewport scene, not on
 * the document root, so exports never pick them up.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { bakedMaterialsOf } from "./lightmap.ts";

export type DisplayMode = "albedo" | "ao";

export class Viewport {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private documentRoot: THREE.Object3D | null = null;
  private frameHandle = 0;
  private readonly resizeObserver: ResizeObserver;
  private displayMode: DisplayMode = "albedo";

  constructor(private readonly host: HTMLElement) {
    const canvas = document.createElement("canvas");
    canvas.className = "viewport-canvas";
    host.appendChild(canvas);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setClearColor(0x1e1e1e);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 500);
    this.camera.position.set(3, 2.5, 4);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;

    // Viewport-only illumination for the albedo view.
    const hemisphere = new THREE.HemisphereLight(0xffffff, 0x404040, 1.4);
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(4, 6, 3);
    this.scene.add(hemisphere, key);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.scheduleFrame();
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  setScene(root: THREE.Object3D | null): void {
    if (this.documentRoot) {
      this.scene.remove(this.documentRoot);
      disposeObject(this.documentRoot);
    }
    this.documentRoot = root;
    if (root) this.scene.add(root);
    this.applyDisplayMode();
    if (root) this.frameScene();
  }

  setDisplayMode(mode: DisplayMode): void {
    this.displayMode = mode;
    this.applyDisplayMode();
  }

  private applyDisplayMode(): void {
    if (!this.documentRoot) return;
    this.documentRoot.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const set = bakedMaterialsOf(object);
      if (!set) return;
      object.material = this.displayMode === "ao" ? set.aoView : set.albedo;
    });
  }

  /** Fit the camera to the document's bounding sphere. */
  frameScene(): void {
    if (!this.documentRoot) return;
    const box = new THREE.Box3().setFromObject(this.documentRoot);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const distance = sphere.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const direction = new THREE.Vector3(0.7, 0.5, 1).normalize();
    this.camera.position.copy(sphere.center).addScaledVector(direction, distance);
    this.camera.near = Math.max(sphere.radius / 500, 0.01);
    this.camera.far = distance * 10;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(sphere.center);
    this.controls.update();
  }

  private resize(): void {
    const width = this.host.clientWidth || 1;
    const height = this.host.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private scheduleFrame(): void {
    this.frameHandle = requestAnimationFrame(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.scheduleFrame();
    });
  }

  dispose(): void {
    cancelAnimationFrame(this.frameHandle);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.setScene(null);
    this.renderer.dispose();
    this.canvas.remove();
    void this.host;
  }
}

function disposeObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  const collect = (material: THREE.Material): void => {
    materials.add(material);
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) textures.add(value);
    }
  };

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    const set = bakedMaterialsOf(object);
    if (set) {
      for (const material of Array.isArray(set.albedo) ? set.albedo : [set.albedo]) {
        collect(material);
      }
      for (const material of Array.isArray(set.ao) ? set.ao : [set.ao]) {
        collect(material);
      }
      for (const material of Array.isArray(set.aoView) ? set.aoView : [set.aoView]) {
        collect(material);
      }
    }
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      collect(material);
    }
  });

  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}
