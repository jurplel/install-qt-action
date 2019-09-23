import * as process from "process";
import * as core from '@actions/core';
import * as exec from '@actions/exec';

async function run() {
  try {
    const home = core.getInput("dir") || process.env.RUNNER_WORKSPACE;
    const version = core.getInput("version");
    let host = core.getInput("host");
    let target = core.getInput("target");
    let arch = core.getInput("arch");

    console.log(process.env);

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
    
    if (!arch) {
      if (host == "windows") {
        arch = "win64_msvc2017_64";
      } else if (host == "android") {
        arch = "android_armv7";
      }
    }

    await exec.exec("pip3 install aqtinstall")
    await exec.exec("python3 -m aqt install", ["-O", `${home}`, `${version}`, `${host}`, `${target}`, `${arch}`]);

    let qtPath = home + "/Qt" + version + "/" + version + "/msvc2017_64";

    core.exportVariable('Qt5_Dir', qtPath);
    core.addPath(qtPath + "/bin");
    
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
