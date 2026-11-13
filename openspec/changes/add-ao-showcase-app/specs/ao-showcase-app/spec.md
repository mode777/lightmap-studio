# Spec Delta

## Purpose

Provide a browser-hosted showcase application that demonstrates the lightmap-studio library end to end: GLB/GLTF documents are dropped in, ambient occlusion is baked into an atlas lightmap, and the document is exported back with the baked AO embedded.

## ADDED Requirements

### Requirement: Drag-and-drop document ingestion
The application SHALL accept one or more files dropped onto the window, recognizing `.glb` and `.gltf` as documents and `.bin` plus common image formats (`.png`, `.jpg`, `.jpeg`, `.webp`) as document parts. Dropped folders SHALL be traversed recursively. Files of unrecognized type SHALL be reported as skipped, not silently discarded.

#### Scenario: Multi-file drop with external parts
- **WHEN** a user drops `scene.gltf`, `scene.bin`, and a texture folder together onto the window
- **THEN** all three entries appear in the file tree and `scene.gltf` is offered as a loadable document

#### Scenario: Unrecognized file type
- **WHEN** a user drops a `.txt` file together with a `.glb` document
- **THEN** the `.glb` appears in the tree and the application reports the `.txt` file as skipped

### Requirement: Application title bar
The application SHALL render a title bar with the application icon and title, an Import action that opens a multi-file picker for `.glb`/`.gltf` documents and their parts, and an Export action for the baked active document. Export SHALL remain disabled until a bake completes for the active document.

#### Scenario: Import from the title bar
- **WHEN** the user activates Import, selects a `.glb` document and confirms
- **THEN** the document is ingested through the same path as a drop and becomes the active scene

#### Scenario: Export availability
- **WHEN** no bake has completed for the active document
- **THEN** the title-bar Export action is disabled, and it becomes enabled after a successful bake

### Requirement: Tree view of dropped files
The application SHALL list all dropped files in a tree view in the sidebar, grouped under their document entries, and SHALL let the user select a document to load it into the viewport. Loading a different document SHALL replace the active scene.

#### Scenario: Selecting a document
- **WHEN** the tree lists two `.glb` documents and the user activates the second
- **THEN** the viewport displays the second document's scene and subsequent bake and export actions apply to it

### Requirement: Document loading errors name the missing part
The application SHALL report a load failure that names the unresolved file when a `.gltf` document references a buffer or texture that was not dropped.

#### Scenario: Missing external buffer
- **WHEN** the user loads a `.gltf` whose `.bin` buffer is absent from the dropped set
- **THEN** loading fails with an error message naming the missing buffer file and the viewport keeps its previous state

### Requirement: Unsupported compressed documents are rejected
The application SHALL reject a document that requires an unsupported compression extension (`KHR_draco_mesh_compression`, `KHR_texture_basisu`, `EXT_meshopt_compression`) with an error naming the extension, before any bake runs.

#### Scenario: Draco-compressed GLB
- **WHEN** the user loads a `.glb` declaring `KHR_draco_mesh_compression` in `extensionsUsed`
- **THEN** the application reports the unsupported extension by name and no bake or export is possible for that document

### Requirement: Viewport rendering of the active document
The application SHALL render the loaded document in a WebGL2 viewport with orbit controls. With no document loaded, the viewport SHALL show an empty state inviting a drop. The viewport SHALL NOT open additional WebGL2 contexts when documents change.

#### Scenario: Load and inspect
- **WHEN** a document finishes loading
- **THEN** the scene renders in the viewport and can be orbited and zoomed with the pointer

### Requirement: Ambient occlusion bake
The application SHALL bake ambient occlusion for the active document through the lightmap-studio studio API, using a uniform white sky environment, zero ambient, and a single bounce. The user SHALL select atlas size (512/1024/2048), quality preset (`draft`/`preview`/`final`), and xatlas chart padding in texels, with a sensible default. Repeated bakes of the same document and settings SHALL produce the same result (determinism provided by the library).

#### Scenario: Bake completes with progress
- **WHEN** the user activates Bake for a loaded document
- **THEN** the status bar reports bake progress until completion and the baked atlas becomes available for preview and export

#### Scenario: Busy protection
- **WHEN** the user activates Bake while a bake is already running
- **THEN** the application refuses to start a second concurrent bake

### Requirement: Baked AO preview
After a bake completes, the application SHALL offer a three-way display switch in the 3D view: albedo only, AO only, or both. Both SHALL be the default after a bake, and switching between modes SHALL NOT re-bake.

#### Scenario: Default combined preview
- **WHEN** a bake completes
- **THEN** the viewport shows the albedo material multiplied by the baked ambient occlusion

#### Scenario: Switch preview modes
- **WHEN** the user selects albedo only, AO only, or both
- **THEN** the viewport updates to the selected display without re-baking, and the switch marks the active mode

### Requirement: Atlas inspector tab
The application SHALL provide a stage tab that displays the baked lightmap atlas with the unwrapped chart outlines and atlas metadata (dimensions, chart count, utilization). The tab SHALL become available after a bake without re-baking, and switching between the 3D and atlas tabs SHALL preserve the active document, bake result and camera state.

#### Scenario: Inspect the unwrapped lightmap
- **WHEN** a bake completes and the user opens the Lightmap Atlas tab
- **THEN** the tab shows the baked atlas at its native resolution with chart outlines that match the lightmap UV islands, plus its size, chart count and utilization

#### Scenario: Return to the 3D view
- **WHEN** the user switches from the atlas tab back to the 3D tab
- **THEN** the viewport shows the same scene and display mode without another bake

### Requirement: AO-embedded export
The application SHALL export the active document with the baked AO embedded: baked meshes gain their atlas UVs on `TEXCOORD_1` and their materials gain an `occlusionTexture` referencing the baked texture as an 8-bit image, preserving the original geometry, materials, and `TEXCOORD_0`. The output format SHALL match the input format (`.glb` for `.glb`, `.gltf` for `.gltf`), the download SHALL be named after the input document, and export SHALL be unavailable until a bake has completed.

#### Scenario: Export round-trips into a conformant viewer
- **WHEN** the user exports a baked `.glb` document and the result is loaded by a glTF 2.0 loader
- **THEN** baked materials carry an `occlusionTexture` sampled on `TEXCOORD_1` and the base color texture remains bound to `TEXCOORD_0`

#### Scenario: Export before bake
- **WHEN** the user activates Export before any bake has completed for the active document
- **THEN** the application does not produce a file and explains that a bake is required first

### Requirement: GPU capability failure is surfaced without asset fetches
The application SHALL report that baking is unavailable when WebGL2 or `EXT_color_buffer_float` is missing, before requesting the lightmapper asset. The viewport SHALL still render loaded documents in this state.

#### Scenario: No float render-target support
- **WHEN** the browser lacks `EXT_color_buffer_float` and the user activates Bake
- **THEN** the application reports the missing capability, does not fetch `lightmapper.wasm`, and the viewport keeps rendering
