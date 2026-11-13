# Spec Delta

## Purpose

Define how the showcase application reaches GitHub Pages: when deployments happen, what the deployed artifact must contain, and what verification gates it before publishing.

## ADDED Requirements

### Requirement: Pages deployment on push to Main
The repository SHALL deploy the showcase application to GitHub Pages via GitHub Actions on every push to the default branch that affects the showcase or the library, and on manual dispatch. The deployment SHALL NOT run on other branches or pull requests.

#### Scenario: Push to Main deploys the showcase
- **WHEN** a commit that modifies `apps/showcase/` is pushed to `Main`
- **THEN** the workflow builds the application and publishes it to GitHub Pages

#### Scenario: Pull request does not deploy
- **WHEN** a pull request modifies the showcase
- **THEN** the workflow runs verification only and performs no Pages deployment

### Requirement: Deployed artifact completeness
The deployed site SHALL be a self-contained static build served under the `/lightmap-studio/` base path, containing the application bundle and both `xatlas` and `lightmapper` wasm assets. The application SHALL function on a plain static server without custom response headers (no cross-origin isolation requirement).

#### Scenario: Wasm assets are present
- **WHEN** the workflow inspects the built application output before publishing
- **THEN** both wasm assets are emitted alongside the application bundle

#### Scenario: Bake works without special headers
- **WHEN** the built application is served by a plain static file server and a document is baked
- **THEN** the bake completes without cross-origin isolation headers

### Requirement: Smoke gate before deployment
The workflow SHALL verify the built application in a headless browser (SwiftShader WebGL) before publishing: loading a generated sample document, baking it, and confirming the exported result contains `occlusionTexture` with atlas UVs on a second texture-coordinate set. Deployment SHALL be skipped when the smoke fails.

#### Scenario: Smoke failure blocks deployment
- **WHEN** the headless smoke reports a failure
- **THEN** the Pages deployment step does not run

#### Scenario: Smoke passes end to end
- **WHEN** the smoke loads a sample document through the application's ingestion path, bakes, and exports
- **THEN** the export contains an `occlusionTexture` and a second texture-coordinate attribute on the baked mesh

### Requirement: Library gates precede deployment
The workflow SHALL run the library's build, typecheck, and test suites against the repository state being deployed, and SHALL skip deployment when any gate fails.

#### Scenario: Library test failure blocks deployment
- **WHEN** a push to `Main` breaks a library test
- **THEN** the workflow fails before any Pages deployment occurs
