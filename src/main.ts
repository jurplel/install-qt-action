import * as fs from "fs";
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as toolCache from '@actions/tool-cache';

async function run() {
  try {
    const initialInstallerPath = await toolCache.downloadTool("http://download.qt.io/official_releases/online_installers/qt-unified-windows-x86-online.exe");
    const initialInstallerScriptPath = await toolCache.downloadTool("https://raw.githubusercontent.com/jurplel/install-qt-action/master/qt-installer-noninteractive.qs");
    
    const installerPath = initialInstallerPath + ".exe";
    fs.renameSync(initialInstallerPath, installerPath);

    const installerScriptPath = initialInstallerScriptPath + ".qs";
    fs.renameSync(initialInstallerScriptPath, installerScriptPath);

    await exec.exec(`"${installerPath}"`, ["--verbose", `"--script ${installerScriptPath}"`])
  
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
