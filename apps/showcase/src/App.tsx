import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent
} from "react";
import * as THREE from "three";
import {
  ResizablePane,
  Sidebar,
  StatusBar,
  TitleBar,
  WorkbenchShell
} from "vscode-workbench/react";
import {
  ATLAS_PADDING_OPTIONS,
  ATLAS_SIZES,
  BOUNCE_OPTIONS,
  bakeAmbientOcclusion,
  checkBakeCapabilities,
  errorMessage,
  QUALITY_PRESETS
} from "./lib/baker.ts";
import type { QualityPreset } from "lightmap-studio";
import { buildFileTree, classifyFileName, type DroppedFile, type TreeDocument } from "./lib/drop.ts";
import { filesFromDataTransfer } from "./lib/dropDom.ts";
import { downloadResult, exportDocument } from "./lib/exporter.ts";
import { extractMeshInputs } from "./lib/extract.ts";
import { parseDocument } from "./lib/gltf.ts";
import { applyBakeResult, bakedMaterialsOf, type AppliedBake } from "./lib/lightmap.ts";
import { buildSampleGlbFile } from "./lib/sample.ts";
import { Viewport, type DisplayMode } from "./lib/viewport.ts";
import { installTestHook, type ShowcaseHookState, type ExportOutcome } from "./lib/testHook.ts";
import type { ActiveDocument } from "./lib/appState.ts";
import { AtlasInspector } from "./AtlasInspector.tsx";

type BakeStatus = "idle" | "running" | "done" | "failed";
type StageTab = "viewport" | "atlas";

const DISPLAY_MODES: ReadonlyArray<{
  id: DisplayMode;
  label: string;
  description: string;
}> = [
  { id: "albedo", label: "Albedo", description: "Show the original albedo material only" },
  { id: "ao", label: "AO", description: "Show the baked ambient occlusion only" },
  { id: "both", label: "Both", description: "Show albedo multiplied by baked ambient occlusion" }
];

interface TextureStats {
  min: number;
  max: number;
  mean: number;
}

