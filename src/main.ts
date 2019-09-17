import * as core from '@actions/core';
import * as toolCache from '@actions/tool-cache';

async function run() {
  let installer = await toolCache.downloadTool("http://download.qt.io/official_releases/online_installers/qt-unified-windows-x86-online.exe");
}

run();
