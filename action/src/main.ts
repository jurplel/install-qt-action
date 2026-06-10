import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as process from "process";

import * as cache from "@actions/cache";
import * as core from "@actions/core";
import { exec, getExecOutput } from "@actions/exec";

import * as glob from "glob";
import { compare, CompareOperator } from "compare-versions";
import "source-map-support/register";

const compareVersions = (v1: string, op: CompareOperator, v2: string): boolean => {
  return compare(v1, v2, op);
};

const setOrAppendEnvVar = (name: string, value: string): void => {
  const oldValue = process.env[name];
  let newValue = value;
  if (oldValue) {
    newValue = `${oldValue}:${newValue}`;
  }
  core.exportVariable(name, newValue);
};

const dirExists = (dir: string): boolean => {
  try {
    return fs.statSync(dir).isDirectory();
  } catch (err) {
    return false;
  }
};

// Names of directories for tools (tools_conan & tools_ninja) that include binaries in the
// base directory instead of a bin directory (ie 'Tools/Conan', not 'Tools/Conan/bin')
const binlessToolDirectories = ["Conan", "Ninja"];

const toolsPaths = (installDir: string): string[] => {
  const binlessPaths: string[] = binlessToolDirectories
    .map((dir) => path.join(installDir, "Tools", dir))
    .filter((dir) => dirExists(dir));
  return [
    "Tools/**/bin",
    "*.app/Contents/MacOS",
    "*.app/**/bin",
    "Tools/*/*.app/Contents/MacOS",
    "Tools/*/*.app/**/bin",
  ]
    .flatMap((p: string): string[] => glob.sync(`${installDir}/${p}`))
    .concat(binlessPaths)
    .map((p) => path.resolve(p));
};

const pythonCommand = (command: string, args: readonly string[]): string => {
  const python = process.platform === "win32" ? "python" : "python3";
  return `${python} -m ${command} ${args.join(" ")}`;
};

const execPython = async (command: string, args: readonly string[]): Promise<number> => {
  return exec(pythonCommand(command, args));
};

const getPythonOutput = async (command: string, args: readonly string[]): Promise<string> => {
  // Aqtinstall prints to both stderr and stdout, depending on the command.
  // This function assumes we don't care which is which, and we want to see it all.
  const out = await getExecOutput(pythonCommand(command, args));
  return out.stdout + out.stderr;
};

const flaggedList = (flag: string, listArgs: readonly string[]): string[] => {
  return listArgs.length ? [flag, ...listArgs] : [];
};

const locateQtArchDir = (installDir: string, host: string): [string, boolean] => {
  // For 6.4.2/gcc, qmake is at 'installDir/6.4.2/gcc_64/bin/qmake'.
  // This makes a list of all the viable arch directories that contain a qmake file.
  const qtArchDirs = glob
    .sync(`${installDir}/[0-9]*/*/bin/qmake*`)
    .map((s) => path.resolve(s, "..", ".."));

  // For Qt6 mobile and wasm installations, and Qt6 Windows on ARM cross-compiled installations,
  // a standard desktop Qt installation must exist alongside the requested architecture.
  // In these cases, we must select the first item that ends with 'android*', 'ios', 'wasm*' or 'msvc*_arm64'.
  const requiresParallelDesktop = qtArchDirs.filter((archPath) => {
    const archDir = path.basename(archPath);
    const versionDir = path.basename(path.join(archPath, ".."));
    return (
      versionDir.match(/^6\.\d+\.\d+$/) &&
      (archDir.match(/^(android.*|ios|wasm.*)$/) ||
        (archDir.match(/^msvc.*_arm64$/) && host !== "windows_arm64"))
    );
  });
  if (requiresParallelDesktop.length) {
    // NOTE: if multiple mobile/wasm installations coexist, this may not select the desired directory
    return [requiresParallelDesktop[0], true];
  } else if (!qtArchDirs.length) {
    throw Error(`Failed to locate a Qt installation directory in  ${installDir}`);
  } else {
    // NOTE: if multiple Qt installations exist, this may not select the desired directory
    return [qtArchDirs[0], false];
  }
};

const isAutodesktopSupported = async (): Promise<boolean> => {
  const rawOutput = await getPythonOutput("aqt", ["version"]);
  const match = rawOutput.match(/aqtinstall\(aqt\)\s+v(\d+\.\d+\.\d+)/);
  return match ? compareVersions(match[1], ">=", "3.0.0") : false;
};

