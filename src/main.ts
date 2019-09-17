import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as toolCache from '@actions/tool-cache';

async function run() {
  let installer = await toolCache.downloadTool("http://download.qt.io/official_releases/online_installers/qt-unified-windows-x86-online.exe");
  let installer_script = toolCache.downloadTool("https://raw.githubusercontent.com/jurplel/install-qt-action/master/qt-installer-noninteractive.qs");
  await exec.exec(`"${installer}"`, ['--verbose', `'--script ${installer_script}'`])
}

run();
