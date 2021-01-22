import * as process from "process";
import * as glob from "glob";
import * as compareVersions from "compare-versions";
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as setupPython from 'setup-python/lib/find-python'

async function run() {
    try {
      if (core.getInput("setup-python") == "true") {
        // Use setup-python to ensure that python >=3.6 is installed
        const installed = await setupPython.findPythonVersion('>=3.6', 'x64')
        core.info(`Successfully setup ${installed.impl} (${installed.version})`)
      }

      const dir = (core.getInput("dir") || process.env.RUNNER_WORKSPACE) + "/Qt";
      let version = core.getInput("version");
      const tools = core.getInput("tools");
      const setEnv = core.getInput("set-env");

      // Qt installer assumes basic requirements that are not installed by
      // default on Ubuntu.
      if (process.platform == "linux" && core.getInput("install-deps") == "true") {
        await exec.exec("sudo apt-get update")
        await exec.exec("sudo apt-get install build-essential libgl1-mesa-dev libxkbcommon-x11-0 libpulse-dev -y")
      }

      if (core.getInput("cached") != "true") {
        // 7-zip is required, and not included on macOS
        if (process.platform == "darwin") {
          await exec.exec("brew install p7zip")
        }

        //accomodate for differences in python 3 executable name
        let pythonName = "python3";
        if (process.platform == "win32") {
          pythonName = "python";
        }

        await exec.exec(pythonName + " -m pip install setuptools wheel");
        await exec.exec(pythonName + " -m pip install \"py7zr" + core.getInput("py7zrversion") + "\"");
        await exec.exec(pythonName + " -m pip install \"aqtinstall" + core.getInput("aqtversion") + "\"");
        let host = core.getInput("host");
        const target = core.getInput("target");
        let arch = core.getInput("arch");
        const extra = core.getInput("extra");
        const modules = core.getInput("modules");

        //set host automatically if omitted
        if (!host) {
          switch(process.platform) {
            case "win32": {
                host = "windows";
                break;
            }
            case "darwin": {
                host = "mac";
                break;
            }
            default: {
                host = "linux";
                break;
            }
          }
        }

        //set arch automatically if omitted
        if (!arch) {
          if (host == "windows") {
            if (compareVersions.compare(version, '5.15.0', '>=')) { // if version is greater than or equal to 5.15.0
              arch = "win64_msvc2019_64";
            } else if (compareVersions.compare(version, '5.6.0', '<')) { // if version earlier than 5.6
              arch = "win64_msvc2013_64";
            } else if (compareVersions.compare(version, '5.9.0', '<')) { // if version is earlier than 5.9
              arch = "win64_msvc2015_64";
            } else { // otherwise
              arch = "win64_msvc2017_64";
            }
          } else if (host == "android") {
            arch = "android_armv7";
          }
        }

        //set args
        let args = [`${version}`, `${host}`, `${target}`];
        if (arch && ((host == "windows" || target == "android") || arch == "wasm_32")) {
          args.push(`${arch}`);
        }

        if (modules) {
          args.push("-m");
          modules.split(" ").forEach(function(currentModule) {
            args.push(currentModule);
          });
        }

        let extraArgs = ["-O", `${dir}`]

        if (extra) {
          extra.split(" ").forEach(function(string) {
            extraArgs.push(string);
          });
        }

        args = args.concat(extraArgs);

        //run aqtinstall with args, and install tools if requested
        if (core.getInput("tools-only") != "true") {
          await exec.exec(`${pythonName} -m aqt install`, args);
        }
        if (tools) {
          tools.split(" ").forEach(async element => {
            let elements = element.split(",");
            await exec.exec(`${pythonName} -m aqt tool ${host} ${elements[0]} ${elements[1]} ${elements[2]}`, extraArgs);
          });
        }
      }

      //set environment variables
      let qtPath = dir + "/" + version;
      qtPath = glob.sync(qtPath + '/**/*')[0];
      if (setEnv == "true") {
        if (tools) {
            core.exportVariable('IQTA_TOOLS', dir + "/Tools");
        }
        if (process.platform == "linux") {
            if (process.env.LD_LIBRARY_PATH) {
                core.exportVariable('LD_LIBRARY_PATH', process.env.LD_LIBRARY_PATH + ":" + qtPath + "/lib");
            } else {
                core.exportVariable('LD_LIBRARY_PATH', qtPath + "/lib");
            }
        }
        // If less than qt6, set qt5_dir variable, otherwise set qt6_dir variable
        if (compareVersions.compare(version, '6.0.0', '<')) {
          core.exportVariable('Qt5_Dir', qtPath); // Incorrect name that was fixed, but kept around so it doesn't break anything
          core.exportVariable('Qt5_DIR', qtPath);
        } else {
          core.exportVariable('Qt6_DIR', qtPath);
        }
        core.exportVariable('QT_PLUGIN_PATH', qtPath + '/plugins');
        core.exportVariable('QML2_IMPORT_PATH', qtPath + '/qml');
        core.addPath(qtPath + "/bin");
      }
    } catch (error) {
      core.setFailed(error.message);
    }
}

run();
