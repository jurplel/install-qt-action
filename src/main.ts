import * as process from "process";
import * as glob from "glob";
import * as compareVersions from "compare-versions";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as setupPython from "setup-python/dist";
import path from "path";

class Inputs {
  version: string;
  host: "windows" | "mac" | "linux";
  target: "desktop" | "android" | "ios";
  arch: string;
  dir: string;
  installDeps: boolean | "nosudo";
  modules: string[];
  archives: string[];
  cached: boolean;
  setupPython: boolean;
  tools: string[];
  setEnv: boolean;
  toolsOnly: boolean;
  aqtVersion: string;
  py7zrVersion: string;
  extra: string[];

  constructor() {
    this.version = core.getInput("version");
    // Weird naming scheme exception for qt 5.9
    if (this.version == "5.9.0") {
      this.version = "5.9";
    }

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
        throw TypeError(
          `host: "${host}" is not one of "desktop" | "android" | "ios"`
        );
      }
    }

    const target = core.getInput("target");
    // make sure target is one of the allowed values
    if (target == "desktop" || target == "android" || target == "ios") {
      this.target = target;
    } else {
      throw TypeError(
        `target: "${target}" is not one of "desktop" | "android" | "ios"`
      );
    }

    this.arch = core.getInput("arch");
    // set arch automatically if omitted
    if (!this.arch) {
      if (this.host == "windows") {
        if (compareVersions.compare(this.version, "5.15.0", ">=")) {
          // if version is greater than or equal to 5.15.0
          this.arch = "win64_msvc2019_64";
        } else if (compareVersions.compare(this.version, "5.6.0", "<")) {
          // if version earlier than 5.6
          this.arch = "win64_msvc2013_64";
        } else if (compareVersions.compare(this.version, "5.9.0", "<")) {
          // if version is earlier than 5.9
          this.arch = "win64_msvc2015_64";
        } else {
          // otherwise
          this.arch = "win64_msvc2017_64";
        }
      } else if (this.target == "android") {
        this.arch = "android_armv7";
      }
    }

    this.dir = (core.getInput("dir") || process.env.RUNNER_WORKSPACE) + "/Qt";

    const installDeps = core.getInput("install-deps");
    if (installDeps == "nosudo") {
      this.installDeps = "nosudo";
    } else {
      this.installDeps = installDeps == "true";
    }

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

    this.cached = core.getInput("cached") == "true";

    this.setupPython = core.getInput("setup-python") == "true";

    const tools = core.getInput("tools");
    if (tools) {
      this.tools = tools.split(" ");
    } else {
      this.tools = [];
    }

    this.setEnv = core.getInput("set-env") == "true";

    this.toolsOnly = core.getInput("tools-only") == "true";

    this.aqtVersion = core.getInput("aqtversion");

    this.py7zrVersion = core.getInput("py7zrversion");

    const extra = core.getInput("extra");
    if (extra) {
      this.extra = extra.split(" ");
    } else {
      this.extra = [];
    }
  }
}

const nativePath =
  process.platform === "win32" ? path.win32.normalize : path.normalize;

async function run() {
  try {
    const inputs = new Inputs();

    if (inputs.setupPython) {
      // Use setup-python to ensure that python >=3.6 is installed
      const installed = await setupPython.findPythonVersion(">=3.6", "x64");
      core.info(`Successfully setup ${installed.impl} (${installed.version})`);
    }

    // Qt installer assumes basic requirements that are not installed by
    // default on Ubuntu.
    if (process.platform == "linux") {
      const cmd0 = "apt-get update";
      const cmd1 = [
        "apt-get install",
        "build-essential",
        "libgl1-mesa-dev",
        "libxkbcommon-x11-0",
        "libpulse-dev",
        "libxcb-util1",
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
        "libxcb-xfixes0",
        "libxcb-xinerama0",
        "libxcb1",
        "-y",
      ].join(" ");
      if (inputs.installDeps) {
        if (inputs.installDeps == "nosudo") {
          await exec.exec(cmd0);
          await exec.exec(cmd1);
        } else {
          await exec.exec("sudo " + cmd0);
          await exec.exec("sudo " + cmd1);
        }
      }
    }

    if (!inputs.cached) {
      // 7-zip is required, and not included on macOS
      if (process.platform == "darwin") {
        await exec.exec("brew install p7zip");
      }

      //accomodate for differences in python 3 executable name
      let pythonName = "python3";
      if (process.platform == "win32") {
        pythonName = "python";
      }

      await exec.exec(pythonName + " -m pip install setuptools wheel");
      await exec.exec(
        pythonName + ' -m pip install "py7zr' + inputs.py7zrVersion + '"'
      );
      await exec.exec(
        pythonName + ' -m pip install "aqtinstall' + inputs.aqtVersion + '"'
      );

      //set args
      let args = [`${inputs.host}`, `${inputs.target}`, `${inputs.version}`];
      if (
        inputs.arch &&
        (inputs.host == "windows" ||
          inputs.target == "android" ||
          inputs.arch == "wasm_32")
      ) {
        args.push(inputs.arch);
      }

      if (inputs.modules.length) {
        args.push("-m");
        inputs.modules.forEach(function (currentModule) {
          args.push(currentModule);
        });
      }

      if (inputs.archives.length) {
        args.push("--archives");
        inputs.archives.forEach(function (currentArchive) {
          args.push(currentArchive);
        });
      }

      let extraArgs = ["-O", inputs.dir];

      if (inputs.extra.length) {
        inputs.extra.forEach(function (string) {
          extraArgs.push(string);
        });
      }

      args = args.concat(extraArgs);

      //run aqtinstall with args, and install tools if requested
      if (!inputs.toolsOnly) {
        await exec.exec(`${pythonName} -m aqt install-qt`, args);
      }
      if (inputs.tools.length) {
        inputs.tools.forEach(async (element) => {
          const elements = element.split(",");
          const toolName = elements[0];
          const variantName =
            elements.length > 1 ? elements[elements.length - 1] : "";
          await exec.exec(
            `${pythonName} -m aqt install-tool ${inputs.host} ${inputs.target} ${toolName} ${variantName}`,
            extraArgs
          );
        });
      }
    }

    //set environment variables

    let qtPath = inputs.dir + "/" + inputs.version;
    qtPath = nativePath(glob.sync(qtPath + "/**/*")[0]);
    if (inputs.setEnv) {
      if (inputs.tools.length) {
        core.exportVariable("IQTA_TOOLS", nativePath(inputs.dir + "/Tools"));
      }
      if (process.platform == "linux") {
        if (process.env.LD_LIBRARY_PATH) {
          core.exportVariable(
            "LD_LIBRARY_PATH",
            nativePath(process.env.LD_LIBRARY_PATH + ":" + qtPath + "/lib")
          );
        } else {
          core.exportVariable("LD_LIBRARY_PATH", nativePath(qtPath + "/lib"));
        }
      }
      if (process.platform != "win32") {
        if (process.env.PKG_CONFIG_PATH) {
          core.exportVariable(
            "PKG_CONFIG_PATH",
            nativePath(
              process.env.PKG_CONFIG_PATH + ":" + qtPath + "/lib/pkgconfig"
            )
          );
        } else {
          core.exportVariable(
            "PKG_CONFIG_PATH",
            nativePath(qtPath + "/lib/pkgconfig")
          );
        }
      }
      // If less than qt6, set qt5_dir variable, otherwise set qt6_dir variable
      if (compareVersions.compare(inputs.version, "6.0.0", "<")) {
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
