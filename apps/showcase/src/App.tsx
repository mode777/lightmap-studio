import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { ResizablePane, Sidebar, StatusBar, WorkbenchShell } from "vscode-workbench/react";
import {
  ATLAS_SIZES,
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
import { applyBakeResult, type AppliedBake } from "./lib/lightmap.ts";
import { buildSampleGlbFile } from "./lib/sample.ts";
import { Viewport, type DisplayMode } from "./lib/viewport.ts";
import { installTestHook, type ShowcaseHookState, type ExportOutcome } from "./lib/testHook.ts";
import type { ActiveDocument } from "./lib/appState.ts";

type BakeStatus = "idle" | "running" | "done" | "failed";

interface TextureStats {
  min: number;
  max: number;
  mean: number;
}

export function App() {
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [droppedCount, setDroppedCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [messages, setMessages] = useState<string[]>([]);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [bakeStatus, setBakeStatus] = useState<BakeStatus>("idle");
  const [bakeMessage, setBakeMessage] = useState<string | null>(null);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("albedo");
  const [atlasSize, setAtlasSize] = useState(1024);
  const [quality, setQuality] = useState<(typeof QUALITY_PRESETS)[number]>("preview");

  // Synchronous mirrors: the test hook and the bake/export flows read these
  // directly, so they never depend on a React render having happened.
  const droppedFilesRef = useRef<DroppedFile[]>([]);
  const activeRef = useRef<ActiveDocument | null>(null);
  const bakeStatusRef = useRef<BakeStatus>("idle");
  const displayModeRef = useRef<DisplayMode>("albedo");
  const appliedRef = useRef<AppliedBake | null>(null);
  const messagesRef = useRef<string[]>([]);
  const bakingRef = useRef(false);
  const busyRef = useRef(false);
  const settingsRef = useRef<{ atlasSize: number; quality: QualityPreset }>({
    atlasSize: 1024,
    quality: "preview"
  });

  const viewportHostRef = useRef<HTMLElement | null>(null);
  const viewportRef = useRef<Viewport | null>(null);

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
      else if (kind === "quality") applyQuality(value as QualityPreset);
      else if (kind === "display") changeDisplayMode(value as DisplayMode);
    };
    document.addEventListener("change", onChange, true);
    return () => document.removeEventListener("change", onChange, true);
  }, [applyAtlasSize, applyQuality, changeDisplayMode]);

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
        appliedRef.current = null;
        bakingRef.current = false;
        activeRef.current = loaded;
        setStatus("idle");
        setBakeMessage(null);
        setProgressLabel(null);
        changeDisplayMode("albedo");
        viewportRef.current?.setScene(parsed.scene);
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
      changeDisplayMode("ao");
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
      const result = await exportDocument(
        current.root,
        current.sourceName,
        applied.textures.export,
        applied.textures.preview
      );
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
      bakeSettings: { ...settingsRef.current }
    };
 }, []);

  // Debug/test hook (drives the smoke test; harmless in interactive use).
  useEffect(() => {
    installTestHook({
      ingestFiles,
      runBake,
      runExport,
      loadSample,
      getHookState,
      getAtlasDataUrl: () => appliedRef.current?.textures.canvas.toDataURL("image/png") ?? null
    });
  }, [ingestFiles, runBake, runExport, loadSample, getHookState]);

  const statusBarLeft = activeName
    ? `${activeName}${activeRef.current ? ` - ${activeRef.current.entries.length} meshes, ${activeRef.current.triangleCount} tris` : ""}`
    : "No document";
  const statusBarRight =
    bakeStatus === "running"
      ? `Baking ${progressLabel ?? "..."}`
      : bakeStatus === "failed"
        ? (bakeMessage ?? "Bake failed")
        : bakeStatus === "done"
          ? `AO baked (${displayMode === "ao" ? "showing AO" : "showing albedo"})`
          : "Ready";

  const tree = documentTree;

  return (
    <WorkbenchShell
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
              <vscode-collapsible heading="Bake" open>
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
                      Hemisphere samples, bounces and smoothing per preset.
                    </vscode-form-helper>
                  </vscode-form-group>
                  <vscode-form-group variant="settings-group">
                    <vscode-label>Display</vscode-label>
                    <vscode-single-select
                      data-form-control="display"
                      value={displayMode}
                      disabled={bakeStatus !== "done"}
                    >
                      <vscode-option value="albedo">albedo</vscode-option>
                      <vscode-option value="ao">ambient occlusion</vscode-option>
                    </vscode-single-select>
                    <vscode-form-helper>
                      View the baked occlusion without re-baking.
                    </vscode-form-helper>
                  </vscode-form-group>
                </vscode-form-container>
                <div className="actions-row">
                  <vscode-button
                    disabled={bakeStatus === "running" || activeName === null}
                    onClick={() => void runBake()}
                  >
                    Bake AO
                  </vscode-button>
                  <vscode-button
                    secondary
                    disabled={bakeStatus !== "done" || activeName === null}
                    onClick={() => void runExport()}
                  >
                    Export
                  </vscode-button>
                </div>
                {bakeMessage && bakeStatus === "failed" ? (
                  <p className="message error">{bakeMessage}</p>
                ) : null}
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
      <main className="viewport-host" ref={viewportHostRef}>
        {activeName === null ? (
          <div className="empty-viewport overlay">
            Drop a .glb or .gltf document to begin, or load the sample scene from the sidebar.
          </div>
        ) : null}
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
