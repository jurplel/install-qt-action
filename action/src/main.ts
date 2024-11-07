import * as crypto from "crypto";
import * as os from "os";
import * as process from "process";

import * as cache from "@actions/cache";
import * as core from "@actions/core";
import { exec } from "@actions/exec";
import { nativePath, compareVersions, setOrAppendEnvVar, dirExists, toolsPaths, pythonCommand, execPython, getPythonOutput, flaggedList, locateQtArchDir, isAutodesktopSupported } from "./helpers";



class Inputs {
  readonly host: "windows" | "mac" | "linux";
  readonly target: "desktop" | "android" | "ios";
  readonly version: string;
  readonly arch: string;
  readonly dir: string;
  readonly modules: string[];
  readonly archives: string[];
  readonly tools: string[];
  readonly addToolsToPath: boolean;
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

  readonly aqtSource: string;
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
      if (this.target === "android") {
        if (
          compareVersions(this.version, ">=", "5.14.0") &&
          compareVersions(this.version, "<", "6.0.0")
        ) {
          this.arch = "android";
        } else {
          this.arch = "android_armv7";
        }
      } else if (this.host === "windows") {
        if (compareVersions(this.version, ">=", "6.7.3")) {
          this.arch = "win64_msvc2022_64";
        } else if (compareVersions(this.version, ">=", "5.15.0")) {
          this.arch = "win64_msvc2019_64";
        } else if (compareVersions(this.version, "<", "5.6.0")) {
          this.arch = "win64_msvc2013_64";
        } else if (compareVersions(this.version, "<", "5.9.0")) {
          this.arch = "win64_msvc2015_64";
        } else {
          this.arch = "win64_msvc2017_64";
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

    this.addToolsToPath = Inputs.getBoolInput("add-tools-to-path");

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

    this.aqtSource = core.getInput("aqtsource");
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
        this.aqtSource,
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
      ];

      // Qt 6.5.0 adds this requirement:
      // https://code.qt.io/cgit/qt/qtreleasenotes.git/about/qt/6.5.0/release-note.md
      if (compareVersions(inputs.version, ">=", "6.5.0")) {
        dependencies.push("libxcb-cursor0");
      }

      const updateCommand = "apt-get update";
      const installCommand = `apt-get install ${dependencies.join(" ")} -y`;
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
    // Install dependencies via pip
    await execPython("pip install", ["setuptools", "wheel", `"py7zr${inputs.py7zrVersion}"`]);

    // Install aqtinstall separately: allows aqtinstall to override py7zr if required
    if (inputs.aqtSource.length > 0) {
      await execPython("pip install", [`"${inputs.aqtSource}"`]);
    } else {
      await execPython("pip install", [`"aqtinstall${inputs.aqtVersion}"`]);
    }

    // This flag will install a parallel desktop version of Qt, only where required.
    // aqtinstall will automatically determine if this is necessary.
    const autodesktop = (await isAutodesktopSupported()) ? ["--autodesktop"] : [];

    // Install Qt
    if (inputs.isInstallQtBinaries) {
      const qtArgs = [
        inputs.host,
        inputs.target,
        inputs.version,
        ...(inputs.arch ? [inputs.arch] : []),
        ...autodesktop,
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

  // Add tools to path
  if (inputs.addToolsToPath && inputs.tools.length) {
    toolsPaths(inputs.dir).map(nativePath).forEach(core.addPath);
  }

  // Set environment variables/outputs for tools
  if (inputs.tools.length && inputs.setEnv) {
    core.exportVariable("IQTA_TOOLS", nativePath(`${inputs.dir}/Tools`));
  }
  // Set environment variables/outputs for binaries
  if (inputs.isInstallQtBinaries) {
    const qtPath = nativePath(locateQtArchDir(inputs.dir));
    // Set outputs
    core.setOutput("qtPath", qtPath);

    // Set env variables
    if (inputs.setEnv) {
      if (process.platform === "linux") {
        setOrAppendEnvVar("LD_LIBRARY_PATH", nativePath(`${qtPath}/lib`));
      }
      if (process.platform !== "win32") {
        setOrAppendEnvVar("PKG_CONFIG_PATH", nativePath(`${qtPath}/lib/pkgconfig`));
      }
      // If less than qt6, set Qt5_DIR variable
      if (compareVersions(inputs.version, "<", "6.0.0")) {
        core.exportVariable("Qt5_DIR", nativePath(`${qtPath}/lib/cmake`));
      }
      core.exportVariable("QT_ROOT_DIR", qtPath);
      core.exportVariable("QT_PLUGIN_PATH", nativePath(`${qtPath}/plugins`));
      core.exportVariable("QML2_IMPORT_PATH", nativePath(`${qtPath}/qml`));
      core.addPath(nativePath(`${qtPath}/bin`));
    }
  }
};

void run()
  .catch((err) => {
    if (err instanceof Error) {
      core.setFailed(err);
    } else {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      core.setFailed(`unknown error: ${err}`);
    }
    process.exit(1);
  })
  .then(() => {
    process.exit(0);
  });
