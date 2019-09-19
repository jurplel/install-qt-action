import * as fs from "fs";
import * as process from "process";
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as toolCache from '@actions/tool-cache';

async function run() {
  try {
    await exec.exec("pip install aqtinstall")
    await exec.exec("python -m aqt install -O " + process.env.GITHUB_WORKSPACE + " 5.12.5 windows desktop win64_msvc2017_64")

  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
