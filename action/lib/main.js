var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as process from "process";
import * as cache from "@actions/cache";
import * as core from "@actions/core";
import { exec, getExecOutput } from "@actions/exec";
import * as glob from "glob";
import { compare } from "compare-versions";
import "source-map-support/register.js";
const compareVersions = (v1, op, v2) => {
    return compare(v1, v2, op);
};
/**
 * Set or append a string to environment variable and log it.
 *
 * Uses the platform-specific path delimiter.
 */
const setOrAppendEnvVar = (name, value) => {
    core.info(`Appending "${value}" to env "${name}"`);
    // Be careful with empty string handling. `process.env[name] ? ...` is different from `process.env[name]?.`.
    // We choose to treat an entirely empty initial value as an empty list, so no `LD_LIBRARY_PATH=":FOO"`
    // will be produced to surprise users.
    const oldValue = process.env[name];
    const entries = oldValue ? oldValue.split(path.delimiter) : [];
    entries.push(value);
    core.exportVariable(name, entries.join(path.delimiter));
};
/** Prepend a string to environment variable PATH and log it. */
const prependPath = (value) => {
    core.info(`Prepending "${value}" to env "PATH"`);
    core.addPath(value);
};
/** Set an output and log it. */
const setOutput = (name, value) => {
    core.info(`Setting output "${name}" = "${value}"`);
    core.setOutput(name, value);
};
/** Set an environment variable and log it. */
const setEnv = (name, value) => {
    core.info(`Setting env "${name}" = "${value}"`);
    core.exportVariable(name, value);
};
const dirExists = (dir) => {
    try {
        return fs.statSync(dir).isDirectory();
    }
    catch (_a) {
        return false;
    }
};
// Names of directories for tools (tools_conan & tools_ninja) that include binaries in the
// base directory instead of a bin directory (ie 'Tools/Conan', not 'Tools/Conan/bin')
const binlessToolDirectories = ["Conan", "Ninja"];
const toolsPaths = (installDir) => {
    const binlessPaths = binlessToolDirectories
        .map((dir) => path.join(installDir, "Tools", dir))
        .filter((dir) => dirExists(dir));
    return [
        "Tools/**/bin",
        "*.app/Contents/MacOS",
        "*.app/**/bin",
        "Tools/*/*.app/Contents/MacOS",
        "Tools/*/*.app/**/bin",
    ]
        .flatMap((p) => glob.sync(`${installDir}/${p}`))
        .concat(binlessPaths)
        .map((p) => path.resolve(p));
};
const pythonCommand = (command, args) => {
    const python = process.platform === "win32" ? "python" : "python3";
    return `${python} -m ${command} ${args.join(" ")}`;
};
const execPython = (command, args) => __awaiter(void 0, void 0, void 0, function* () {
    return exec(pythonCommand(command, args));
});
/**
 * Both stdout and stderr will be printed in console.
 * Non-zero exit code results in crash.
 */
const getPythonOutput = (command, args) => __awaiter(void 0, void 0, void 0, function* () {
    const out = yield getExecOutput(pythonCommand(command, args));
    return {
        stdout: out.stdout,
        stderr: out.stderr,
    };
});
/**
 * Returns result of Python or aqtinstall run even when the command exits with a non-zero code.
 * Both stdout and stderr will be printed in console.
 */
