// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const root = process.cwd();

it("ships a real Windows multi-resolution icon generated from the original PNG", () => {
  const original = readFileSync(join(root, "public", "icon.png"));
  const copy = readFileSync(join(root, "build", "icon.png"));
  expect(copy.equals(original)).toBe(true);
  const ico = readFileSync(join(root, "build", "icon.ico"));
  expect(ico.readUInt16LE(0)).toBe(0);
  expect(ico.readUInt16LE(2)).toBe(1);
  expect(ico.readUInt16LE(4)).toBe(7);
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  for (let i = 0; i < sizes.length; i++) {
    const record = 6 + i * 16;
    expect(ico.readUInt8(record)).toBe(sizes[i] === 256 ? 0 : sizes[i]);
    expect(ico.readUInt8(record + 1)).toBe(sizes[i] === 256 ? 0 : sizes[i]);
    const length = ico.readUInt32LE(record + 8);
    const offset = ico.readUInt32LE(record + 12);
    expect(length).toBeGreaterThan(0);
    if (sizes[i] === 256) {
      expect(ico.subarray(offset, offset + 8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
    } else {
      expect(ico.readUInt32LE(offset)).toBe(40); // Windows BMP DIB header
      expect(ico.readInt32LE(offset + 4)).toBe(sizes[i]);
      expect(ico.readInt32LE(offset + 8)).toBe(sizes[i]! * 2); // color + AND mask
      expect(ico.readUInt16LE(offset + 14)).toBe(32);
    }
  }
});

it("configures Windows executable/installer assets without relying on the developer machine path", () => {
  const config = readFileSync(join(root, "electron-builder.yml"), "utf8");
  expect(config).toContain("build/icon.ico");
  expect(config).toContain("to: icon.ico");
  expect(config).toContain("build/icon.png");
  expect(config).toContain("nsis");
  expect(config).not.toContain("C:\\Personal");
  expect(existsSync(join(root, "electron", "renderer", "index.html"))).toBe(true);
  expect(readFileSync(join(root, "electron", "renderer", "index.html"), "utf8"))
    .toContain('href="./icon.png"');
  expect(readFileSync(join(root, "src", "routes", "__root.tsx"), "utf8"))
    .toContain('href: "/icon.png"');
});
