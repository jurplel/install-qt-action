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
const setOrAppendEnvVar = (name, value) => {
    const oldValue = process.env[name];
    let newValue = value;
    if (oldValue) {
        newValue = `${oldValue}:${newValue}`;
    }
    core.exportVariable(name, newValue);
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
const getPythonOutput = (command, args) => __awaiter(void 0, void 0, void 0, function* () {
    // Aqtinstall prints to both stderr and stdout, depending on the command.
    // This function assumes we don't care which is which, and we want to see it all.
    const out = yield getExecOutput(pythonCommand(command, args));
    return out.stdout + out.stderr;
});
const flaggedList = (flag, listArgs) => {
    return listArgs.length ? [flag, ...listArgs] : [];
};
const locateQtArchDir = (installDir, host) => {
    // For 6.4.2/gcc, qmake is at 'installDir/6.4.2/gcc_64/bin/qmake'.
    // This makes a list of all the viable arch directories that contain a qmake file.
    const qtArchDirs = glob
        .sync(`${installDir}/[0-9]*/*/bin/qmake*`)
        .map((s) => path.resolve(s, "..", ".."));
    // For Qt6 mobile and wasm installations, and Qt6 Windows on ARM cross-compiled installations,
    // a standard desktop Qt installation must exist alongside the requested architecture.
    // In these cases, we must select the first item that ends with 'android*', 'ios', 'wasm*' or 'msvc*_arm64'.
    const requiresParallelDesktop = qtArchDirs.filter((archPath) => {
        var _a;
        const archDir = path.basename(archPath);
        const versionDir = path.basename(path.join(archPath, ".."));
        return (versionDir.match(/^6\.\d+\.\d+$/) &&
            ((_a = archDir.match(/^(android.*|ios|wasm.*)$/) /* Was "||", @typescript-eslint/prefer-nullish-coalescing */) !== null && _a !== void 0 ? _a : (archDir.match(/^msvc.*_arm64$/) && host !== "windows_arm64")));
    });
    if (requiresParallelDesktop.length) {
        // NOTE: if multiple mobile/wasm installations coexist, this may not select the desired directory
        return [requiresParallelDesktop[0], true];
    }
    else if (!qtArchDirs.length) {
        throw Error(`Failed to locate a Qt installation directory in  ${installDir}`);
    }
    else {
        // NOTE: if multiple Qt installations exist, this may not select the desired directory
        return [qtArchDirs[0], false];
    }
};
const isAutodesktopSupported = () => __awaiter(void 0, void 0, void 0, function* () {
    const rawOutput = yield getPythonOutput("aqt", ["version"]);
    const match = rawOutput.match(/aqtinstall\(aqt\)\s+v(\d+\.\d+\.\d+)/);
    return match ? compareVersions(match[1], ">=", "3.0.0") : false;
});
const resolveInputs = () => __awaiter(void 0, void 0, void 0, function* () {
    const parseBoolInput = (input) => {
        return input.toLowerCase() === "true";
    };
    const parseStringArrayInput = (input) => {
        return input ? input.split(" ") : [];
    };
    const fetchRequestedQtVersion = (host, target, version) => __awaiter(void 0, void 0, void 0, function* () {
        core.info(`Resolving Qt version ${version}...`);
        const rawOutput = yield getPythonOutput("aqt", [
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
        yield execPython("pip install", ["setuptools>=70.1.0", `"py7zr${rawInputs.py7zrVersion}"`]);
        // Install aqtinstall separately: allows aqtinstall to override py7zr if required
        if (rawInputs.aqtSource.length > 0) {
            yield execPython("pip install", [`"${rawInputs.aqtSource}"`]);
        }
        else {
            yield execPython("pip install", [`"aqtinstall${rawInputs.aqtVersion}"`]);
        }
    }
    const host = (() => {
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
        }
        else {
            // Make sure host is one of the allowed values
            if (rawInputs.host === "windows" ||
                rawInputs.host === "windows_arm64" ||
                rawInputs.host === "mac" ||
                rawInputs.host === "linux" ||
                rawInputs.host === "linux_arm64" ||
                rawInputs.host === "all_os") {
                return rawInputs.host;
            }
            else {
                throw TypeError(`host: "${rawInputs.host}" is not one of "windows" | "windows_arm64" | "mac" | "linux" | "linux_arm64" | "all_os"`);
            }
        }
    })();
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
    // The aqtinstall supports SimpleSpec (semver). To make all "compareVersions()" happy,
    // we have to fetch the requested Qt version here and always use that version in all
    // subsequent work, for example, generating cache key.
    const version = yield fetchRequestedQtVersion(host, target, rawInputs.version);
    const arch = (() => {
        // Set arch automatically if omitted.
        // Don't forget to update docs when new default arch is being added.
        if (!rawInputs.arch) {
            if (target === "android") {
                if (compareVersions(version, ">=", "5.14.0") && compareVersions(version, "<", "6.0.0")) {
                    return "android";
                }
                else {
                    return "android_armv7";
                }
            }
            else if (host === "windows") {
                if (compareVersions(version, ">=", "6.8.0")) {
                    return "win64_msvc2022_64";
                }
                else if (compareVersions(version, ">=", "5.15.0")) {
                    return "win64_msvc2019_64";
                }
                else if (compareVersions(version, "<", "5.6.0")) {
                    return "win64_msvc2013_64";
                }
                else if (compareVersions(version, "<", "5.9.0")) {
                    return "win64_msvc2015_64";
                }
                else {
                    return "win64_msvc2017_64";
                }
            }
            else if (host === "windows_arm64") {
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
                yield exec(updateCommand);
                yield exec(installCommand);
            }
            else {
                yield exec(`sudo ${updateCommand}`);
                yield exec(`sudo ${installCommand}`);
            }
        }
    }
    // Restore internal cache
    let internalCacheHit = false;
    if (inputs.cache) {
        const cacheHitKey = yield cache.restoreCache([inputs.dir], cacheKey);
        if (cacheHitKey) {
            core.info(`Automatic cache hit with key "${cacheHitKey}"`);
            internalCacheHit = true;
        }
        else {
            core.info("Automatic cache miss, will cache this run");
        }
    }
    // Install Qt and tools if not cached
    if (!internalCacheHit) {
        // This flag will install a parallel desktop version of Qt, only where required.
        // aqtinstall will automatically determine if this is necessary.
        const autodesktop = (yield isAutodesktopSupported()) ? ["--autodesktop"] : [];
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
                yield execPython("aqt", qtArgs);
            }
            else {
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
                yield execPython("aqt", qtArgs);
            }
        }
        const installSrcDocExamples = (flavor, archives, modules) => __awaiter(void 0, void 0, void 0, function* () {
            const qtArgs = [
                inputs.host,
                // Aqtinstall < 2.0.4 requires `inputs.target` here, but that's deprecated
                inputs.version,
                ...["--outputdir", inputs.dir],
                ...flaggedList("--archives", archives),
                ...flaggedList("--modules", modules),
                ...inputs.extra,
            ];
            yield execPython(`aqt install-${flavor}`, qtArgs);
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
            yield execPython("aqt install-tool", toolArgs);
        }
    }
    // Save automatic cache
    if (!internalCacheHit && inputs.cache) {
        const cacheId = yield cache.saveCache([inputs.dir], cacheKey);
        core.info(`Automatic cache saved with key "${cacheKey}", cache id is "${cacheId}"`);
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
                const hostPrefix = yield fs.promises
                    .readFile(path.join(qtPath, "bin", "target_qt.conf"), "utf8")
                    .then((data) => { var _a, _b; return (_b = (_a = data.match(/^HostPrefix=(.*)$/m)) === null || _a === void 0 ? void 0 : _a[1].trim()) !== null && _b !== void 0 ? _b : ""; })
                    .catch(() => "");
                if (hostPrefix) {
                    core.exportVariable("QT_HOST_PATH", path.resolve(qtPath, "bin", hostPrefix));
                }
            }
            core.addPath(path.resolve(qtPath, "bin"));
        }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9tYWluLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7OztBQUFBLE9BQU8sS0FBSyxNQUFNLE1BQU0sUUFBUSxDQUFDO0FBQ2pDLE9BQU8sS0FBSyxFQUFFLE1BQU0sSUFBSSxDQUFDO0FBQ3pCLE9BQU8sS0FBSyxFQUFFLE1BQU0sSUFBSSxDQUFDO0FBQ3pCLE9BQU8sS0FBSyxJQUFJLE1BQU0sTUFBTSxDQUFDO0FBQzdCLE9BQU8sS0FBSyxPQUFPLE1BQU0sU0FBUyxDQUFDO0FBRW5DLE9BQU8sS0FBSyxLQUFLLE1BQU0sZ0JBQWdCLENBQUM7QUFDeEMsT0FBTyxLQUFLLElBQUksTUFBTSxlQUFlLENBQUM7QUFDdEMsT0FBTyxFQUFFLElBQUksRUFBRSxhQUFhLEVBQUUsTUFBTSxlQUFlLENBQUM7QUFFcEQsT0FBTyxLQUFLLElBQUksTUFBTSxNQUFNLENBQUM7QUFDN0IsT0FBTyxFQUFFLE9BQU8sRUFBbUIsTUFBTSxrQkFBa0IsQ0FBQztBQUM1RCxPQUFPLGdDQUFnQyxDQUFDO0FBRXhDLE1BQU0sZUFBZSxHQUFHLENBQUMsRUFBVSxFQUFFLEVBQW1CLEVBQUUsRUFBVSxFQUFXLEVBQUU7SUFDL0UsT0FBTyxPQUFPLENBQUMsRUFBRSxFQUFFLEVBQUUsRUFBRSxFQUFFLENBQUMsQ0FBQztBQUM3QixDQUFDLENBQUM7QUFFRixNQUFNLGlCQUFpQixHQUFHLENBQUMsSUFBWSxFQUFFLEtBQWEsRUFBUSxFQUFFO0lBQzlELE1BQU0sUUFBUSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDbkMsSUFBSSxRQUFRLEdBQUcsS0FBSyxDQUFDO0lBQ3JCLElBQUksUUFBUSxFQUFFLENBQUM7UUFDYixRQUFRLEdBQUcsR0FBRyxRQUFRLElBQUksUUFBUSxFQUFFLENBQUM7SUFDdkMsQ0FBQztJQUNELElBQUksQ0FBQyxjQUFjLENBQUMsSUFBSSxF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