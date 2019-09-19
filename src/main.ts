import * as fs from "fs";
import * as process from "process";
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as toolCache from '@actions/tool-cache';

async function run() {
  try {
    let version = "5.12.5"

    await exec.exec("pip install aqtinstall")
    await exec.exec("python -m aqt install -O " + process.env.GITHUB_WORKSPACE + " " + version + " windows desktop win64_msvc2017_64")
    let qtPath = process.env.GITHUB_WORKSPACE + "/Qt" + version + "/" + version + "/msvc2017_64";
    core.exportVariable('Qt5_Dir', qtPath);
    core.addPath(qtPath + "/bin");
    
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