export function App() {
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [bakePanelWidth, setBakePanelWidth] = useState(280);
  const [droppedCount, setDroppedCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [messages, setMessages] = useState<string[]>([]);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [bakeStatus, setBakeStatus] = useState<BakeStatus>("idle");
  const [bakeMessage, setBakeMessage] = useState<string | null>(null);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("both");
  const [atlasSize, setAtlasSize] = useState(1024);
  const [padding, setPadding] = useState(8);
  const [quality, setQuality] = useState<(typeof QUALITY_PRESETS)[number]>("preview");
  const [bounces, setBounces] = useState(1);
  const [stageTab, setStageTab] = useState<StageTab>("viewport");
  // React copy of the applied bake for the atlas tab; the ref stays the
  // synchronous source for the test hook and export.
  const [appliedBake, setAppliedBake] = useState<AppliedBake | null>(null);

  // Synchronous mirrors: the test hook and the bake/export flows read these
  // directly, so they never depend on a React render having happened.
  const droppedFilesRef = useRef<DroppedFile[]>([]);
  const activeRef = useRef<ActiveDocument | null>(null);
  const bakeStatusRef = useRef<BakeStatus>("idle");
  const displayModeRef = useRef<DisplayMode>("both");
  const appliedRef = useRef<AppliedBake | null>(null);
  const messagesRef = useRef<string[]>([]);
  const bakingRef = useRef(false);
  const busyRef = useRef(false);
  const settingsRef = useRef<{
    atlasSize: number;
    quality: QualityPreset;
    padding: number;
    bounces: number;
  }>({
    atlasSize: 1024,
    quality: "preview",
    padding: 8,
    bounces: 1
  });

  const viewportHostRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const documentTree = useMemo(
    () => buildFileTree(droppedFilesRef.current.length > 0 || droppedCount > 0 ? droppedFilesRef.current : []),
    // Rebuild when ingestion changes the drop set.
    [droppedCount]
  );

  const pushMessage = useCallback((message: string) => {
    messagesRef.current = [...messagesRef.current.slice(-19), message];
    setMessages(messagesRef.current);
  }, []);

  const setStatus = useCallback((status: BakeStatus) => {
    bakeStatusRef.current = status;
    setBakeStatus(status);
  }, []);

  const changeDisplayMode = useCallback((mode: DisplayMode) => {
    displayModeRef.current = mode;
    setDisplayMode(mode);
    viewportRef.current?.setDisplayMode(mode);
  }, []);

  const applyAtlasSize = useCallback((size: number) => {
    settingsRef.current.atlasSize = size;
    setAtlasSize(size);
  }, []);

  const applyQuality = useCallback((preset: QualityPreset) => {
    settingsRef.current.quality = preset;
    setQuality(preset);
  }, []);

  const applyPadding = useCallback((value: number) => {
    settingsRef.current.padding = value;
    setPadding(value);
  }, []);

  const applyBounces = useCallback((count: number) => {
    settingsRef.current.bounces = count;
    setBounces(count);
  }, []);

  // Settings + display dropdowns: vscode-single-select dispatches a plain
  // (non-bubbling) change event, so listen in the capture phase and route by
  // the data-form-control marker.
  useEffect(() => {
    const onChange = (event: Event): void => {
      const target = event.target as (HTMLElement & { value?: string }) | null;
      const kind = target?.dataset?.formControl;
      if (!kind) return;
      const value = target?.value ?? "";
      if (kind === "atlas") applyAtlasSize(Number(value));
      else if (kind === "padding") applyPadding(Number(value));
      else if (kind === "quality") applyQuality(value as QualityPreset);
      else if (kind === "bounces") applyBounces(Number(value));
    };
    document.addEventListener("change", onChange, true);
    return () => document.removeEventListener("change", onChange, true);
  }, [applyAtlasSize, applyBounces, applyPadding, applyQuality]);

  // Viewport lifecycle.
  useEffect(() => {
    const host = viewportHostRef.current;
    if (!host) return;
    const viewport = new Viewport(host);
    viewportRef.current = viewport;
    return () => {
      viewport.dispose();
      viewportRef.current = null;
    };
  }, []);

  const noteSkipped = useCallback(
    (skipped: Array<{ path: string; reason: string }>) => {
      if (skipped.length === 0) return;
      setSkippedCount((count) => count + skipped.length);
      for (const entry of skipped) pushMessage(`Skipped ${entry.path}: ${entry.reason}`);
    },
    [pushMessage]
  );

  const activateDocument = useCallback(
    async (document: TreeDocument) => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const parsed = await parseDocument(document, droppedFilesRef.current);
        const entries = extractMeshInputs(parsed.scene);
        const triangleCount = entries.reduce(
          (sum, entry) => sum + entry.input.indices.length / 3,
          0
        );
        const loaded: ActiveDocument = {
          sourceName: document.name,
          sourcePath: document.path,
          root: parsed.scene,
          entries,
          triangleCount
        };
        const previous = activeRef.current;
        appliedRef.current = null;
        bakingRef.current = false;
        activeRef.current = loaded;
        setAppliedBake(null);
        setStageTab("viewport");
        setStatus("idle");
        setBakeMessage(null);
        setProgressLabel(null);
        changeDisplayMode("both");
        viewportRef.current?.setScene(parsed.scene);
        // The viewport disposes the active geometry/material graph; source
        // geometries kept on the old entries for re-bakes need their own pass.
        if (previous) {
          const geometries = new Set(
            previous.entries.map((entry) => entry.geometry)
          );
          for (const geometry of geometries) geometry.dispose();
        }
        setActiveName(document.name);
        setActivePath(document.path);
      } catch (error) {
        const message = errorMessage(error);
        pushMessage(`Failed to load ${document.name}: ${message}`);
        setBakeMessage(message);
        setStatus("failed");
      } finally {
        busyRef.current = false;
      }
    },
    [changeDisplayMode, pushMessage, setStatus]
  );

  const ingestFiles = useCallback(
    async (incoming: DroppedFile[]): Promise<{ documents: string[]; skipped: string[] }> => {
      const recognized = incoming.filter(
        (entry) => classifyFileName(entry.file.name) !== "unsupported"
      );
      const skippedPaths = incoming
        .filter((entry) => classifyFileName(entry.file.name) === "unsupported")
        .map((entry) => entry.path);
      noteSkipped(skippedPaths.map((path) => ({ path, reason: "unsupported file type" })));

      // Merge into the known drop set (dedupe by path, first wins).
      const seen = new Set(droppedFilesRef.current.map((entry) => entry.path));
      const merged = [...droppedFilesRef.current];
      const freshDocuments: string[] = [];
      for (const entry of recognized) {
        if (seen.has(entry.path)) continue;
        seen.add(entry.path);
        merged.push(entry);
        if (classifyFileName(entry.file.name) === "document") freshDocuments.push(entry.path);
      }
      droppedFilesRef.current = merged;
      setDroppedCount(merged.length);

      // Activate the first newly dropped document.
      if (freshDocuments.length > 0) {
        const tree = buildFileTree(merged);
        const entry = tree.find(
          (candidate): candidate is TreeDocument =>
            candidate.kind === "document" && candidate.path === freshDocuments[0]
        );
        if (entry) await activateDocument(entry);
      }
      return { documents: freshDocuments, skipped: skippedPaths };
    },
    [activateDocument, noteSkipped]
  );

  const handleImportChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      const selected = Array.from(input.files ?? []);
      // Allow picking the same document again after a reload.
      input.value = "";
      if (selected.length === 0) return;
      void ingestFiles(selected.map((file) => ({ path: file.name, file })));
    },
    [ingestFiles]
  );

  // Tree activation: vscode-tree dispatches vsc-tree-select from the tree
  // element without bubbling, so listen at document level. The event detail
  // is the selected-items array itself in current @vscode-elements releases
  // (older typings wrap it in { selectedItems }); accept both shapes.
  useEffect(() => {
    const onSelect = (event: Event): void => {
      const detail = (event as CustomEvent).detail as unknown;
      const items = Array.isArray(detail)
        ? detail
        : (detail as { selectedItems?: HTMLElement[] } | null)?.selectedItems;
      const path = (items?.[0] as HTMLElement | undefined)?.getAttribute("data-document-path");
      if (!path) return;
      const entry = buildFileTree(droppedFilesRef.current).find(
        (candidate): candidate is TreeDocument =>
          candidate.kind === "document" && candidate.path === path
      );
      if (entry) void activateDocument(entry);
    };
    document.addEventListener("vsc-tree-select", onSelect, true);
    return () => document.removeEventListener("vsc-tree-select", onSelect, true);
  }, [activateDocument]);

  // Global drag-and-drop.
  useEffect(() => {
    const onDragOver = (event: DragEvent): void => {
      event.preventDefault();
    };
    const onDrop = (event: DragEvent): void => {
      event.preventDefault();
      if (!event.dataTransfer) return;
      void filesFromDataTransfer(event.dataTransfer).then((result) => {
        noteSkipped(result.skipped);
        void ingestFiles(result.files);
      });
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [ingestFiles, noteSkipped]);

  const runBake = useCallback(async (): Promise<TextureStats | null> => {
    const current = activeRef.current;
    if (!current || bakingRef.current) return null;
    const capabilities = checkBakeCapabilities();
    if (!capabilities.ok) {
      setStatus("failed");
      setBakeMessage(capabilities.message ?? "Baking is unavailable.");
      pushMessage(capabilities.message ?? "Baking is unavailable.");
      return null;
    }
    if (current.entries.length === 0) {
      setStatus("failed");
      setBakeMessage("The document has no bakeable triangle meshes.");
      return null;
    }

    bakingRef.current = true;
    setStatus("running");
    setBakeMessage(null);
    try {
      const result = await bakeAmbientOcclusion(current.entries, {
        settings: { ...settingsRef.current },
        onProgress: (progress) => {
          setProgressLabel(
            `${progress.stage} ${Math.round(progress.fraction * 100)}% (bounce ${progress.bounce}/${progress.bounces})`
          );
        }
      });
      const applied = applyBakeResult(current.entries, result);
      appliedRef.current = applied;
      setAppliedBake(applied);
      const skipped = result.scene.litObjects.reduce(
        (sum, object) => sum + object.degenerateTriangleCount,
        0
      );
      if (skipped > 0) {
        pushMessage(
          `Ignored ${skipped} degenerate triangle(s) that xatlas could not chart; the rest of the document baked normally.`
        );
      }
      changeDisplayMode("both");
      setStatus("done");
      setProgressLabel(null);
      return textureStats(applied.textures.canvas);
    } catch (error) {
      setStatus("failed");
      setBakeMessage(errorMessage(error));
      pushMessage(`Bake failed: ${errorMessage(error)}`);
      setProgressLabel(null);
      return null;
    } finally {
      bakingRef.current = false;
    }
  }, [changeDisplayMode, pushMessage, setStatus]);

  const runExport = useCallback(async (): Promise<ExportOutcome | null> => {
    const current = activeRef.current;
    const applied = appliedRef.current;
    if (!current || !applied) {
      pushMessage("Export requires a completed bake first.");
      return null;
    }
    if (bakingRef.current) return null;
    busyRef.current = true;
    try {
      const result = await exportDocument(current.root, current.sourceName);
      downloadResult(result);
      pushMessage(`Exported ${result.name} (${result.bytes.length} bytes)`);
      return { name: result.name, bytes: result.bytes };
    } catch (error) {
      pushMessage(`Export failed: ${errorMessage(error)}`);
      return null;
    } finally {
      busyRef.current = false;
    }
  }, [pushMessage]);

  const loadSample = useCallback(async (): Promise<void> => {
    const file = await buildSampleGlbFile();
    await ingestFiles([{ path: file.name, file }]);
  }, [ingestFiles]);

  const getHookState = useCallback((): ShowcaseHookState => {
    const active = activeRef.current;
    let hasUv1 = false;
    active?.root.traverse((object) => {
      if (hasUv1) return;
      const geometry = (object as { geometry?: { getAttribute?: (name: string) => unknown } })
        .geometry;
      if (geometry?.getAttribute?.("uv1")) hasUv1 = true;
    });
    return {
      documents: droppedFilesRef.current.map((entry) => entry.path),
      active: active?.sourcePath ?? null,
      bakeStatus: bakeStatusRef.current,
      displayMode: displayModeRef.current,
      bakedMeshes: appliedRef.current?.bakedMeshCount ?? 0,
      hasUv1,
      messages: messagesRef.current,
      materials: sceneMaterialSummary(active),
      bakeSettings: { ...settingsRef.current },
      atlas: appliedRef.current
        ? {
            width: appliedRef.current.scene.atlas.width,
            height: appliedRef.current.scene.atlas.height,
            chartCount: appliedRef.current.scene.atlas.chartCount,
            utilization: appliedRef.current.scene.atlas.utilization,
            padding: appliedRef.current.scene.atlas.padding
          }
        : null
    };
 }, []);

  /**
   * Regression check for the bake write-back: every baked mesh must have one
   * lightmap UV per vertex and an index buffer that stays inside that range.
   * The old per-primitive write-back produced short uv1 buffers (one group
   * overwriting the whole mesh), which put AO on the wrong faces.
   */
  function uvIntegrity(): {
    ok: boolean;
    issues: string[];
    meshes: Array<{ name: string; vertexCount: number; uv1Count: number; indexMax: number; groups: number }>;
  } {
    const current = activeRef.current;
    if (!current || !appliedRef.current) {
      return { ok: false, issues: ["no baked document"], meshes: [] };
    }
    const issues: string[] = [];
    const meshes: Array<{ name: string; vertexCount: number; uv1Count: number; indexMax: number; groups: number }> = [];
    current.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (!bakedMaterialsOf(object)) return;
      const geometry = object.geometry;
      const position = geometry.getAttribute("position");
      const uv1 = geometry.getAttribute("uv1");
      const index = geometry.getIndex();
      const vertexCount = position?.count ?? 0;
      let indexMax = -1;
      if (index) {
        for (let i = 0; i < index.count; i += 1) {
          if (index.array[i]! > indexMax) indexMax = index.array[i]!;
        }
      }
      meshes.push({
        name: object.name || object.type,
        vertexCount,
        uv1Count: uv1?.count ?? 0,
        indexMax,
        groups: geometry.groups.length
      });
      if (!uv1) {
        issues.push(`${object.name || object.type}: missing uv1`);
      } else if (uv1.count !== vertexCount) {
        issues.push(
          `${object.name || object.type}: uv1 has ${uv1.count} vertices for ${vertexCount} positions`
        );
      }
      if (indexMax >= vertexCount) {
        issues.push(
          `${object.name || object.type}: index ${indexMax} is outside ${vertexCount} vertices`
        );
      }
    });
    return { ok: issues.length === 0 && meshes.length > 0, issues, meshes };
  }

  // Debug/test hook (drives the smoke test; harmless in interactive use).
  useEffect(() => {
    installTestHook({
      ingestFiles,
      runBake,
      runExport,
      loadSample,
      getHookState,
      getAtlasDataUrl: () => appliedRef.current?.textures.canvas.toDataURL("image/png") ?? null,
      getFloorUvAtlasSamples,
      sampleFloorAoMap,
      uvIntegrity
    });
  }, [ingestFiles, runBake, runExport, loadSample, getHookState]);

  /**
   * Sample the baked atlas at a handful of the floor's atlas UVs. Pixel y
   * equals v * height (v=0 is array row 0 - no flip).
   */
  function getFloorUvAtlasSamples():
    | { points: Array<{ u: number; v: number }>; values: number[] }
    | null {
    const applied = appliedRef.current;
    const current = activeRef.current;
    if (!applied || !current) return null;
    const entry = current.entries.find(
      (candidate) =>
        candidate.mesh.name === "floor" ||
        candidate.name === "floor" ||
        candidate.name.endsWith("/floor")
    );
    if (!entry) return null;
    // The baked mesh now carries the rebuilt geometry with uv1; entries keep
    // pointing at the original source geometry for re-bakes.
    const uv = entry.mesh.geometry.getAttribute("uv1");
    if (!uv) return null;
    const canvas = applied.textures.canvas;
    const context = canvas.getContext("2d");
    if (!context) return null;
    const points: Array<{ u: number; v: number }> = [];
    const values: number[] = [];
    const stride = Math.max(1, Math.floor(uv.count / 8));
    for (let index = 0; index < uv.count; index += stride) {
      const u = uv.getX(index);
      const v = uv.getY(index);
      const x = Math.min(canvas.width - 1, Math.max(0, Math.round(u * canvas.width)));
      const y = Math.min(canvas.height - 1, Math.max(0, Math.round(v * canvas.height)));
      const pixel = context.getImageData(x, y, 1, 1).data;
      points.push({ u, v });
      values.push(pixel[0] ?? 0);
    }
    return { points, values };
  }

  /**
   * Sample the ACTIVE document's floor AO map (the reimported export) at the
   * given UVs. The stored image's top row is v=0, so pixel y = v * height.
   */
  function sampleFloorAoMap(
    points: Array<{ u: number; v: number }>
  ): number[] | { error: string; detail?: unknown } {
    const current = activeRef.current;
    if (!current) return { error: "no active document" };
    let floor: THREE.Mesh | undefined;
    const hasFloorName = (object: THREE.Object3D): boolean => {
      let current: THREE.Object3D | null = object;
      while (current) {
        if (current.name === "floor") return true;
        current = current.parent;
      }
      return false;
    };
    current.root.traverse((object) => {
      if (!floor && object instanceof THREE.Mesh && hasFloorName(object)) floor = object;
    });
    const floorMesh = floor as THREE.Mesh | undefined;
    if (!floorMesh) return { error: "no floor mesh" };
    const materials = Array.isArray(floorMesh.material) ? floorMesh.material : [floorMesh.material];
    const aoMap = materials.find(
      (material): material is THREE.MeshStandardMaterial =>
        material instanceof THREE.MeshStandardMaterial && material.aoMap != null
    )?.aoMap;
    if (!aoMap) {
      return { error: "floor material has no aoMap", detail: materials.map((material) => ({
          type: material.type,
          aoMapKey: "aoMap" in material,
          aoMap: (material as THREE.MeshStandardMaterial).aoMap ?? null
        })) };
    }
    const image = aoMap.image as CanvasImageSource | undefined;
    const width = "width" in aoMap ? Number((aoMap.image as { width?: number }).width ?? 0) : 0;
    const height = "height" in aoMap ? Number((aoMap.image as { height?: number }).height ?? 0) : 0;
    if (!image || !width || !height) {
      return { error: "aoMap has no usable image", detail: { width, height } };
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return { error: "2d canvas unavailable" };
    context.drawImage(image, 0, 0);
    return points.map(({ u, v }) => {
      const x = Math.min(width - 1, Math.max(0, Math.round(u * width)));
      const y = Math.min(height - 1, Math.max(0, Math.round(v * height)));
      return context.getImageData(x, y, 1, 1).data[0] ?? 0;
    });
  }

  const statusBarLeft = activeName
    ? `${activeName}${activeRef.current ? ` - ${activeRef.current.entries.length} meshes, ${activeRef.current.triangleCount} tris` : ""}`
    : "No document";
  const statusBarRight =
    bakeStatus === "running"
      ? `Baking ${progressLabel ?? "..."}`
      : bakeStatus === "failed"
        ? (bakeMessage ?? "Bake failed")
        : bakeStatus === "done"
          ? `AO baked (${
              displayMode === "ao"
                ? "showing AO"
                : displayMode === "both"
                  ? "showing albedo + AO"
                  : "showing albedo"
            })`
          : "Ready";

  const tree = documentTree;

  return (
    <WorkbenchShell
      titleBar={
        <TitleBar
          label="Lightmap Studio"
          left={
            <div className="app-brand">
              <span className="app-brand-icon" aria-hidden="true">
                <vscode-icon name="lightbulb" size={18} />
              </span>
              <span className="app-brand-title">Lightmap Studio</span>
              <span className="app-brand-subtitle">Showcase</span>
            </div>
          }
          right={
            <>
              <input
                ref={importInputRef}
                className="titlebar-file-input"
                type="file"
                multiple
                accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp"
                data-role="import"
                onChange={handleImportChange}
              />
              <button
                type="button"
                className="titlebar-action"
                data-titlebar-action="import"
                title="Import .glb / .gltf documents and their parts"
                disabled={bakeStatus === "running"}
                onClick={() => importInputRef.current?.click()}
              >
                <vscode-icon name="folder-opened" size={14} />
                <span>Import</span>
              </button>
              <button
                type="button"
                className="titlebar-action"
                data-titlebar-action="export"
                title={
                  bakeStatus === "done"
                    ? "Export the baked document"
                    : "Bake AO first to enable export"
                }
                disabled={bakeStatus !== "done" || activeName === null}
                onClick={() => void runExport()}
              >
                <vscode-icon name="export" size={14} />
                <span>Export</span>
              </button>
            </>
          }
        />
      }
      primarySideBar={
        <ResizablePane
          side="left"
          size={sidebarWidth}
          min={200}
          max={420}
          onSizeChange={setSidebarWidth}
          onReset={() => setSidebarWidth(280)}
          label="Resize side bar"
        >
          <Sidebar title="Explorer" icon="files" label="Explorer">
            <div className="explorer-body">
              <vscode-collapsible heading="Documents" open>
                {tree.length === 0 ? (
                  <p className="empty-hint">Drop .glb / .gltf files and their parts here.</p>
                ) : (
                  <vscode-tree>
                    {tree.map((entry) =>
                      entry.kind === "document" ? (
                        <vscode-tree-item
                          key={entry.path}
                          branch
                          open
                          data-document-path={entry.path}
                          active={entry.path === activePath}
                        >
                          <vscode-icon name="file-binary" slot="icon-leaf" />
                          <vscode-icon name="folder" slot="icon-branch" />
                          <vscode-icon name="folder-opened" slot="icon-branch-opened" />
                          {entry.name}
                          {entry.parts.map((part) => (
                            <vscode-tree-item key={part.path} data-document-path={part.path}>
                              <vscode-icon name="file" slot="icon-leaf" />
                              {part.name}
                            </vscode-tree-item>
                          ))}
                        </vscode-tree-item>
                      ) : (
                        <vscode-tree-item key={entry.name} branch open>
                          <vscode-icon name="folder" slot="icon-branch" />
                          <vscode-icon name="folder-opened" slot="icon-branch-opened" />
                          {entry.name}
                          {entry.parts.map((part) => (
                            <vscode-tree-item key={part.path}>
                              <vscode-icon name="file" slot="icon-leaf" />
                              {part.name}
                            </vscode-tree-item>
                          ))}
                        </vscode-tree-item>
                      )
                    )}
                  </vscode-tree>
                )}
              </vscode-collapsible>
              <vscode-collapsible heading="Messages" open={messages.length > 0}>
                <div className="messages">
                  <vscode-button className="link" onClick={() => void loadSample()}>
                    Load sample scene
                  </vscode-button>
                  {messages.length === 0 ? (
                    <p className="empty-hint">No messages.</p>
                  ) : (
                    messages.map((message, index) => (
                      <p className="message" key={`${index}-${message}`}>
                        {message}
                      </p>
                    ))
                  )}
                </div>
              </vscode-collapsible>
            </div>
          </Sidebar>
        </ResizablePane>
      }
      secondarySideBar={
        <ResizablePane
          side="right"
          size={bakePanelWidth}
          min={220}
          max={460}
          onSizeChange={setBakePanelWidth}
          onReset={() => setBakePanelWidth(280)}
          label="Resize bake panel"
        >
          <Sidebar title="Bake" icon="lightbulb" label="Bake settings">
            <div className="bake-panel">
              <vscode-form-container>
                <vscode-form-group variant="settings-group">
                  <vscode-label>Atlas size</vscode-label>
                  <vscode-single-select
                    data-form-control="atlas"
                    value={String(atlasSize)}
                    disabled={bakeStatus === "running"}
                  >
                    {ATLAS_SIZES.map((size) => (
                      <vscode-option key={size} value={String(size)}>
                        {`${size} x ${size}`}
                      </vscode-option>
                    ))}
                  </vscode-single-select>
                  <vscode-form-helper>
                    Resolution of the shared atlas texture.
                  </vscode-form-helper>
                </vscode-form-group>
                <vscode-form-group variant="settings-group">
                  <vscode-label>Chart padding</vscode-label>
                  <vscode-single-select
                    data-form-control="padding"
                    value={String(padding)}
                    disabled={bakeStatus === "running"}
                  >
                    {ATLAS_PADDING_OPTIONS.map((size) => (
                      <vscode-option key={size} value={String(size)}>
                        {`${size} px`}
                      </vscode-option>
                    ))}
                  </vscode-single-select>
                  <vscode-form-helper>
                    Texels between UV charts. Raise it if light or dilation bleeds across islands.
                  </vscode-form-helper>
                </vscode-form-group>
                <vscode-form-group variant="settings-group">
                  <vscode-label>Quality</vscode-label>
                  <vscode-single-select
                    data-form-control="quality"
                    value={quality}
                    disabled={bakeStatus === "running"}
                  >
                    {QUALITY_PRESETS.map((preset) => (
                      <vscode-option key={preset} value={preset}>
                        {preset}
                      </vscode-option>
                    ))}
                  </vscode-single-select>
                  <vscode-form-helper>
                    Hemisphere samples and smoothing per preset.
                  </vscode-form-helper>
                </vscode-form-group>
                <vscode-form-group variant="settings-group">
                  <vscode-label>Bounces</vscode-label>
                  <vscode-single-select
                    data-form-control="bounces"
                    value={String(bounces)}
                    disabled={bakeStatus === "running"}
                  >
                    {BOUNCE_OPTIONS.map((count) => (
                      <vscode-option key={count} value={String(count)}>
                        {String(count)}
                      </vscode-option>
                    ))}
                  </vscode-single-select>
                  <vscode-form-helper>
                    Indirect light bounces. AO needs only 1 (direct sky).
                  </vscode-form-helper>
                </vscode-form-group>
              </vscode-form-container>
              {bakeMessage && bakeStatus === "failed" ? (
                <p className="message error">{bakeMessage}</p>
              ) : null}
            </div>
          </Sidebar>
        </ResizablePane>
      }
      statusBar={
        <StatusBar
          left={<span>{statusBarLeft}</span>}
          right={
            <span className={bakeStatus === "failed" ? "status-error" : undefined}>
              {statusBarRight}
            </span>
          }
        />
      }
    >
      <main className="stage-host">
        <div className="stage-tabs" role="tablist" aria-label="Stage view">
          <button
            type="button"
            role="tab"
            className={stageTab === "viewport" ? "stage-tab active" : "stage-tab"}
            aria-selected={stageTab === "viewport"}
            data-stage-tab="viewport"
            onClick={() => setStageTab("viewport")}
          >
            3D
          </button>
          <button
            type="button"
            role="tab"
            className={stageTab === "atlas" ? "stage-tab active" : "stage-tab"}
            aria-selected={stageTab === "atlas"}
            data-stage-tab="atlas"
            onClick={() => setStageTab("atlas")}
          >
            Lightmap Atlas
          </button>
        </div>
        <div className="stage-content">
          <section
            className={stageTab === "viewport" ? "stage-panel active" : "stage-panel"}
            data-stage-panel="viewport"
          >
            <div className="viewport-host" ref={viewportHostRef}>
              <button
                type="button"
                className="viewport-bake-button"
                data-view-action="bake"
                title={
                  bakeStatus === "running"
                    ? "Baking ambient occlusion"
                    : "Bake ambient occlusion for the active document"
                }
                disabled={bakeStatus === "running" || activeName === null}
                onClick={() => void runBake()}
              >
                <vscode-icon name="lightbulb" size={14} />
                <span>{bakeStatus === "running" ? "Baking..." : "Bake AO"}</span>
              </button>
              {activeName !== null ? (
                <div
                  className="viewport-mode-switch"
                  role="group"
                  aria-label="Display mode"
                >
                  {DISPLAY_MODES.map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      className={displayMode === mode.id ? "active" : undefined}
                      data-view-mode={mode.id}
                      aria-pressed={displayMode === mode.id}
                      title={
                        bakeStatus === "done"
                          ? mode.description
                          : "Bake AO to switch display modes"
                      }
                      disabled={bakeStatus !== "done"}
                      onClick={() => changeDisplayMode(mode.id)}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              ) : null}
              {activeName === null ? (
                <div className="empty-viewport overlay">
                  Drop a .glb or .gltf document to begin, or load the sample scene from the sidebar.
                </div>
              ) : null}
            </div>
          </section>
          <section
            className={stageTab === "atlas" ? "stage-panel active" : "stage-panel"}
            data-stage-panel="atlas"
          >
            <AtlasInspector applied={appliedBake} />
          </section>
        </div>
      </main>
    </WorkbenchShell>
  );
}

interface MaterialSummary {
  mesh: string;
  name: string;
  type: string;
  map: boolean;
  aoMap: boolean;
}

function sceneMaterialSummary(active: ActiveDocument | null): MaterialSummary[] {
  if (!active) return [];
  const summary: MaterialSummary[] = [];
  active.root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      const standard = material as THREE.MeshStandardMaterial;
      summary.push({
        mesh: object.name,
        name: material.name,
        type: material.type,
        map: standard.map != null,
        aoMap: standard.aoMap != null
      });
    }
  });
  return summary;
}

function textureStats(canvas: HTMLCanvasElement): TextureStats {  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas unavailable");
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let min = 255;
  let max = 0;
  let sum = 0;
  let count = 0;
  // Red channel of every texel.
  for (let i = 0; i < data.length; i += 4) {
    const value = data[i] ?? 0;
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
    count += 1;
  }
  return { min, max, mean: count > 0 ? sum / count : 0 };
}
