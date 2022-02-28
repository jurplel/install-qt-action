import * as path from "path";
import * as process from "process";

import * as core from "@actions/core";
import { exec } from "@actions/exec";
import { findPythonVersion as setupPython } from /* @actions/ */ "setup-python/lib/find-python";

import * as glob from "glob";
import { compare, CompareOperator } from "compare-versions";

const nativePath = process.platform === "win32" ? path.win32.normalize : path.normalize;

const compareVersions = (v1: string, op: CompareOperator, v2: string) => compare(v1, v2, op);

const setOrAppendEnvVar = (name: string, value: string) => {
  const oldValue = process.env[name];
  let newValue = value;
  if (oldValue) {
    newValue = `${oldValue}:${newValue}`;
  }
  core.exportVariable(name, newValue);
};

const execPython = async (command: string, args: string[]) => {
  const python = process.platform == "win32" ? "python" : "python3";
  await exec(`${python} -m ${command} ${args.join(" ")}`);
};

class Inputs {
  host: "windows" | "mac" | "linux";
  target: "desktop" | "android" | "ios";
  version: string;
  arch: string;
  dir: string;
  modules: string[];
  archives: string[];
  tools: string[];
  extra: string[];

  setupPython: boolean;
  installDeps: boolean | "nosudo";
  cached: boolean;
  toolsOnly: boolean;
  setEnv: boolean;

  aqtVersion: string;
  py7zrVersion: string;

  public get versionDir(): string {
    // Weird naming scheme exception for qt 5.9
    const version = this.version == "5.9.0" ? "5.9" : this.version;
    return nativePath(`${this.dir}/${version}`);
  }

  constructor() {
    const host = core.getInput("host");
    // set host automatically if omitted
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
      // make sure host is one of the allowed values
      if (host == "windows" || host == "mac" || host == "linux") {
        this.host = host;
      } else {
        throw TypeError(`host: "${host}" is not one of "windows" | "mac" | "linux"`);
      }
    }

    const target = core.getInput("target");
    // make sure target is one of the allowed values
    if (target == "desktop" || target == "android" || target == "ios") {
      this.target = target;
    } else {
      throw TypeError(`target: "${target}" is not one of "desktop" | "android" | "ios"`);
    }

    this.version = core.getInput("version");

    this.arch = core.getInput("arch");
    // set arch automatically if omitted
    if (!this.arch) {
      if (this.host == "windows") {
        if (compareVersions(this.version, ">=", "5.15.0")) {
          this.arch = "win64_msvc2019_64";
        } else if (compareVersions(this.version, "<", "5.6.0")) {
          this.arch = "win64_msvc2013_64";
        } else if (compareVersions(this.version, "<", "5.9.0")) {
          this.arch = "win64_msvc2015_64";
        } else {
          this.arch = "win64_msvc2017_64";
        }
      } else if (this.target == "android") {
        this.arch = "android_armv7";
      }
    }

    const dir = core.getInput("dir") || process.env.RUNNER_WORKSPACE;
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
        // the tools inputs have the tool name and tool variant delimited by a comma
        // aqt needs a space instead
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

    this.setupPython = core.getInput("setup-python") == "true";

    const installDeps = core.getInput("install-deps");
    if (installDeps == "nosudo") {
      this.installDeps = "nosudo";
    } else {
      this.installDeps = installDeps == "true";
    }

    this.cached = core.getInput("cached") == "true";

    this.toolsOnly = core.getInput("tools-only") == "true";

    this.setEnv = core.getInput("set-env") == "true";

    this.aqtVersion = core.getInput("aqtversion");

    this.py7zrVersion = core.getInput("py7zrversion");
  }
}

async function run() {
  try {
    const inputs = new Inputs();

    if (inputs.setupPython) {
      // Use @actions/setup-python to ensure that python >=3.6 is installed
      const installed = await setupPython(">=3.6", "x64");
      core.info(`Successfully setup ${installed.impl} (${installed.version})`);
    }

    // Qt installer assumes basic requirements that are not installed by
    // default on Ubuntu.
    if (process.platform == "linux") {
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
        if (inputs.installDeps == "nosudo") {
          await exec(updateCommand);
          await exec(installCommand);
        } else {
          await exec(`sudo ${updateCommand}`);
          await exec(`sudo ${installCommand}`);
        }
      }
    }

    if (!inputs.cached) {
      // 7-zip is required, and not included on macOS
      if (process.platform == "darwin") {
        await exec("brew install p7zip");
      }

      // install aqtinstall
      await execPython("pip install", [
        "setuptools",
        "wheel",
        `"py7zr${inputs.py7zrVersion}"`,
        `"aqtinstall${inputs.aqtVersion}"`,
      ]);

      // install qt
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

      // install tools
      for (const tool of inputs.tools) {
        const toolArgs = [inputs.host, inputs.target, tool];
        toolArgs.push("--outputdir", inputs.dir);
        toolArgs.push(...inputs.extra);
        await execPython("aqt install-tool", toolArgs);
      }
    }

    // set environment variables

    const qtPath = nativePath(glob.sync(inputs.versionDir + "/**/*")[0]);
    if (inputs.setEnv) {
      if (inputs.tools) {
        core.exportVariable("IQTA_TOOLS", nativePath(inputs.dir + "/Tools"));
      }
      if (process.platform == "linux") {
        setOrAppendEnvVar("LD_LIBRARY_PATH", nativePath(qtPath + "/lib"));
      }
      if (process.platform != "win32") {
        setOrAppendEnvVar("PKG_CONFIG_PATH", nativePath(qtPath + "/lib/pkgconfig"));
      }
      // If less than qt6, set qt5_dir variable, otherwise set qt6_dir variable
      if (compareVersions(inputs.version, "<", "6.0.0")) {
        core.exportVariable("Qt5_Dir", qtPath); // Incorrect name that was fixed, but kept around so it doesn't break anything
        core.exportVariable("Qt5_DIR", qtPath);
      } else {
        core.exportVariable("Qt6_DIR", qtPath);
      }
      core.exportVariable("QT_PLUGIN_PATH", nativePath(qtPath + "/plugins"));
      core.exportVariable("QML2_IMPORT_PATH", nativePath(qtPath + "/qml"));
      core.addPath(nativePath(qtPath + "/bin"));
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error);
    } else {
      core.setFailed(`unknown error: ${error}`);
    }
  }
}

run();