type Inputs = {
  readonly host: "windows" | "windows_arm64" | "mac" | "linux" | "linux_arm64" | "all_os";
  readonly target: "desktop" | "android" | "ios" | "wasm";
  readonly version: string;
  readonly arch: string;
  readonly dir: string;
  readonly modules: string[];
  readonly archives: string[];
  readonly tools: string[];
  readonly addToolsToPath: boolean;
  readonly extra: string[];

  readonly src: boolean;
  readonly srcArchives: string[];

  readonly doc: boolean;
  readonly docArchives: string[];
  readonly docModules: string[];

  readonly example: boolean;
  readonly exampleArchives: string[];
  readonly exampleModules: string[];

  readonly installDeps: boolean | "nosudo";
  readonly cache: boolean;
  readonly cacheKeyPrefix: string;
  readonly isInstallQtBinaries: boolean;
  readonly setEnv: boolean;

  readonly aqtSource: string;
  readonly aqtVersion: string;
  readonly py7zrVersion: string;

  readonly useOfficial: boolean;
  readonly email: string;
  readonly pw: string;
};

const resolveInputs = async (): Promise<{ inputs: Inputs; cacheKey: string }> => {
  const parseBoolInput = (input: string): boolean => {
    return input.toLowerCase() === "true";
  };
  const parseStringArrayInput = (input: string): string[] => {
    return input ? input.split(" ") : [];
  };

  const fetchRequestedQtVersion = async (
    host: string,
    target: string,
    version: string
  ): Promise<string> => {
    core.info(`Resolving Qt version ${version}...`);
    const rawOutput = await getPythonOutput("aqt", [
      "list-qt",
      host,
      target,
      "--spec",
      version,
      "--latest-version",
    ]);
    const match = rawOutput.trim().match(/^\d+\.\d+\.\d+$/);
    if (!match) {
      throw Error(`No available Qt version found by specified inputs. Output:\n${rawOutput}`);
    }
    return match[0];
  };

  // The order of properties should match the "inputs" definition in
  // "action/action.yml" for readability.
  const rawInputs = {
    dir: core.getInput("dir"),
    version: core.getInput("version"),
    host: core.getInput("host"),
    target: core.getInput("target"),
    arch: core.getInput("arch"),
    installDeps: core.getInput("install-deps"),
    modules: core.getInput("modules"),
    archives: core.getInput("archives"),
    cache: core.getInput("cache"),
    cacheKeyPrefix: core.getInput("cache-key-prefix"),
    tools: core.getInput("tools"),
    addToolsToPath: core.getInput("add-tools-to-path"),
    setEnv: core.getInput("set-env"),
    noQtBinaries: core.getInput("no-qt-binaries"),
    toolsOnly: core.getInput("tools-only"),
    aqtSource: core.getInput("aqtsource"),
    aqtVersion: core.getInput("aqtversion"),
    py7zrVersion: core.getInput("py7zrversion"),
    extra: core.getInput("extra"),
    source: core.getInput("source"),
    srcArchives: core.getInput("src-archives"),
    documentation: core.getInput("documentation"),
    docArchives: core.getInput("doc-archives"),
    docModules: core.getInput("doc-modules"),
    examples: core.getInput("examples"),
    exampleArchives: core.getInput("example-archives"),
    exampleModules: core.getInput("example-modules"),
    useOfficial: core.getInput("use-official"),
    email: core.getInput("email"),
    pw: core.getInput("pw"),
  };

  // The "version" property will be populated per remote data fetched by aqt,
  // so installing aqt and related packages is required here.
  {
    // Install dependencies via pip
    await execPython("pip install", ["setuptools>=70.1.0", `"py7zr${rawInputs.py7zrVersion}"`]);

    // Install aqtinstall separately: allows aqtinstall to override py7zr if required
    if (rawInputs.aqtSource.length > 0) {
      await execPython("pip install", [`"${rawInputs.aqtSource}"`]);
    } else {
      await execPython("pip install", [`"aqtinstall${rawInputs.aqtVersion}"`]);
    }
  }

  const host = ((): "windows" | "windows_arm64" | "mac" | "linux" | "linux_arm64" | "all_os" => {
    // Set host automatically if omitted
    if (!rawInputs.host) {
      switch (process.platform) {
        case "win32": {
          return process.arch === "arm64" ? "windows_arm64" : "windows";
        }
        case "darwin": {
          return "mac";
        }
        default: {
          return process.arch === "arm64" ? "linux_arm64" : "linux";
        }
      }
    } else {
      // Make sure host is one of the allowed values
      if (
        rawInputs.host === "windows" ||
        rawInputs.host === "windows_arm64" ||
        rawInputs.host === "mac" ||
        rawInputs.host === "linux" ||
        rawInputs.host === "linux_arm64" ||
        rawInputs.host === "all_os"
      ) {
        return rawInputs.host;
      } else {
        throw TypeError(
          `host: "${rawInputs.host}" is not one of "windows" | "windows_arm64" | "mac" | "linux" | "linux_arm64" | "all_os"`
        );
      }
    }
  })();

  const target = ((): "android" | "desktop" | "ios" | "wasm" => {
    // Make sure target is one of the allowed values
    if (
      rawInputs.target === "desktop" ||
      rawInputs.target === "android" ||
      rawInputs.target === "ios" ||
      rawInputs.target === "wasm"
    ) {
      return rawInputs.target;
    } else {
      throw TypeError(
        `target: "${rawInputs.target}" is not one of "desktop" | "android" | "ios" | "wasm"`
      );
    }
  })();

  // The aqtinstall supports SimpleSpec (semver). To make all "compareVersions()" happy,
  // we have to fetch the requested Qt version here and always use that version in all
  // subsequent work, for example, generating cache key.
  const version = await fetchRequestedQtVersion(host, target, rawInputs.version);

  const arch = ((): string => {
    // Set arch automatically if omitted
    if (!rawInputs.arch) {
      if (target === "android") {
        if (compareVersions(version, ">=", "5.14.0") && compareVersions(version, "<", "6.0.0")) {
          return "android";
        } else {
          return "android_armv7";
        }
      } else if (host === "windows") {
        if (compareVersions(version, ">=", "6.8.0")) {
          return "win64_msvc2022_64";
        } else if (compareVersions(version, ">=", "5.15.0")) {
          return "win64_msvc2019_64";
        } else if (compareVersions(version, "<", "5.6.0")) {
          return "win64_msvc2013_64";
        } else if (compareVersions(version, "<", "5.9.0")) {
          return "win64_msvc2015_64";
        } else {
          return "win64_msvc2017_64";
        }
      } else if (host === "windows_arm64") {
        return "win64_msvc2022_arm64";
      }
    }
    return rawInputs.arch;
  })();

  const inputs = {
    host: host,
    target: target,
    version: version,
    arch: arch,

    dir: ((): string => {
      const dir = rawInputs.dir || process.env.RUNNER_WORKSPACE;
      if (!dir) {
        throw TypeError(`"dir" input may not be empty`);
      }
      return path.resolve(dir, "Qt");
    })(),

    modules: parseStringArrayInput(rawInputs.modules),

    archives: parseStringArrayInput(rawInputs.archives),

    tools: parseStringArrayInput(rawInputs.tools).map(
      // The tools inputs have the tool name, variant, and arch delimited by a comma
      // aqt expects spaces instead
      (tool: string): string => tool.replace(/,/g, " ")
    ),

    addToolsToPath: parseBoolInput(rawInputs.addToolsToPath),

    extra: parseStringArrayInput(rawInputs.extra),

    installDeps: ((): boolean | "nosudo" => {
      if (rawInputs.installDeps.toLowerCase() === "nosudo") {
        return "nosudo";
      } else {
        return parseBoolInput(rawInputs.installDeps);
      }
    })(),

    cache: parseBoolInput(rawInputs.cache),

    cacheKeyPrefix: rawInputs.cacheKeyPrefix,

    isInstallQtBinaries:
      !parseBoolInput(rawInputs.toolsOnly) && !parseBoolInput(rawInputs.noQtBinaries),

    setEnv: parseBoolInput(rawInputs.setEnv),

    aqtSource: rawInputs.aqtSource,
    aqtVersion: rawInputs.aqtVersion,

    py7zrVersion: rawInputs.py7zrVersion,

    useOfficial: parseBoolInput(rawInputs.useOfficial),
    email: rawInputs.email,
    pw: rawInputs.pw,

    src: parseBoolInput(rawInputs.source),
    srcArchives: parseStringArrayInput(rawInputs.srcArchives),

    doc: parseBoolInput(rawInputs.documentation),
    docModules: parseStringArrayInput(rawInputs.docModules),
    docArchives: parseStringArrayInput(rawInputs.docArchives),

    example: parseBoolInput(rawInputs.examples),
    exampleModules: parseStringArrayInput(rawInputs.exampleModules),
    exampleArchives: parseStringArrayInput(rawInputs.exampleArchives),
  };

  // Then, generate the cache key with the exact available Qt version.
  const cacheKey = ((): string => {
    let _cacheKey = inputs.cacheKeyPrefix;
    for (const keyStringArray of [
      [
        inputs.host,
        os.release(),
        inputs.target,
        inputs.arch,
        inputs.version,
        inputs.dir,
        inputs.py7zrVersion,
        inputs.aqtSource,
        inputs.aqtVersion,
        inputs.useOfficial ? "official" : "",
      ],
      inputs.modules,
      inputs.archives,
      inputs.extra,
      inputs.tools,
      inputs.src ? "src" : "",
      inputs.srcArchives,
      inputs.doc ? "doc" : "",
      inputs.docArchives,
      inputs.docModules,
      inputs.example ? "example" : "",
      inputs.exampleArchives,
      inputs.exampleModules,
    ]) {
      for (const keyString of keyStringArray) {
        if (keyString) {
          _cacheKey += `-${keyString}`;
        }
      }
    }
    // Cache keys cannot contain commas
    _cacheKey = _cacheKey.replace(/,/g, "-");
    // Cache keys cannot be larger than 512 characters
    const maxKeyLength = 512;
    if (_cacheKey.length > maxKeyLength) {
      const hashedCacheKey = crypto.createHash("sha256").update(_cacheKey).digest("hex");
      _cacheKey = `${inputs.cacheKeyPrefix}-${hashedCacheKey}`;
    }
    return _cacheKey;
  })();

  return { inputs, cacheKey };
};

