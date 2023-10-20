import * as crypto from "crypto";
import * as os from "os";
import * as path from "path";
import * as process from "process";

import * as cache from "@actions/cache";
import * as core from "@actions/core";
import { exec } from "@actions/exec";

import * as glob from "glob";
import { compare, CompareOperator } from "compare-versions";

const nativePath = process.platform === "win32" ? path.win32.normalize : path.normalize;

const compareVersions = (v1: string, op: CompareOperator, v2: string): boolean => {
  return compare(v1, v2, op);
};

const setOrAppendEnvVar = (name: string, value: string): void => {
  const oldValue = process.env[name];
  let newValue = value;
  if (oldValue) {
    newValue = `${oldValue}:${newValue}`;
  }
  core.exportVariable(name, newValue);
};

const execPython = async (command: string, args: readonly string[]): Promise<number> => {
  const python = process.platform === "win32" ? "python" : "python3";
  return exec(`${python} -m ${command} ${args.join(" ")}`);
};

const flaggedList = (flag: string, listArgs: readonly string[]): string[] => {
  return listArgs.length ? [flag, ...listArgs] : [];
};

const locateQtArchDir = (installDir: string): string => {
  // For 6.4.2/gcc, qmake is at 'installDir/6.4.2/gcc_64/bin/qmake'.
  // This makes a list of all the viable arch directories that contain a qmake file.
  const qtArchDirs = glob
    .sync(`${installDir}/[0-9]*/*/bin/qmake*`)
    .map((s) => s.replace(/\/bin\/qmake[^/]*$/, ""));

  // For Qt6 mobile and wasm installations, a standard desktop Qt installation
  // must exist alongside the requested architecture.
  // In these cases, we must select the first item that ends with 'android*', 'ios', or 'wasm*'.
  const requiresParallelDesktop = qtArchDirs.filter((p) =>
    p.match(/6\.\d+\.\d+\/(android[^/]*|ios|wasm[^/]*)$/)
  );
  if (requiresParallelDesktop.length) {
    // NOTE: if multiple mobile/wasm installations coexist, this may not select the desired directory
    return requiresParallelDesktop[0];
  } else if (!qtArchDirs.length) {
    throw Error(`Failed to locate a Qt installation directory in  ${installDir}`);
  } else {
    // NOTE: if multiple Qt installations exist, this may not select the desired directory
    return qtArchDirs[0];
  }
};

class Inputs {
  readonly host: "windows" | "mac" | "linux";
  readonly target: "desktop" | "android" | "ios";
  readonly version: string;
  readonly arch: string;
  readonly dir: string;
  readonly modules: string[];
  readonly archives: string[];
  readonly tools: string[];
  readonly extra: string[];

  readonly src: boolean;
  readonly srcArchives: string[];

  readonly doc: boolean;
  readonly docArchives: string[];
  readonly docModules: string[];

  readonly example: boolean;
  readonly exampleArchives: string[];
  readonly exampleModules: string[];

  readonly installDeps: boolean | "nosudo";
  readonly cache: boolean;
  readonly cacheKeyPrefix: string;
  readonly isInstallQtBinaries: boolean;
  readonly setEnv: boolean;

  readonly aqtVersion: string;
  readonly py7zrVersion: string;

