import * as fs from "fs";
import * as process from "process";
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as toolCache from '@actions/tool-cache';

async function run() {
  try {
    await exec.exec("pip install aqtinstall")
    await exec.exec("aqt install -O " + process.env.GITHUB_WORKSPACE + " 5.12.5 windows desktop")

  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
