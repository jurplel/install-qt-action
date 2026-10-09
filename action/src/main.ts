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
import "source-map-support/register.js";

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
  } catch {
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

/**
 * Both stdout and stderr will be printed in console.
 * Non-zero exit code results in crash.
 */
const getPythonOutput = async (
  command: string,
  args: readonly string[]
): Promise<{
  stdout: string;
  stderr: string;
}> => {
  const out = await getExecOutput(pythonCommand(command, args));
  return {
    stdout: out.stdout,
    stderr: out.stderr,
  };
};

/**
 * Returns result of Python or aqtinstall run even when the command exits with a non-zero code.
 * Both stdout and stderr will be printed in console.
 */
const tryRunPython = async (
  command: string,
  args: readonly string[]
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> => {
  const out = await getExecOutput(pythonCommand(command, args), undefined, {
    ignoreReturnCode: true,
  });
  return {
    exitCode: out.exitCode,
    stdout: out.stdout,
    stderr: out.stderr,
  };
};

const flaggedList = (flag: string, listArgs: readonly string[]): string[] => {
  return listArgs.length ? [flag, ...listArgs] : [];
};

/** In installation of "linux desktop 6.4.2 gcc_64", for example, qmake is at '6.4.2/gcc_64/bin/qmake'. */
const calculateQtArchDir = (host: string, version: string, arch: string): string => {
  // These two blocks are written based on the logic in aqtinstall v3.3.0:
  // - https://github.com/miurahr/aqtinstall/blob/b22c86daef2ceeab6635ee0851e089f7346ec286/aqt/metadata.py#L485-L516
  // - https://github.com/miurahr/aqtinstall/blob/b22c86daef2ceeab6635ee0851e089f7346ec286/aqt/metadata.py#L529-L531
  let versionDir = version;
  if (compareVersions(version, "=", "5.9.0")) {
    // Changing dir name between patch versions? You've got to be kidding me.
    versionDir = "5.9";
  }

  let archDir = arch;
  if (["linux", "linux_arm64"].includes(host) && arch.startsWith("linux_")) {
    // "linux_gcc_arm64" -> "gcc_arm64"
    archDir = arch.substring("linux_".length);
  } else if (host === "mac" && compareVersions(version, ">=", "6.1.2") && arch === "clang_64") {
    // Changing dir name between patch versions, again?
    archDir = "macos";
  } else {
    const matchWhole = arch.match(/^win(32|64)_(\w+)$/);
    if (matchWhole) {
      const [bits, name] = matchWhole.slice(1);
      if (name.startsWith("llvm_")) {
        // "win64_llvm_mingw" -> "llvm-mingw_64"
        const tail = name.substring("llvm_".length);
        archDir = `llvm-${tail}_${bits}`;
      } else if (name.startsWith("msvc")) {
        if (name.endsWith("_cross_compiled")) {
          // "win64_msvc2022_arm64_cross_compiled" -> "msvc2022_arm64"
          archDir = name.substring(0, name.length - "_cross_compiled".length);
        } else {
          // "win32_msvc2015" -> "msvc2015"
          // "win64_msvc2019_arm64" -> "msvc2019_arm64"
          // "win64_msvc2022_64" -> "msvc2022_64"
          archDir = name;
        }
      } else {
        // "win32_mingw53" -> "mingw53_32"
        // "win64_mingw" -> "mingw_64"
        archDir = `${name}_${bits}`;
      }
    }
  }

  return path.join(versionDir, archDir);
};

/** A lightweight sanitize check that discovers malformed installation in which no qmake file is placed. */
const checkQtArchDir = (installDir: string, qtArchDir: string): string => {
  const qtPath = path.resolve(installDir, qtArchDir);
  {
    const qmakePaths = glob.sync(
      [
        ...["qmake", "qmake.exe", "qmake.bat"], // Both Qt 5 and Qt 6
        ...["qmake6", "qmake6.exe", "qmake6.bat"], // Qt 6 only
      ],
      { cwd: path.resolve(qtPath, "bin") }
    );
    if (qmakePaths.length === 0) {
      throw Error(`Failed to locate a Qt installation directory in  ${installDir}`);
    }
  }
  return qtPath;
};

/**
 * For Qt 6 mobile and wasm installations, and Qt 6 Windows on ARM cross-compiled installations,
 * a standard desktop Qt installation must exist alongside the requested architecture.
 * Qt 5 related content in this function is for notes only.
 *
 * See:
 * - Fix docs qt6 wasm mobile by ddalcino · Pull Request #638 · miurahr/aqtinstall
 *   https://github.com/miurahr/aqtinstall/pull/638
 */
const calculateParallelDesktopRequirement = (
  host: string,
  target: string,
  version: string,
  arch: string
): boolean => {
  // Coarse-grained check; should not hurt due to subsequent checks.
  if (compareVersions(version, "<", "6.0.0")) {
    return false;
  }

  // The "arch":
  // - Android:
  //   - "android" in Qt 5.14~5.15. It contains all four architectures.
  //   - "android_arm64_v8a", "android_armv7", "android_x86", and "android_x86_64" in other versions.
  // - iOS is "ios".
  // - WASM:
  //   - "wasm_32" in Qt 5.13~5.15 & Qt 6.2~6.4.
  //   - "wasm_singlethread" and "wasm_multithread" since Qt 6.5.
  //
  // Refs:
  // - New Features in Qt 5.13 - Qt Wiki
  //   https://wiki.qt.io/New_Features_in_Qt_5.13
  // - Qt 6.2 LTS Released
  //   https://www.qt.io/blog/qt-6.2-lts-released
  // - Qt for WebAssembly | Qt 6.5
  //   https://doc.qt.io/qt-6.5/wasm.html
  if (["android", "ios", "wasm"].includes(target) || /^wasm_.+$/.test(arch)) {
    return true;
  }

  // The "arch":
  // On Windows x64, not "win64_msvc2022_arm64_cross_compiled" since Qt 6.8,
  // but "win64_msvc2022_arm64" in Qt 6.2~6.7.
  //
  // Refs:
  // - Qt 6.2 LTS Released
  //   https://www.qt.io/blog/qt-6.2-lts-released
  // - Qt 6.8 LTS Released!
  //   https://www.qt.io/blog/qt-6.8-released
  if (/^win64_msvc(?:\d{4})_arm64$/.test(arch) && host !== "windows_arm64") {
    return true;
  }

  return false;
};

const aqtinstallVersion = async (): Promise<string | null> => {
  const output = await getPythonOutput("aqt", ["version"]);
  // "aqtinstall" has printed the version number to STDERR since v1.2.0,
  // which introduced the "version" command.
  // This can also matches development version such as "aqtinstall(aqt) v1.2.0.dev1".
  const match = output.stderr.match(/aqtinstall\(aqt\)\s+v(\d+\.\d+\.\d+)/);
  return match?.at(1) ?? null;
};

const isAutodesktopSupported = async (): Promise<boolean> => {
  const version = await aqtinstallVersion();
  return version ? compareVersions(version, ">=", "3.0.0") : false;
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
  ): Promise<string | null> => {
    const result = await core.group(
      `Resolve available Qt version "${version}" with host "${host}" and target "${target}"`,
      async () =>
        tryRunPython("aqt", ["list-qt", host, target, "--spec", version, "--latest-version"])
    );
    const match = result.stdout.trim().match(/^\d+\.\d+\.\d+$/);
    return match?.[0] ?? null;
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
  await core.group("Install Python dependencies", async () => {
    // Install dependencies via pip
    await execPython("pip install", ["setuptools>=70.1.0", `"py7zr${rawInputs.py7zrVersion}"`]);

    // Install aqtinstall separately: allows aqtinstall to override py7zr if required
    if (rawInputs.aqtSource.length > 0) {
      await execPython("pip install", [`"${rawInputs.aqtSource}"`]);
    } else {
      await execPython("pip install", [`"aqtinstall${rawInputs.aqtVersion}"`]);
    }
  });

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

  const { host, version: requestedQtVersion } = await (async (): Promise<{
    host: "windows" | "windows_arm64" | "mac" | "linux" | "linux_arm64" | "all_os";
    version: string | null;
  }> => {
    // Set host automatically if omitted
    if (!rawInputs.host) {
      // No "all_os".
      const platformHost = ((): "windows" | "windows_arm64" | "mac" | "linux" | "linux_arm64" => {
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
      })();

      const aqtVersion = await aqtinstallVersion();

      if (
        /* Neither Android nor WASM */
        !["android", "wasm"].includes(target) ||
        /* Unsupported or unrecognizable aqt */
        (aqtVersion ? compareVersions(aqtVersion, "<", "3.2.0") : true)
      ) {
        return { host: platformHost, version: null };
      }

      // Try the new "all_os".
      // See comments below for the reason of calling "fetchRequestedQtVersion()".
      const version = await fetchRequestedQtVersion("all_os", target, rawInputs.version);
      if (version) {
        return { host: "all_os", version };
      }
      return { host: platformHost, version: null };
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
        return { host: rawInputs.host, version: null };
      } else {
        throw TypeError(
          `host: "${rawInputs.host}" is not one of "windows" | "windows_arm64" | "mac" | "linux" | "linux_arm64" | "all_os"`
        );
      }
    }
  })();

  // The aqtinstall supports SimpleSpec (semver). To make all "compareVersions()" happy,
  // we have to fetch the requested Qt version here and always use that version in all
  // subsequent work, for example, generating cache key.
  const version =
    requestedQtVersion ?? (await fetchRequestedQtVersion(host, target, rawInputs.version));
  if (!version) {
    throw Error("No available Qt version found by specified inputs.");
  }

  const arch = ((): string => {
    if (rawInputs.arch) {
      return rawInputs.arch;
    }

    // Set arch automatically if omitted.
    // Don't forget to update docs when new default arch is being added.
    //
    // This block should provide at least the same functionality as aqtinstall.
    // We've added more branches to provide more default values based on v3.3.0:
    // - https://github.com/miurahr/aqtinstall/blob/b22c86daef2ceeab6635ee0851e089f7346ec286/aqt/installer.py#L246-L273
    //   https://github.com/miurahr/aqtinstall/blob/b22c86daef2ceeab6635ee0851e089f7346ec286/tests/test_cli.py#L131-L160
    // Our downstream patches will be marked with comments.
    if (host === "linux" && target === "desktop") {
      if (compareVersions(version, ">=", "6.7.0")) {
        return "linux_gcc_64";
      } else {
        return "gcc_64";
      }
    } else if (host === "linux_arm64" && target === "desktop") {
      return "linux_gcc_arm64";
    } else if (host === "mac" && target === "desktop") {
      return "clang_64";
    } else if (host === "mac" && target === "ios") {
      return "ios";
    } else if (target === "android") {
      if (
        compareVersions(version, ">=", "5.14.0") &&
        /* ADD */ compareVersions(version, "<", "6.0.0")
      ) {
        return "android";
      } else {
        /* ADD */ return "android_armv7";
      }
    } else if (host === "windows_arm64" && target === "desktop") {
      /* FIX */ return "win64_msvc2022_arm64";
    }
    // ADD begin
    else if (host === "windows") {
      if (compareVersions(version, ">=", "6.8.0")) {
        return "win64_msvc2022_64";
      } else if (compareVersions(version, ">=", "5.15.0")) {
        return "win64_msvc2019_64";
      } else if (compareVersions(version, ">=", "5.9.0")) {
        return "win64_msvc2017_64";
      } else if (compareVersions(version, ">=", "5.6.0")) {
        return "win64_msvc2015_64";
      } else {
        return "win64_msvc2013_64";
      }
    }
    // ADD end

    throw new Error(
      `Unable to provide an "arch" based on inputs, please specify one. 
        Feel free to open issues to ask if you are uncertain of the proper value.`
    );
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
      await core.group("Install Linux system dependencies", async () => {
        if (inputs.installDeps === "nosudo") {
          await exec(updateCommand);
          await exec(installCommand);
        } else {
          await exec(`sudo ${updateCommand}`);
          await exec(`sudo ${installCommand}`);
        }
      });
    }
  }

  // Restore automatic cache
  let internalCacheHit = false;
  if (inputs.cache) {
    internalCacheHit = await core.group("Check and restore cache", async () => {
      const cacheHitKey = await cache.restoreCache([inputs.dir], cacheKey);
      if (cacheHitKey) {
        core.info(`Automatic cache hit with key "${cacheHitKey}"`);
        return true;
      } else {
        core.info("Automatic cache miss, will cache this run");
        return false;
      }
    });
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
          inputs.arch,
          inputs.version,
          ...["--outputdir", inputs.dir],
          ...["--email", inputs.email],
          ...["--pw", inputs.pw],
          ...flaggedList("--modules", inputs.modules),
          ...inputs.extra,
        ];
        await core.group("Install Qt via the official installer", async () =>
          execPython("aqt", qtArgs)
        );
      } else {
        const qtArgs = [
          "install-qt",
          inputs.host,
          inputs.target,
          inputs.version,
          inputs.arch,
          ...autodesktop,
          ...["--outputdir", inputs.dir],
          ...flaggedList("--modules", inputs.modules),
          ...flaggedList("--archives", inputs.archives),
          ...inputs.extra,
        ];
        await core.group("Install Qt", async () => execPython("aqt", qtArgs));
      }
    }

    const installSrcDocExamples = async (
      flavor: "src" | "doc" | "example",
      archives: readonly string[],
      modules: readonly string[]
    ): Promise<void> => {
      const fullnames: Record<typeof flavor, string> = {
        src: "source",
        doc: "documentation",
        example: "examples",
      };
      const qtArgs = [
        inputs.host,
        // Aqtinstall < 2.0.4 requires `inputs.target` here, but that's deprecated
        inputs.version,
        ...["--outputdir", inputs.dir],
        ...flaggedList("--archives", archives),
        ...flaggedList("--modules", modules),
        ...inputs.extra,
      ];
      await core.group(`Install ${fullnames[flavor]}`, async () =>
        execPython(`aqt install-${flavor}`, qtArgs)
      );
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
      await core.group(`Install tool "${tool}"`, async () =>
        execPython("aqt install-tool", toolArgs)
      );
    }
  }

  // Add tools to path
  if (inputs.addToolsToPath && inputs.tools.length) {
    toolsPaths(inputs.dir).forEach(core.addPath);
  }

  // Set environment variables/outputs for tools
  if (inputs.tools.length && inputs.setEnv) {
    core.exportVariable("IQTA_TOOLS", path.resolve(inputs.dir, "Tools"));
  }
  // Check binaries and set environment variables/outputs
  if (inputs.isInstallQtBinaries) {
    const qtArchDir = calculateQtArchDir(inputs.host, inputs.version, inputs.arch);
    const qtPath = checkQtArchDir(inputs.dir, qtArchDir);

    // Set outputs
    // - Resolved inputs
    core.setOutput("host", inputs.host);
    core.setOutput("target", inputs.target);
    core.setOutput("version", inputs.version);
    core.setOutput("arch", inputs.arch);
    // - Calculated values
    core.setOutput("qtPath", qtPath);

    // Set env variables
    if (inputs.setEnv) {
      // Append to env vars.
      if (process.platform === "linux") {
        setOrAppendEnvVar("LD_LIBRARY_PATH", path.resolve(qtPath, "lib"));
      }
      if (process.platform !== "win32") {
        setOrAppendEnvVar("PKG_CONFIG_PATH", path.resolve(qtPath, "lib", "pkgconfig"));
      }

      // Create or overwrite env vars.
      //
      // If older than Qt 6, set Qt5_DIR variable
      if (compareVersions(inputs.version, "<", "6.0.0")) {
        core.exportVariable("Qt5_DIR", path.resolve(qtPath, "lib", "cmake"));
      }
      core.exportVariable("QT_ROOT_DIR", qtPath);
      core.exportVariable("QT_PLUGIN_PATH", path.resolve(qtPath, "plugins"));
      core.exportVariable("QML2_IMPORT_PATH", path.resolve(qtPath, "qml"));

      const requiresParallelDesktop = calculateParallelDesktopRequirement(
        inputs.host,
        inputs.target,
        inputs.version,
        inputs.arch
      );
      if (requiresParallelDesktop) {
        const hostPrefix = await fs.promises
          .readFile(path.join(qtPath, "bin", "target_qt.conf"), "utf8")
          .then((data) => data.match(/^HostPrefix=(.+)$/m)?.[1].trim() ?? null)
          .catch(() => null);
        if (hostPrefix) {
          core.exportVariable("QT_HOST_PATH", path.resolve(qtPath, "bin", hostPrefix));
        } else {
          core.warning(`Cannot set "QT_HOST_PATH" due to lack of required information`);
        }
      }
      core.addPath(path.resolve(qtPath, "bin"));
    }
  }

  // If everything goes well, save automatic cache.
  if (!internalCacheHit && inputs.cache) {
    await core.group("Save cache", async () => {
      const cacheId = await cache.saveCache([inputs.dir], cacheKey);
      core.info(`Automatic cache saved with key "${cacheKey}", cache id is "${cacheId}"`);
    });
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
