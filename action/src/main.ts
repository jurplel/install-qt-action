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

  readonly installDeps: boolean | "nosudo";
  readonly cache: boolean;
  readonly cacheKeyPrefix: string;
  readonly toolsOnly: boolean;
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

    const modules = core.getInput("modules");
    if (modules) {
      this.modules = modules.split(" ");
    } else {
      this.modules = [];
    }

    const archives = core.getInput("archives");
    if (archives) {
      this.archives = archives.split(" ");
    } else {
      this.archives = [];
    }

    const tools = core.getInput("tools");
    if (tools) {
      this.tools = [];
      for (const tool of tools.split(" ")) {
        // The tools inputs have the tool name, variant, and arch delimited by a comma
        // aqt expects spaces instead
        this.tools.push(tool.replace(/,/g, " "));
      }
    } else {
      this.tools = [];
    }

    const extra = core.getInput("extra");
    if (extra) {
      this.extra = extra.split(" ");
    } else {
      this.extra = [];
    }

    const installDeps = core.getInput("install-deps").toLowerCase();
    if (installDeps === "nosudo") {
      this.installDeps = "nosudo";
    } else {
      this.installDeps = installDeps === "true";
    }

    this.cache = Inputs.getBoolInput("cache");

    this.cacheKeyPrefix = core.getInput("cache-key-prefix");

    this.toolsOnly = Inputs.getBoolInput("tools-only");

    this.setEnv = Inputs.getBoolInput("set-env");

    this.aqtVersion = core.getInput("aqtversion");

    this.py7zrVersion = core.getInput("py7zrversion");
  }

  public get versionDir(): string {
    // Weird naming scheme exception for qt 5.9
    const version = this.version === "5.9.0" ? "5.9" : this.version;
    return nativePath(`${this.dir}/${version}`);
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
          "libxkbcommon-x11-0",
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

      // Install aqtinstall
      await execPython("pip install", [
        "setuptools",
        "wheel",
        `"py7zr${inputs.py7zrVersion}"`,
        `"aqtinstall${inputs.aqtVersion}"`,
      ]);

      // Install Qt
      if (!inputs.toolsOnly) {
        const qtArgs = [inputs.host, inputs.target, inputs.version];

        if (inputs.arch) {
          qtArgs.push(inputs.arch);
        }

        qtArgs.push("--outputdir", inputs.dir);

        if (inputs.modules.length) {
          qtArgs.push("--modules");
          for (const module of inputs.modules) {
            qtArgs.push(module);
          }
        }

        if (inputs.archives.length) {
          qtArgs.push("--archives");
          for (const archive of inputs.archives) {
            qtArgs.push(archive);
          }
        }

        qtArgs.push(...inputs.extra);

        await execPython("aqt install-qt", qtArgs);
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
    const qtPath = nativePath(glob.sync(`${inputs.versionDir}/**/*`)[0]);
    if (inputs.setEnv) {
      if (inputs.tools.length) {
        core.exportVariable("IQTA_TOOLS", nativePath(`${inputs.dir}/Tools`));
      }
      if (!inputs.toolsOnly) {
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