  constructor() {
    const host = core.getInput("host");
    // Set host automatically if omitted
    if (!host) {
      switch (process.platform) {
        case "win32": {
          this.host = "windows";
          break;
        }
        case "darwin": {
          this.host = "mac";
          break;
        }
        default: {
          this.host = "linux";
          break;
        }
      }
    } else {
      // Make sure host is one of the allowed values
      if (host === "windows" || host === "mac" || host === "linux") {
        this.host = host;
      } else {
        throw TypeError(`host: "${host}" is not one of "windows" | "mac" | "linux"`);
      }
    }

    const target = core.getInput("target");
    // Make sure target is one of the allowed values
    if (target === "desktop" || target === "android" || target === "ios") {
      this.target = target;
    } else {
      throw TypeError(`target: "${target}" is not one of "desktop" | "android" | "ios"`);
    }

    // An attempt to sanitize non-straightforward version number input
    this.version = core.getInput("version");

    this.arch = core.getInput("arch");
    // Set arch automatically if omitted
    if (!this.arch) {
      if (this.host === "windows") {
        if (compareVersions(this.version, ">=", "5.15.0")) {
          this.arch = "win64_msvc2019_64";
        } else if (compareVersions(this.version, "<", "5.6.0")) {
          this.arch = "win64_msvc2013_64";
        } else if (compareVersions(this.version, "<", "5.9.0")) {
          this.arch = "win64_msvc2015_64";
        } else {
          this.arch = "win64_msvc2017_64";
        }
      } else if (this.target === "android") {
        if (
          compareVersions(this.version, ">=", "5.14.0") &&
          compareVersions(this.version, "<", "6.0.0")
        ) {
          this.arch = "android";
        } else {
          this.arch = "android_armv7";
        }
      }
    }

    const dir = core.getInput("dir") || process.env.RUNNER_WORKSPACE;
    if (!dir) {
      throw TypeError(`"dir" input may not be empty`);
    }
    this.dir = `${dir}/Qt`;

    this.modules = Inputs.getStringArrayInput("modules");

    this.archives = Inputs.getStringArrayInput("archives");

    this.tools = Inputs.getStringArrayInput("tools").map(
      // The tools inputs have the tool name, variant, and arch delimited by a comma
      // aqt expects spaces instead
      (tool: string): string => tool.replace(/,/g, " ")
    );

    this.extra = Inputs.getStringArrayInput("extra");

    const installDeps = core.getInput("install-deps").toLowerCase();
    if (installDeps === "nosudo") {
      this.installDeps = "nosudo";
    } else {
      this.installDeps = installDeps === "true";
    }

    this.cache = Inputs.getBoolInput("cache");

    this.cacheKeyPrefix = core.getInput("cache-key-prefix");

    this.isInstallQtBinaries =
      !Inputs.getBoolInput("tools-only") && !Inputs.getBoolInput("no-qt-binaries");

    this.setEnv = Inputs.getBoolInput("set-env");

    this.aqtVersion = core.getInput("aqtversion");

    this.py7zrVersion = core.getInput("py7zrversion");

    this.src = Inputs.getBoolInput("source");
    this.srcArchives = Inputs.getStringArrayInput("src-archives");

    this.doc = Inputs.getBoolInput("documentation");
    this.docModules = Inputs.getStringArrayInput("doc-modules");
    this.docArchives = Inputs.getStringArrayInput("doc-archives");

    this.example = Inputs.getBoolInput("examples");
    this.exampleModules = Inputs.getStringArrayInput("example-modules");
    this.exampleArchives = Inputs.getStringArrayInput("example-archives");
  }

  public get cacheKey(): string {
    let cacheKey = this.cacheKeyPrefix;
    for (const keyStringArray of [
      [
        this.host,
        os.release(),
        this.target,
        this.arch,
        this.version,
        this.dir,
        this.py7zrVersion,
        this.aqtVersion,
      ],
      this.modules,
      this.archives,
      this.extra,
      this.tools,
      this.src ? "src" : "",
      this.srcArchives,
      this.doc ? "doc" : "",
      this.docArchives,
      this.docModules,
      this.example ? "example" : "",
      this.exampleArchives,
      this.exampleModules,
    ]) {
      for (const keyString of keyStringArray) {
        if (keyString) {
          cacheKey += `-${keyString}`;
        }
      }
    }
    // Cache keys cannot contain commas
    cacheKey = cacheKey.replace(/,/g, "-");
    // Cache keys cannot be larger than 512 characters
    const maxKeyLength = 512;
    if (cacheKey.length > maxKeyLength) {
      const hashedCacheKey = crypto.createHash("sha256").update(cacheKey).digest("hex");
      cacheKey = `${this.cacheKeyPrefix}-${hashedCacheKey}`;
    }
    return cacheKey;
  }

  private static getBoolInput(name: string): boolean {
    return core.getInput(name).toLowerCase() === "true";
  }
  private static getStringArrayInput(name: string): string[] {
    const content = core.getInput(name);
    return content ? content.split(" ") : [];
  }
}