const tryRunPython = (command, args) => __awaiter(void 0, void 0, void 0, function* () {
    const out = yield getExecOutput(pythonCommand(command, args), undefined, {
        ignoreReturnCode: true,
    });
    return {
        exitCode: out.exitCode,
        stdout: out.stdout,
        stderr: out.stderr,
    };
});
const flaggedList = (flag, listArgs) => {
    return listArgs.length ? [flag, ...listArgs] : [];
};
/** In installation of "linux desktop 6.4.2 gcc_64", for example, qmake is in the "bin" dir under "6.4.2/gcc_64". */
const calculateQtArchDir = (host, version, arch) => {
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
    }
    else if (host === "mac" && compareVersions(version, ">=", "6.1.2") && arch === "clang_64") {
        // Changing dir name between patch versions, again?
        archDir = "macos";
    }
    else {
        const matchWhole = arch.match(/^win(32|64)_(\w+)$/);
        if (matchWhole) {
            const [bits, name] = matchWhole.slice(1);
            if (name.startsWith("llvm_")) {
                // "win64_llvm_mingw" -> "llvm-mingw_64"
                const tail = name.substring("llvm_".length);
                archDir = `llvm-${tail}_${bits}`;
            }
            else if (name.startsWith("msvc")) {
                if (name.endsWith("_cross_compiled")) {
                    // "win64_msvc2022_arm64_cross_compiled" -> "msvc2022_arm64"
                    archDir = name.substring(0, name.length - "_cross_compiled".length);
                }
                else {
                    // "win32_msvc2015" -> "msvc2015"
                    // "win64_msvc2019_arm64" -> "msvc2019_arm64"
                    // "win64_msvc2022_64" -> "msvc2022_64"
                    archDir = name;
                }
            }
            else {
                // "win32_mingw53" -> "mingw53_32"
                // "win64_mingw" -> "mingw_64"
                archDir = `${name}_${bits}`;
            }
        }
    }
    return path.join(versionDir, archDir);
};
/** A lightweight sanity check that discovers malformed installation in which no qmake file is placed. */
const checkQtPath = (qtPath) => {
    const qmakePaths = glob.sync([
        ...["qmake", "qmake.exe", "qmake.bat"], // Both Qt 5 and Qt 6
        ...["qmake6", "qmake6.exe", "qmake6.bat"], // Qt 6 only
    ], { cwd: path.resolve(qtPath, "bin") });
    if (qmakePaths.length === 0) {
        throw Error(`Failed to locate a Qt installation directory in  ${qtPath}`);
    }
};
/**
 * For Qt 6 mobile and wasm installations, and Qt 6 Windows on ARM cross-compiled installations,
 * a standard desktop Qt installation must exist alongside the requested architecture.
 * Qt 5 related content in this function is for notes only.
 *
 * See:
 * - https://github.com/miurahr/aqtinstall/blob/076e1659807d0b362a3ed684d54c2e9c775eb9c7/aqt/installer.py#L1446-L1465
 * - Fix docs qt6 wasm mobile by ddalcino · Pull Request #638 · miurahr/aqtinstall
 *   https://github.com/miurahr/aqtinstall/pull/638
 */
