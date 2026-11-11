import assert from "node:assert/strict";
import { test } from "node:test";
import createXAtlas from "xatlas-wasm";
import { StudioError, createStudio } from "../dist/index.js";

function quad() {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3])
  };
}

test("invalid wasm option types reject with a validation error", async () => {
  await assert.rejects(
    () => createStudio({ wasm: { xatlas: { binary: "not bytes" } } }),
    (error) => error instanceof StudioError && error.code === "validation"
  );
  await assert.rejects(
    () => createStudio({ wasm: { lightmapper: { url: 42 } } }),
    (error) => error instanceof StudioError && error.code === "validation"
  );
});

test("injected xatlas modules are used without loading an asset", async () => {
  const xatlas = await createXAtlas();
  const studio = await createStudio({ modules: { xatlas } });
  try {
    const scene = await studio.unwrap([quad()], { size: 32 });
    assert.equal(scene.litObjects.length, 1);
  } finally {
    studio.dispose();
    xatlas.destroy?.();
  }
});

test("the default loader resolves xatlas in Node", async () => {
  const studio = await createStudio();
  try {
    const scene = await studio.unwrap([quad()], { size: 32 });
    assert.ok(scene.atlas.width > 0);
  } finally {
    studio.dispose();
  }
});

test("bake without a WebGL context rejects with a webgl2 error", async () => {
  const studio = await createStudio();
  try {
    await assert.rejects(
      () =>
        studio.bake({
          meshes: [quad()],
          lighting: { ambient: [0, 0, 0] }
        }),
      (error) => error instanceof StudioError && error.code === "webgl2"
    );
  } finally {
    studio.dispose();
  }
});

test("binary bytes win over a URL", async () => {
  const { readFileSync } = await import("node:fs");
  const binary = readFileSync(new URL("../node_modules/xatlas-wasm/dist/xatlas.wasm", import.meta.url));
  const studio = await createStudio({
    wasm: { xatlas: { binary, url: "/missing-xatlas.wasm" } }
  });
  try {
    const scene = await studio.unwrap([quad()], { size: 32 });
    assert.ok(scene.atlas.width > 0);
  } finally {
    studio.dispose();
  }
});

test("a missing xatlas URL rejects with an asset error", async () => {
  const studio = await createStudio({ wasm: { xatlas: { url: "/missing-xatlas.wasm" } } });
  try {
    await assert.rejects(
      () => studio.unwrap([quad()], { size: 32 }),
      (error) => {
        assert.ok(error instanceof StudioError);
        assert.equal(error.code, "assets");
        assert.match(error.message, /missing-xatlas\.wasm/);
        assert.ok(error.cause, "original error should be preserved as cause");
        return true;
      }
    );
  } finally {
    studio.dispose();
  }
});

test("an injected module wins over supplied bytes", async () => {
  const { readFileSync } = await import("node:fs");
  const binary = readFileSync(new URL("../node_modules/xatlas-wasm/dist/xatlas.wasm", import.meta.url));
  const injected = {
    createAtlas() {
      throw new Error("injected module used");
    }
  };
  const studio = await createStudio({
    modules: { xatlas: injected },
    wasm: { xatlas: { binary } }
  });
  try {
    await assert.rejects(
      () => studio.unwrap([quad()], { size: 32 }),
      /injected module used/
    );
  } finally {
    studio.dispose();
  }
});

test("injected modules remain usable after studio disposal", async () => {
  const xatlas = await createXAtlas();
  const studio = await createStudio({ modules: { xatlas } });
  await studio.unwrap([quad()], { size: 32 });
  studio.dispose();
  const atlas = xatlas.createAtlas();
  assert.ok(atlas);
  atlas.destroy();
});
