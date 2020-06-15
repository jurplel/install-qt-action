import * as process from "process";
import * as glob from "glob";
import * as semver from "semver";
import * as core from '@actions/core';
import * as exec from '@actions/exec';

async function run() {
    try {
      const dir = (core.getInput("dir") || process.env.RUNNER_WORKSPACE) + "/Qt";
      let version = core.getInput("version");

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

        await exec.exec("pip3 install setuptools wheel");
        await exec.exec("pip3 install \"py7zr" + core.getInput("py7zrversion") + "\"");
        await exec.exec("pip3 install \"aqtinstall" + core.getInput("aqtversion") + "\"");
        let host = core.getInput("host");
        const target = core.getInput("target");
        let arch = core.getInput("arch");
        const mirror = core.getInput("mirror");
        const extra = core.getInput("extra");
        const modules = core.getInput("modules");

        //fix errenous versions
        if (semver.lt(version, '5.10.0')) { // if version is less than 5.10.0
          if (semver.patch(version)) { // if patch number is 0
            version = version.substring(0, version.length-2); // remove last 2 digits
          }
        }

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
            arch = "win64_msvc2017_64";
            if (semver.gte(version, '5.15.0')) { // if version is greater than or equal to 5.15.0
              arch = "win64_msvc2019_64";
            }
          } else if (host == "android") {
            arch = "android_armv7";
          }
        }

        //set args
        let args = ["-O", `${dir}`, `${version}`, `${host}`, `${target}`];
        if (arch && (host == "windows" || target == "android")) {
          args.push(`${arch}`);
        }
        if (mirror) {
          args.push("-b");
          args.push(mirror);
        }
        if (extra) {
          extra.split(" ").forEach(function(string) {
            args.push(string);
          });
        }
        if (modules) {
          args.push("-m");
          modules.split(" ").forEach(function(currentModule) {
            args.push(currentModule);
          });
        }

        //accomodate for differences in python 3 executable name
        let pythonName = "python3";
        if (process.platform == "win32") {
          pythonName = "python";
        }

        //run aqtinstall with args
        await exec.exec(`${pythonName} -m aqt install`, args);
      }

      //set environment variables
      let qtPath = dir + "/" + version;
      qtPath = glob.sync(qtPath + '/**/*')[0];

      core.exportVariable('Qt5_Dir', qtPath); // Incorrect name that was fixed, but kept around so it doesn't break anything
      core.exportVariable('Qt5_DIR', qtPath);
      core.addPath(qtPath + "/bin");
    } catch (error) {
      core.setFailed(error.message);
    }
}

run();