const calculateParallelDesktopRequirement = (host, target, version, arch) => {
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
    // On Windows x64:
    // - "win64_msvc2022_arm64" in Qt 6.2~6.7.
    // - "win64_msvc2022_arm64_cross_compiled" since Qt 6.8.
    //
    // Refs:
    // - Qt 6.2 LTS Released
    //   https://www.qt.io/blog/qt-6.2-lts-released
    // - Qt 6.8 LTS Released!
    //   https://www.qt.io/blog/qt-6.8-released
    if (/^win64_msvc(?:\d{4})_arm64(?:_cross_compiled)?$/.test(arch) && host !== "windows_arm64") {
        return true;
    }
    return false;
};
const parseHostPrefix = (qtPath) => __awaiter(void 0, void 0, void 0, function* () {
    return fs.promises
        .readFile(path.join(qtPath, "bin", "target_qt.conf"), "utf8")
        .then((data) => { var _a, _b; return (_b = (_a = data.match(/^HostPrefix=(.+)$/m)) === null || _a === void 0 ? void 0 : _a[1].trim()) !== null && _b !== void 0 ? _b : null; })
        .catch(() => null);
});
const aqtinstallVersion = () => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const output = yield getPythonOutput("aqt", ["version"]);
    // "aqtinstall" has printed the version number to STDERR since v1.2.0,
    // which introduced the "version" command.
    // This can also matches development version such as "aqtinstall(aqt) v1.2.0.dev1".
    const match = output.stderr.match(/aqtinstall\(aqt\)\s+v(\d+\.\d+\.\d+)/);
    return (_a = match === null || match === void 0 ? void 0 : match.at(1)) !== null && _a !== void 0 ? _a : null;
});
const isAutodesktopSupported = () => __awaiter(void 0, void 0, void 0, function* () {
    const version = yield aqtinstallVersion();
    return version ? compareVersions(version, ">=", "3.0.0") : false;
});
const resolveInputs = () => __awaiter(void 0, void 0, void 0, function* () {
    const parseBoolInput = (input) => {
        return input.toLowerCase() === "true";
    };
    const parseStringArrayInput = (input) => {
        return input ? input.split(" ") : [];
    };
    const fetchRequestedQtVersion = (host, target, version) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const result = yield core.group(`Resolve available Qt version "${version}" with host "${host}" and target "${target}"`, () => __awaiter(void 0, void 0, void 0, function* () { return tryRunPython("aqt", ["list-qt", host, target, "--spec", version, "--latest-version"]); }));
        const match = result.stdout.trim().match(/^\d+\.\d+\.\d+$/);
        return (_a = match === null || match === void 0 ? void 0 : match[0]) !== null && _a !== void 0 ? _a : null;
    });
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
        /** Deprecated. */
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
    // Deprecated options check.
    {
        if (parseBoolInput(rawInputs.toolsOnly)) {
            core.warning('Option "tools-only" will be removed soon due to deprecation. Please switch to "no-qt-binaries".', {
                title: "install-qt-action",
            });
        }
    }
    // The "version" property will be populated per remote data fetched by aqt,
    // so installing aqt and related packages is required here.
    yield core.group("Install Python dependencies", () => __awaiter(void 0, void 0, void 0, function* () {
        // Install dependencies via pip
        yield execPython("pip install", ["setuptools>=70.1.0", `"py7zr${rawInputs.py7zrVersion}"`]);
        // Install aqtinstall separately: allows aqtinstall to override py7zr if required
        if (rawInputs.aqtSource.length > 0) {
            yield execPython("pip install", [`"${rawInputs.aqtSource}"`]);
        }
        else {
            yield execPython("pip install", [`"aqtinstall${rawInputs.aqtVersion}"`]);
        }
    }));
    const target = (() => {
        // Make sure target is one of the allowed values
        if (rawInputs.target === "desktop" ||
            rawInputs.target === "android" ||
            rawInputs.target === "ios" ||
            rawInputs.target === "wasm") {
            return rawInputs.target;
        }
        else {
            throw TypeError(`target: "${rawInputs.target}" is not one of "desktop" | "android" | "ios" | "wasm"`);
        }
    })();
    const { host, version: requestedQtVersion } = yield (() => __awaiter(void 0, void 0, void 0, function* () {
        // Do not handle "all_os" here; that's not a real platform.
        const platformHost = (() => {
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
        if (parseBoolInput(rawInputs.useOfficial)) {
            if (rawInputs.host && rawInputs.host !== platformHost) {
                core.warning(`Specified host "${rawInputs.host}" is ignored when using the official installer.`, { title: "install-qt-action" });
            }
            return { host: platformHost, version: null };
        }
        // Set host automatically if omitted
        if (!rawInputs.host) {
            const aqtVersion = yield aqtinstallVersion();
            if (
            /* Neither Android nor WASM */
            !["android", "wasm"].includes(target) ||
                /* Unsupported or unrecognizable aqt */
                (aqtVersion ? compareVersions(aqtVersion, "<", "3.2.0") : true)) {
                return { host: platformHost, version: null };
            }
            // Try the new "all_os".
            // See comments below for the reason of calling "fetchRequestedQtVersion()".
            const version = yield fetchRequestedQtVersion("all_os", target, rawInputs.version);
            if (version) {
                return { host: "all_os", version };
            }
            return { host: platformHost, version: null };
        }
        else {
            // Make sure host is one of the allowed values
            if (rawInputs.host === "windows" ||
                rawInputs.host === "windows_arm64" ||
                rawInputs.host === "mac" ||
                rawInputs.host === "linux" ||
                rawInputs.host === "linux_arm64" ||
                rawInputs.host === "all_os") {
                return { host: rawInputs.host, version: null };
            }
            else {
                throw TypeError(`host: "${rawInputs.host}" is not one of "windows" | "windows_arm64" | "mac" | "linux" | "linux_arm64" | "all_os"`);
            }
        }
    }))();
    // The aqtinstall supports SimpleSpec (semver). To make all "compareVersions()" happy,
    // we have to fetch the requested Qt version here and always use that version in all
    // subsequent work, for example, generating cache key.
    const version = requestedQtVersion !== null && requestedQtVersion !== void 0 ? requestedQtVersion : (yield fetchRequestedQtVersion(host, target, rawInputs.version));
    if (!version) {
        throw Error("No available Qt version found by specified inputs.");
    }
    const arch = (() => {
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
            }
            else {
                return "gcc_64";
            }
        }
        else if (host === "linux_arm64" && target === "desktop") {
            return "linux_gcc_arm64";
        }
        else if (host === "mac" && target === "desktop") {
            return "clang_64";
        }
        else if (host === "mac" && target === "ios") {
            return "ios";
        }
        else if (target === "android") {
            if (compareVersions(version, ">=", "5.14.0") &&
                /* ADD */ compareVersions(version, "<", "6.0.0")) {
                return "android";
            }
            else {
                /* ADD */ return "android_armv7";
            }
        }
        else if (host === "windows_arm64" && target === "desktop") {
            /* FIX */ return "win64_msvc2022_arm64";
        }
        // ADD begin
        else if (host === "windows") {
            if (compareVersions(version, ">=", "6.8.0")) {
                return "win64_msvc2022_64";
            }
            else if (compareVersions(version, ">=", "5.15.0")) {
                return "win64_msvc2019_64";
            }
            else if (compareVersions(version, ">=", "5.9.0")) {
                return "win64_msvc2017_64";
            }
            else if (compareVersions(version, ">=", "5.6.0")) {
                return "win64_msvc2015_64";
            }
            else {
                return "win64_msvc2013_64";
            }
        }
        // ADD end
        throw new Error(`Unable to provide an "arch" based on inputs, please specify one. 
        Feel free to open issues to ask if you are uncertain of the proper value.`);
    })();
    const inputs = {
        host: host,
        target: target,
        version: version,
        arch: arch,
        dir: (() => {
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
        (tool) => tool.replace(/,/g, " ")),
        addToolsToPath: parseBoolInput(rawInputs.addToolsToPath),
        extra: parseStringArrayInput(rawInputs.extra),
        installDeps: (() => {
            if (rawInputs.installDeps.toLowerCase() === "nosudo") {
                return "nosudo";
            }
            else {
                return parseBoolInput(rawInputs.installDeps);
            }
        })(),
        cache: parseBoolInput(rawInputs.cache),
        cacheKeyPrefix: rawInputs.cacheKeyPrefix,
        isInstallQtBinaries: !parseBoolInput(rawInputs.toolsOnly) && !parseBoolInput(rawInputs.noQtBinaries),
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
    const cacheKey = (() => {
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
});
const run = () => __awaiter(void 0, void 0, void 0, function* () {
    const { inputs, cacheKey } = yield resolveInputs();
    const qtArchDir = calculateQtArchDir(inputs.host, inputs.version, inputs.arch);
    const qtPath = path.resolve(inputs.dir, qtArchDir);
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
            yield core.group("Install Linux system dependencies", () => __awaiter(void 0, void 0, void 0, function* () {
                if (inputs.installDeps === "nosudo") {
                    yield exec(updateCommand);
                    yield exec(installCommand);
                }
                else {
                    yield exec(`sudo ${updateCommand}`);
                    yield exec(`sudo ${installCommand}`);
                }
            }));
        }
    }
    // Restore automatic cache
    let internalCacheHit = false;
    if (inputs.cache) {
        internalCacheHit = yield core.group("Check and restore cache", () => __awaiter(void 0, void 0, void 0, function* () {
            const cacheHitKey = yield cache.restoreCache([inputs.dir], cacheKey);
            if (cacheHitKey) {
                core.info(`Automatic cache hit with key "${cacheHitKey}"`);
                return true;
            }
            else {
                core.info("Automatic cache miss, will cache this run");
                return false;
            }
        }));
    }
    // Install Qt and tools if not cached
    if (!internalCacheHit) {
        // This flag will install a parallel desktop version of Qt, only where required.
        // aqtinstall will automatically determine if this is necessary.
        const autodesktop = (yield isAutodesktopSupported()) ? ["--autodesktop"] : [];
        // Install Qt
        if (inputs.isInstallQtBinaries) {
            if (dirExists(qtPath)) {
                core.warning(`The directory "${qtPath}" exists and content in it may be overwritten during installation`, { title: "install-qt-action" });
            }
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
                yield core.group("Install Qt via the official installer", () => __awaiter(void 0, void 0, void 0, function* () { return execPython("aqt", qtArgs); }));
            }
            else {
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
                yield core.group("Install Qt", () => __awaiter(void 0, void 0, void 0, function* () { return execPython("aqt", qtArgs); }));
            }
        }
        const installSrcDocExamples = (flavor, archives, modules) => __awaiter(void 0, void 0, void 0, function* () {
            const fullnames = {
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
            yield core.group(`Install ${fullnames[flavor]}`, () => __awaiter(void 0, void 0, void 0, function* () { return execPython(`aqt install-${flavor}`, qtArgs); }));
        });
        // Install source, docs, & examples
        if (inputs.src) {
            yield installSrcDocExamples("src", inputs.srcArchives, []);
        }
        if (inputs.doc) {
            yield installSrcDocExamples("doc", inputs.docArchives, inputs.docModules);
        }
        if (inputs.example) {
            yield installSrcDocExamples("example", inputs.exampleArchives, inputs.exampleModules);
        }
        // Install tools
        for (const tool of inputs.tools) {
            const toolArgs = [inputs.host, inputs.target, tool];
            toolArgs.push("--outputdir", inputs.dir);
            toolArgs.push(...inputs.extra);
            yield core.group(`Install tool "${tool}"`, () => __awaiter(void 0, void 0, void 0, function* () { return execPython("aqt install-tool", toolArgs); }));
        }
    }
    // Environment for tools.
    if (inputs.tools.length) {
        yield core.group("Post-process installed tools", () => __awaiter(void 0, void 0, void 0, function* () {
            return Promise.resolve().then(() => {
                // Add tools to path
                if (inputs.addToolsToPath) {
                    toolsPaths(inputs.dir).forEach(prependPath);
                }
                // Set environment variables/outputs for tools
                if (inputs.setEnv) {
                    setEnv("IQTA_TOOLS", path.resolve(inputs.dir, "Tools"));
                }
            });
        }));
    }
    // Check binaries and set outputs and/or environment variables
    if (inputs.isInstallQtBinaries) {
        checkQtPath(qtPath);
        const requiresParallelDesktop = calculateParallelDesktopRequirement(inputs.host, inputs.target, inputs.version, inputs.arch);
        /** Append to LD_LIBRARY_PATH. */
        const libDir = process.platform === "linux" ? path.resolve(qtPath, "lib") : null;
        /** Append to PKG_CONFIG_PATH. */
        const pkgConfigDir = process.platform !== "win32" ? path.resolve(qtPath, "lib", "pkgconfig") : null;
        /** Set Qt5_DIR for Qt versions earlier than 6. */
        const qt5Dir = compareVersions(inputs.version, "<", "6.0.0")
            ? path.resolve(qtPath, "lib", "cmake")
            : null;
        /** Prepend to PATH. */
        const binDir = path.resolve(qtPath, "bin");
        /** Set QT_PLUGIN_PATH and its corresponding output. */
        const qtPluginPath = path.resolve(qtPath, "plugins");
        /** Set QML2_IMPORT_PATH and its corresponding output. */
        const qml2ImportPath = path.resolve(qtPath, "qml");
        /** Set QT_HOST_PATH and its corresponding output. */
        const hostPath = yield (() => __awaiter(void 0, void 0, void 0, function* () {
            if (!requiresParallelDesktop) {
                return null;
            }
            const hostPrefix = yield parseHostPrefix(qtPath);
            if (!hostPrefix) {
                core.warning(`Cannot find the host Qt installation path by parsing config files`, {
                    title: "install-qt-action",
                });
                return null;
            }
            return path.resolve(qtPath, "bin", hostPrefix);
        }))();
        yield core.group("Post-process installed Qt", () => __awaiter(void 0, void 0, void 0, function* () {
            return Promise.resolve().then(() => {
                // Always set outputs.
                {
                    // Resolved inputs.
                    setOutput("host", inputs.host);
                    setOutput("target", inputs.target);
                    setOutput("version", inputs.version);
                    setOutput("arch", inputs.arch);
                    // Outputs corresponding to environment variables.
                    setOutput("qt-root-dir", qtPath);
                    setOutput("qt-plugin-path", qtPluginPath);
                    setOutput("qml2-import-path", qml2ImportPath);
                    if (hostPath) {
                        setOutput("qt-host-path", hostPath);
                    }
                }
                // Set env variables.
                if (inputs.setEnv) {
                    prependPath(binDir);
                    if (libDir) {
                        setOrAppendEnvVar("LD_LIBRARY_PATH", libDir);
                    }
                    if (pkgConfigDir) {
                        setOrAppendEnvVar("PKG_CONFIG_PATH", pkgConfigDir);
                    }
                    if (qt5Dir) {
                        setEnv("Qt5_DIR", qt5Dir);
                    }
                    setEnv("QT_ROOT_DIR", qtPath);
                    setEnv("QT_PLUGIN_PATH", qtPluginPath);
                    setEnv("QML2_IMPORT_PATH", qml2ImportPath);
                    if (hostPath) {
                        setEnv("QT_HOST_PATH", hostPath);
                    }
                }
            });
        }));
    }
    // If everything goes well, save automatic cache.
    if (!internalCacheHit && inputs.cache) {
        yield core.group("Save cache", () => __awaiter(void 0, void 0, void 0, function* () {
            const cacheId = yield cache.saveCache([inputs.dir], cacheKey);
            core.info(`Automatic cache saved with key "${cacheKey}", cache id is "${cacheId}"`);
        }));
    }
});
void run()
    .catch((err) => {
    var _a;
    if (err instanceof Error) {
        core.setFailed((_a = err.stack) !== null && _a !== void 0 ? _a : err);
    }
    else {
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        core.setFailed(`unknown error: ${err}`);
    }
    process.exit(1);
})
    .then(() => {
    process.exit(0);
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9tYWluLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7OztBQUFBLE9BQU8sS0FBSyxNQUFNLE1BQU0sUUFBUSxDQUFDO0FBQ2pDLE9BQU8sS0FBSyxFQUFFLE1BQU0sSUFBSSxDQUFDO0FBQ3pCLE9BQU8sS0FBSyxFQUFFLE1BQU0sSUFBSSxDQUFDO0FBQ3pCLE9BQU8sS0FBSyxJQUFJLE1BQU0sTUFBTSxDQUFDO0FBQzdCLE9BQU8sS0FBSyxPQUFPLE1BQU0sU0FBUyxDQUFDO0FBRW5DLE9BQU8sS0FBSyxLQUFLLE1BQU0sZ0JBQWdCLENBQUM7QUFDeEMsT0FBTyxLQUFLLElBQUksTUFBTSxlQUFlLENBQUM7QUFDdEMsT0FBTyxFQUFFLElBQUksRUFBRSxhQUFhLEVBQUUsTUFBTSxlQUFlLENBQUM7QUFFcEQsT0FBTyxLQUFLLElBQUksTUFBTSxNQUFNLENBQUM7QUFDN0IsT0FBTyxFQUFFLE9BQU8sRUFBbUIsTUFBTSxrQkFBa0IsQ0FBQztBQUM1RCxPQUFPLGdDQUFnQyxDQUFDO0FBRXhDLE1BQU0sZUFBZSxHQUFHLENBQUMsRUFBVSxFQUFFLEVBQW1CLEVBQUUsRUFBVSxFQUFXLEVBQUU7SUFDL0UsT0FBTyxPQUFPLENBQUMsRUFBRSxFQUFFLEVBQUUsRUFBRSxFQUFFLENBQUMsQ0FBQztBQUM3QixDQUFDLENBQUM7QUFFRjs7OztHQUlHO0FBQ0gsTUFBTSxpQkFBaUIsR0FBRyxDQUFDLElBQVksRUFBRSxLQUFhLEVBQVEsRUFBRTtJQUM5RCxJQUFJLENBQUMsSUFBSSxDQUFDLGNBQWMsS0FBSyxhQUFhLElBQUksR0FBRyxDQUFDLENBQUM7SUFDbkQsNEdBQTRHO0lBQzVHLHNHQUFzRztJQUN0RyxzQ0FBc0M7SUFDdEMsTUFBTSxRQUFRLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUNuQyxNQUFNLE9BQU8sR0FBRyxRQUFRLENBQUMs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