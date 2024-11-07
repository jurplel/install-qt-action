import * as glob from "glob";
import { compare, CompareOperator } from "compare-versions";
import * as path from "path";
import * as fs from "fs";
import * as core from "@actions/core";
import { exec, getExecOutput } from "@actions/exec";

export const nativePath = process.platform === "win32" ? path.win32.normalize : path.normalize;

export const compareVersions = (v1: string, op: CompareOperator, v2: string): boolean => {
  return compare(v1, v2, op);
};

export const setOrAppendEnvVar = (name: string, value: string): void => {
  const oldValue = process.env[name];
  let newValue = value;
  if (oldValue) {
    newValue = `${oldValue}:${newValue}`;
  }
  core.exportVariable(name, newValue);
};

export const dirExists = (dir: string): boolean => {
  try {
    return fs.statSync(dir).isDirectory();
  } catch (err) {
    return false;
  }
};

// Names of directories for tools (tools_conan & tools_ninja) that include binaries in the
// base directory instead of a bin directory (ie 'Tools/Conan', not 'Tools/Conan/bin')
const binlessToolDirectories = ["Conan", "Ninja"];

export const toolsPaths = (installDir: string): string[] => {
  const binlessPaths: string[] = binlessToolDirectories
    .map((dir) => `${installDir}/Tools/${dir}`)
    .filter((dir) => dirExists(dir));
  return [
    "Tools/**/bin",
    "*.app/Contents/MacOS",
    "*.app/**/bin",
    "Tools/*/*.app/Contents/MacOS",
    "Tools/*/*.app/**/bin",
  ]
    .flatMap((p: string): string[] => glob.sync(`${installDir}/${p}`))
    .concat(binlessPaths);
};

export const pythonCommand = (command: string, args: readonly string[]): string => {
  const python = process.platform === "win32" ? "python" : "python3";
  return `${python} -m ${command} ${args.join(" ")}`;
};
export const execPython = async (command: string, args: readonly string[]): Promise<number> => {
  return exec(pythonCommand(command, args));
};

export const getPythonOutput = async (command: string, args: readonly string[]): Promise<string> => {
  // Aqtinstall prints to both stderr and stdout, depending on the command.
  // This function assumes we don't care which is which, and we want to see it all.
  const out = await getExecOutput(pythonCommand(command, args));
  return out.stdout + out.stderr;
};

export const flaggedList = (flag: string, listArgs: readonly string[]): string[] => {
  return listArgs.length ? [flag, ...listArgs] : [];
};

export const locateQtArchDir = (installDir: string): string => {
  // For 6.4.2/gcc, qmake is at 'installDir/6.4.2/gcc_64/bin/qmake'.
  // This makes a list of all the viable arch directories that contain a qmake file.
  const qtArchDirs = glob
    .sync(`${installDir}/[0-9]*/*/bin/qmake*`)
    .map((s) => s.replace(/\/bin\/qmake[^/]*$/, ""));

  // For Qt6 mobile and wasm installations, and Qt6 Windows on ARM installations,
  // a standard desktop Qt installation must exist alongside the requested architecture.
  // In these cases, we must select the first item that ends with 'android*', 'ios', 'wasm*' or 'msvc*_arm64'.
  const requiresParallelDesktop = qtArchDirs.filter((p) =>
    p.match(/6\.\d+\.\d+\/(android[^/]*|ios|wasm[^/]*|msvc[^/]*_arm64)$/)
  );
  if (requiresParallelDesktop.length) {
    // NOTE: if multiple mobile/wasm installations coexist, this may not select the desired directory
    return requiresParallelDesktop[0];
  } else if (!qtArchDirs.length) {
    throw Error(`Failed to locate a Qt installation directory in ${installDir}`);
  } else {
    // NOTE: if multiple Qt installations exist, this may not select the desired directory
    return qtArchDirs[0];
  }
};

export const isAutodesktopSupported = async (): Promise<boolean> => {
  const rawOutput = await getPythonOutput("aqt", ["version"]);
  const match = rawOutput.match(/aqtinstall\(aqt\)\s+v(\d+\.\d+\.\d+)/);
  return match ? compareVersions(match[1], ">=", "3.0.0") : false;
};