const run = async (): Promise<void> => {
  const { inputs, cacheKey } = await resolveInputs();

  // Qt installer assumes basic requirements that are not installed by
  // default on Ubuntu.
  if (process.platform === "linux") {
    if (inputs.installDeps) {
      const dependencies = [
        "build-essential",
        "libgl1-mesa-dev",
        "libgstreamer-gl1.0-0",
        "libpulse-dev",
        "libxcb-glx0",
        "libxcb-icccm4",
        "libxcb-image0",
        "libxcb-keysyms1",
        "libxcb-randr0",
        "libxcb-render-util0",
        "libxcb-render0",
        "libxcb-shape0",
        "libxcb-shm0",
        "libxcb-sync1",
        "libxcb-util1",
        "libxcb-xfixes0",
        "libxcb-xinerama0",
        "libxcb1",
        "libxkbcommon-dev",
        "libxkbcommon-x11-0",
        "libxcb-xkb-dev",
      ];

      // Qt 6.5.0 adds this requirement:
      // https://code.qt.io/cgit/qt/qtreleasenotes.git/about/qt/6.5.0/release-note.md
      if (compareVersions(inputs.version, ">=", "6.5.0")) {
        dependencies.push("libxcb-cursor0");
      }

      const updateCommand = "apt-get update";
      const installCommand = `apt-get install ${dependencies.join(" ")} -y`;
      if (inputs.installDeps === "nosudo") {
        await exec(updateCommand);
        await exec(installCommand);
      } else {
        await exec(`sudo ${updateCommand}`);
        await exec(`sudo ${installCommand}`);
      }
    }
  }

  // Restore internal cache
  let internalCacheHit = false;
  if (inputs.cache) {
    const cacheHitKey = await cache.restoreCache([inputs.dir], cacheKey);
    if (cacheHitKey) {
      core.info(`Automatic cache hit with key "${cacheHitKey}"`);
      internalCacheHit = true;
    } else {
      core.info("Automatic cache miss, will cache this run");
    }
  }

  // Install Qt and tools if not cached
  if (!internalCacheHit) {
    // This flag will install a parallel desktop version of Qt, only where required.
    // aqtinstall will automatically determine if this is necessary.
    const autodesktop = (await isAutodesktopSupported()) ? ["--autodesktop"] : [];

    // Install Qt
    if (inputs.isInstallQtBinaries) {
      if (inputs.useOfficial && inputs.email && inputs.pw) {
        const qtArgs = [
          "install-qt-official",
          inputs.target,
          ...(inputs.arch ? [inputs.arch] : []),
          inputs.version,
          ...["--outputdir", inputs.dir],
          ...["--email", inputs.email],
          ...["--pw", inputs.pw],
          ...flaggedList("--modules", inputs.modules),
          ...inputs.extra,
        ];
        await execPython("aqt", qtArgs);
      } else {
        const qtArgs = [
          "install-qt",
          inputs.host,
          inputs.target,
          inputs.version,
          ...(inputs.arch ? [inputs.arch] : []),
          ...autodesktop,
          ...["--outputdir", inputs.dir],
          ...flaggedList("--modules", inputs.modules),
          ...flaggedList("--archives", inputs.archives),
          ...inputs.extra,
        ];
        await execPython("aqt", qtArgs);
      }
    }

    const installSrcDocExamples = async (
      flavor: "src" | "doc" | "example",
      archives: readonly string[],
      modules: readonly string[]
    ): Promise<void> => {
      const qtArgs = [
        inputs.host,
        // Aqtinstall < 2.0.4 requires `inputs.target` here, but that's deprecated
        inputs.version,
        ...["--outputdir", inputs.dir],
        ...flaggedList("--archives", archives),
        ...flaggedList("--modules", modules),
        ...inputs.extra,
      ];
      await execPython(`aqt install-${flavor}`, qtArgs);
    };

    // Install source, docs, & examples
    if (inputs.src) {
      await installSrcDocExamples("src", inputs.srcArchives, []);
    }
    if (inputs.doc) {
      await installSrcDocExamples("doc", inputs.docArchives, inputs.docModules);
    }
    if (inputs.example) {
      await installSrcDocExamples("example", inputs.exampleArchives, inputs.exampleModules);
    }

    // Install tools
    for (const tool of inputs.tools) {
      const toolArgs = [inputs.host, inputs.target, tool];
      toolArgs.push("--outputdir", inputs.dir);
      toolArgs.push(...inputs.extra);
      await execPython("aqt install-tool", toolArgs);
    }
  }

  // Save automatic cache
  if (!internalCacheHit && inputs.cache) {
    const cacheId = await cache.saveCache([inputs.dir], cacheKey);
    core.info(`Automatic cache saved with id ${cacheId}`);
  }

  // Add tools to path
  if (inputs.addToolsToPath && inputs.tools.length) {
    toolsPaths(inputs.dir).forEach(core.addPath);
  }

  // Set environment variables/outputs for tools
  if (inputs.tools.length && inputs.setEnv) {
    core.exportVariable("IQTA_TOOLS", path.resolve(inputs.dir, "Tools"));
  }
  // Set environment variables/outputs for binaries
  if (inputs.isInstallQtBinaries) {
    const [qtPath, requiresParallelDesktop] = locateQtArchDir(inputs.dir, inputs.host);
    // Set outputs
    core.setOutput("qtPath", qtPath);

    // Set env variables
    if (inputs.setEnv) {
      if (process.platform === "linux") {
        setOrAppendEnvVar("LD_LIBRARY_PATH", path.resolve(qtPath, "lib"));
      }
      if (process.platform !== "win32") {
        setOrAppendEnvVar("PKG_CONFIG_PATH", path.resolve(qtPath, "lib", "pkgconfig"));
      }
      // If less than qt6, set Qt5_DIR variable
      if (compareVersions(inputs.version, "<", "6.0.0")) {
        core.exportVariable("Qt5_DIR", path.resolve(qtPath, "lib", "cmake"));
      }
      core.exportVariable("QT_ROOT_DIR", qtPath);
      core.exportVariable("QT_PLUGIN_PATH", path.resolve(qtPath, "plugins"));
      core.exportVariable("QML2_IMPORT_PATH", path.resolve(qtPath, "qml"));
      if (requiresParallelDesktop) {
        const hostPrefix = await fs.promises
          .readFile(path.join(qtPath, "bin", "target_qt.conf"), "utf8")
          .then((data) => data.match(/^HostPrefix=(.*)$/m)?.[1].trim() ?? "")
          .catch(() => "");
        if (hostPrefix) {
          core.exportVariable("QT_HOST_PATH", path.resolve(qtPath, "bin", hostPrefix));
        }
      }
      core.addPath(path.resolve(qtPath, "bin"));
    }
  }
};

void run()
  .catch((err) => {
    if (err instanceof Error) {
      core.setFailed(err.stack ?? err);
    } else {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      core.setFailed(`unknown error: ${err}`);
    }
    process.exit(1);
  })
  .then(() => {
    process.exit(0);
  });