const run = async (): Promise<void> => {
  try {
    const inputs = new Inputs();

    // Qt installer assumes basic requirements that are not installed by
    // default on Ubuntu.
    if (process.platform === "linux") {
      if (inputs.installDeps) {
        const dependencies = [
          "build-essential",
          "libgl1-mesa-dev",
          "libgstreamer-gl1.0-0",
          "libpulse-dev",
          "libxcb-glx0",
          "libxcb-icccm4",
          "libxcb-image0",
          "libxcb-keysyms1",
          "libxcb-randr0",
          "libxcb-render-util0",
          "libxcb-render0",
          "libxcb-shape0",
          "libxcb-shm0",
          "libxcb-sync1",
          "libxcb-util1",
          "libxcb-xfixes0",
          "libxcb-xinerama0",
          "libxcb1",
          "libxkbcommon-dev",
          "libxkbcommon-x11-0",
          "libxcb-xkb-dev",
        ].join(" ");
        const updateCommand = "apt-get update";
        const installCommand = `apt-get install ${dependencies} -y`;
        if (inputs.installDeps === "nosudo") {
          await exec(updateCommand);
          await exec(installCommand);
        } else {
          await exec(`sudo ${updateCommand}`);
          await exec(`sudo ${installCommand}`);
        }
      }
    }

    // Restore internal cache
    let internalCacheHit = false;
    if (inputs.cache) {
      const cacheHitKey = await cache.restoreCache([inputs.dir], inputs.cacheKey);
      if (cacheHitKey) {
        core.info(`Automatic cache hit with key "${cacheHitKey}"`);
        internalCacheHit = true;
      } else {
        core.info("Automatic cache miss, will cache this run");
      }
    }

    // Install Qt and tools if not cached
    if (!internalCacheHit) {
      // 7-zip is required, and not included on macOS
      if (process.platform === "darwin") {
        await exec("brew install p7zip");
      }

      // Install dependencies via pip
      await execPython("pip install", ["setuptools", "wheel", `"py7zr${inputs.py7zrVersion}"`]);

      // Install aqtinstall separately: allows aqtinstall to override py7zr if required
      await execPython("pip install", [`"aqtinstall${inputs.aqtVersion}"`]);

      // Install Qt
      if (inputs.isInstallQtBinaries) {
        const qtArgs = [
          inputs.host,
          inputs.target,
          inputs.version,
          ...(inputs.arch ? [inputs.arch] : []),
          ...["--outputdir", inputs.dir],
          ...flaggedList("--modules", inputs.modules),
          ...flaggedList("--archives", inputs.archives),
          ...inputs.extra,
        ];

        await execPython("aqt install-qt", qtArgs);
      }

      const installSrcDocExamples = async (
        flavor: "src" | "doc" | "example",
        archives: readonly string[],
        modules: readonly string[]
      ): Promise<void> => {
        const qtArgs = [
          inputs.host,
          // Aqtinstall < 2.0.4 requires `inputs.target` here, but that's deprecated
          inputs.version,
          ...["--outputdir", inputs.dir],
          ...flaggedList("--archives", archives),
          ...flaggedList("--modules", modules),
          ...inputs.extra,
        ];
        await execPython(`aqt install-${flavor}`, qtArgs);
      };

      // Install source, docs, & examples
      if (inputs.src) {
        await installSrcDocExamples("src", inputs.srcArchives, []);
      }
      if (inputs.doc) {
        await installSrcDocExamples("doc", inputs.docArchives, inputs.docModules);
      }
      if (inputs.example) {
        await installSrcDocExamples("example", inputs.exampleArchives, inputs.exampleModules);
      }

      // Install tools
      for (const tool of inputs.tools) {
        const toolArgs = [inputs.host, inputs.target, tool];
        toolArgs.push("--outputdir", inputs.dir);
        toolArgs.push(...inputs.extra);
        await execPython("aqt install-tool", toolArgs);
      }
    }

    // Save automatic cache
    if (!internalCacheHit && inputs.cache) {
      const cacheId = await cache.saveCache([inputs.dir], inputs.cacheKey);
      core.info(`Automatic cache saved with id ${cacheId}`);
    }

    // Set environment variables
    if (inputs.setEnv) {
      if (inputs.tools.length) {
        core.exportVariable("IQTA_TOOLS", nativePath(`${inputs.dir}/Tools`));
      }
      if (inputs.isInstallQtBinaries) {
        const qtPath = nativePath(locateQtArchDir(inputs.dir));
        if (process.platform === "linux") {
          setOrAppendEnvVar("LD_LIBRARY_PATH", nativePath(`${qtPath}/lib`));
        }
        if (process.platform !== "win32") {
          setOrAppendEnvVar("PKG_CONFIG_PATH", nativePath(`${qtPath}/lib/pkgconfig`));
        }
        // If less than qt6, set qt5_dir variable, otherwise set qt6_dir variable
        if (compareVersions(inputs.version, "<", "6.0.0")) {
          core.exportVariable("Qt5_Dir", qtPath); // Incorrect name that was fixed, but kept around so it doesn't break anything
          core.exportVariable("Qt5_DIR", qtPath);
        } else {
          core.exportVariable("Qt6_DIR", qtPath);
        }
        core.exportVariable("QT_PLUGIN_PATH", nativePath(`${qtPath}/plugins`));
        core.exportVariable("QML2_IMPORT_PATH", nativePath(`${qtPath}/qml`));
        core.addPath(nativePath(`${qtPath}/bin`));
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error);
    } else {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      core.setFailed(`unknown error: ${error}`);
    }
  }
};

void run();
