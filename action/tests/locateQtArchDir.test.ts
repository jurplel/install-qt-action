import { locateQtArchDir, nativePath } from "../src/helpers";
import * as fs from "fs";
import * as path from "path";
import "jest";

describe("locateQtArchDir integration tests", () => {
  let tempDir: string;

  const createDummyQMakeFile = (dir: string): void => {
    if (process.platform === "win32") {
      fs.writeFileSync(path.join(dir, "qmake.exe"), "");
    } else {
      fs.writeFileSync(path.join(dir, "qmake"), "");
    }
  };

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(__dirname, "tempQtInstall_"));
  });

  afterEach(() => {
    // Clean up after each test
    fs.rmdirSync(tempDir, { recursive: true });
    tempDir = fs.mkdtempSync(path.join(__dirname, "tempQtInstall_"));
  });

  afterAll(() => {
    // Clean up the temporary directory after all tests
    fs.rmdirSync(tempDir, { recursive: true });
  });

  it("should return the first desktop Qt directory if multiple desktop installations are found", () => {
    const dirsToCreate = [
      "6.4.2/gcc_64/bin",
      "6.4.3/clang_64/bin",
      "6.4.3/msvc2022_64/bin",
    ];

    dirsToCreate.forEach((dir) => {
      const fullPath = path.join(tempDir, dir);
      fs.mkdirSync(fullPath, { recursive: true });
      // create dummy qmake file
      createDummyQMakeFile(fullPath);
    });

    const result = nativePath(locateQtArchDir(tempDir));
    expect(result).toBe(path.join(tempDir, "6.4.2/gcc_64"));
  });

  it("Windows-specific folder", () => {
    const dirsToCreate = [
      "6.4.3/msvc2022_64/bin",
    ];

    dirsToCreate.forEach((dir) => {
      const fullPath = path.join(tempDir, dir);
      fs.mkdirSync(fullPath, { recursive: true });
      // create dummy qmake file
      createDummyQMakeFile(fullPath);
    });

    const result = nativePath(locateQtArchDir(tempDir));
    expect(result).toBe(path.join(tempDir, "6.4.3/msvc2022_64"));
  });

  it("should prioritize mobile installation if both mobile and desktop installations are present", () => {
    const dirsToCreate = ["6.4.2/android_arm64_v8a/bin", "6.4.2/gcc_64/bin"];

    dirsToCreate.forEach((dir) => {
      const fullPath = path.join(tempDir, dir);
      fs.mkdirSync(fullPath, { recursive: true });
      createDummyQMakeFile(fullPath);
    });

    const result = nativePath(locateQtArchDir(tempDir));
    expect(result).toBe(path.join(tempDir, "6.4.2/android_arm64_v8a"));
  });

  it("should prioritize wasm installation if both wasm and desktop installations are present", () => {
    const dirsToCreate = ["6.4.2/wasm_32/bin", "6.4.2/gcc_64/bin"];

    dirsToCreate.forEach((dir) => {
      const fullPath = path.join(tempDir, dir);
      fs.mkdirSync(fullPath, { recursive: true });
      createDummyQMakeFile(fullPath);
    });

    const result = nativePath(locateQtArchDir(tempDir));
    expect(result).toBe(path.join(tempDir, "6.4.2/wasm_32"));
  });

  it("should prioritize ARM architecture if msvc_arm64 and desktop installations coexist", () => {
    const dirsToCreate = ["6.4.2/msvc2019_arm64/bin", "6.4.2/gcc_64/bin"];

    dirsToCreate.forEach((dir) => {
      const fullPath = path.join(tempDir, dir);
      fs.mkdirSync(fullPath, { recursive: true });
      createDummyQMakeFile(fullPath);
    });

    const result = nativePath(locateQtArchDir(tempDir));
    expect(result).toBe(path.join(tempDir, "6.4.2/msvc2019_arm64"));
  });

  it("should throw an error if no valid Qt installation directories are found", () => {
    expect(() => nativePath(locateQtArchDir(tempDir))).toThrow(
      `Failed to locate a Qt installation directory in ${tempDir}`
    );
  });

  it("should select the first match if multiple mobile or wasm installations are found", () => {
    const dirsToCreate = [
      "6.4.2/android_arm64_v8a/bin",
      "6.4.2/wasm_32/bin",
      "6.4.3/ios/bin",
    ];

    dirsToCreate.forEach((dir) => {
      const fullPath = path.join(tempDir, dir);
      fs.mkdirSync(fullPath, { recursive: true });
      createDummyQMakeFile(fullPath);
    });

    const result = nativePath(locateQtArchDir(tempDir));
    expect(result).toBe(path.join(tempDir, "6.4.2/android_arm64_v8a"));
  });
});
