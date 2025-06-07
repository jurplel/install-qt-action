"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const process = __importStar(require("process"));
const cache = __importStar(require("@actions/cache"));
const core = __importStar(require("@actions/core"));
const exec_1 = require("@actions/exec");
const glob = __importStar(require("glob"));
const compare_versions_1 = require("compare-versions");
const compareVersions = (v1, op, v2) => {
    return (0, compare_versions_1.compare)(v1, v2, op);
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
    catch (err) {
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
    return (0, exec_1.exec)(pythonCommand(command, args));
});
const getPythonOutput = (command, args) => __awaiter(void 0, void 0, void 0, function* () {
    // Aqtinstall prints to both stderr and stdout, depending on the command.
    // This function assumes we don't care which is which, and we want to see it all.
    const out = yield (0, exec_1.getExecOutput)(pythonCommand(command, args));
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
        const archDir = path.basename(archPath);
        const versionDir = path.basename(path.join(archPath, ".."));
        return (versionDir.match(/^6\.\d+\.\d+$/) &&
            (archDir.match(/^(android.*|ios|wasm.*)$/) ||
                (archDir.match(/^msvc.*_arm64$/) && host !== "windows_arm64")));
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
class Inputs {
    constructor() {
        const host = core.getInput("host");
        // Set host automatically if omitted
        if (!host) {
            switch (process.platform) {
                case "win32": {
                    this.host = process.arch === "arm64" ? "windows_arm64" : "windows";
                    break;
                }
                case "darwin": {
                    this.host = "mac";
                    break;
                }
                default: {
                    this.host = process.arch === "arm64" ? "linux_arm64" : "linux";
                    break;
                }
            }
        }
        else {
            // Make sure host is one of the allowed values
            if (host === "windows" ||
                host === "windows_arm64" ||
                host === "mac" ||
                host === "linux" ||
                host === "linux_arm64" ||
                host === "all_os") {
                this.host = host;
            }
            else {
                throw TypeError(`host: "${host}" is not one of "windows" | "windows_arm64" | "mac" | "linux" | "linux_arm64" | "all_os"`);
            }
        }
        const target = core.getInput("target");
        // Make sure target is one of the allowed values
        if (target === "desktop" || target === "android" || target === "ios" || target === "wasm") {
            this.target = target;
        }
        else {
            throw TypeError(`target: "${target}" is not one of "desktop" | "android" | "ios" | "wasm"`);
        }
        // An attempt to sanitize non-straightforward version number input
        this.version = core.getInput("version");
        this.arch = core.getInput("arch");
        // Set arch automatically if omitted
        if (!this.arch) {
            if (this.target === "android") {
                if (compareVersions(this.version, ">=", "5.14.0") &&
                    compareVersions(this.version, "<", "6.0.0")) {
                    this.arch = "android";
                }
                else {
                    this.arch = "android_armv7";
                }
            }
            else if (this.host === "windows") {
                if (compareVersions(this.version, ">=", "6.8.0")) {
                    this.arch = "win64_msvc2022_64";
                }
                else if (compareVersions(this.version, ">=", "5.15.0")) {
                    this.arch = "win64_msvc2019_64";
                }
                else if (compareVersions(this.version, "<", "5.6.0")) {
                    this.arch = "win64_msvc2013_64";
                }
                else if (compareVersions(this.version, "<", "5.9.0")) {
                    this.arch = "win64_msvc2015_64";
                }
                else {
                    this.arch = "win64_msvc2017_64";
                }
            }
            else if (this.host === "windows_arm64") {
                this.arch = "win64_msvc2022_arm64";
            }
        }
        const dir = core.getInput("dir") || process.env.RUNNER_WORKSPACE;
        if (!dir) {
            throw TypeError(`"dir" input may not be empty`);
        }
        this.dir = path.resolve(dir, "Qt");
        this.modules = Inputs.getStringArrayInput("modules");
        this.archives = Inputs.getStringArrayInput("archives");
        this.tools = Inputs.getStringArrayInput("tools").map(
        // The tools inputs have the tool name, variant, and arch delimited by a comma
        // aqt expects spaces instead
        (tool) => tool.replace(/,/g, " "));
        this.addToolsToPath = Inputs.getBoolInput("add-tools-to-path");
        this.extra = Inputs.getStringArrayInput("extra");
        const installDeps = core.getInput("install-deps").toLowerCase();
        if (installDeps === "nosudo") {
            this.installDeps = "nosudo";
        }
        else {
            this.installDeps = installDeps === "true";
        }
        this.cache = Inputs.getBoolInput("cache");
        this.cacheKeyPrefix = core.getInput("cache-key-prefix");
        this.isInstallQtBinaries =
            !Inputs.getBoolInput("tools-only") && !Inputs.getBoolInput("no-qt-binaries");
        this.setEnv = Inputs.getBoolInput("set-env");
        this.aqtSource = core.getInput("aqtsource");
        this.aqtVersion = core.getInput("aqtversion");
        this.py7zrVersion = core.getInput("py7zrversion");
        this.useOfficial = Inputs.getBoolInput("use-official");
        this.email = core.getInput("email");
        this.pw = core.getInput("pw");
        this.src = Inputs.getBoolInput("source");
        this.srcArchives = Inputs.getStringArrayInput("src-archives");
        this.doc = Inputs.getBoolInput("documentation");
        this.docModules = Inputs.getStringArrayInput("doc-modules");
        this.docArchives = Inputs.getStringArrayInput("doc-archives");
        this.example = Inputs.getBoolInput("examples");
        this.exampleModules = Inputs.getStringArrayInput("example-modules");
        this.exampleArchives = Inputs.getStringArrayInput("example-archives");
    }
    get cacheKey() {
        let cacheKey = this.cacheKeyPrefix;
        for (const keyStringArray of [
            [
                this.host,
                os.release(),
                this.target,
                this.arch,
                this.version,
                this.dir,
                this.py7zrVersion,
                this.aqtSource,
                this.aqtVersion,
                this.useOfficial ? "official" : "",
            ],
            this.modules,
            this.archives,
            this.extra,
            this.tools,
            this.src ? "src" : "",
            this.srcArchives,
            this.doc ? "doc" : "",
            this.docArchives,
            this.docModules,
            this.example ? "example" : "",
            this.exampleArchives,
            this.exampleModules,
        ]) {
            for (const keyString of keyStringArray) {
                if (keyString) {
                    cacheKey += `-${keyString}`;
                }
            }
        }
        // Cache keys cannot contain commas
        cacheKey = cacheKey.replace(/,/g, "-");
        // Cache keys cannot be larger than 512 characters
        const maxKeyLength = 512;
        if (cacheKey.length > maxKeyLength) {
            const hashedCacheKey = crypto.createHash("sha256").update(cacheKey).digest("hex");
            cacheKey = `${this.cacheKeyPrefix}-${hashedCacheKey}`;
        }
        return cacheKey;
    }
    static getBoolInput(name) {
        return core.getInput(name).toLowerCase() === "true";
    }
    static getStringArrayInput(name) {
        const content = core.getInput(name);
        return content ? content.split(" ") : [];
    }
}
const run = () => __awaiter(void 0, void 0, void 0, function* () {
    const inputs = new Inputs();
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
                yield (0, exec_1.exec)(updateCommand);
                yield (0, exec_1.exec)(installCommand);
            }
            else {
                yield (0, exec_1.exec)(`sudo ${updateCommand}`);
                yield (0, exec_1.exec)(`sudo ${installCommand}`);
            }
        }
    }
    // Restore internal cache
    let internalCacheHit = false;
    if (inputs.cache) {
        const cacheHitKey = yield cache.restoreCache([inputs.dir], inputs.cacheKey);
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
        // Install dependencies via pip
        yield execPython("pip install", ["setuptools>=70.1.0", `"py7zr${inputs.py7zrVersion}"`]);
        // Install aqtinstall separately: allows aqtinstall to override py7zr if required
        if (inputs.aqtSource.length > 0) {
            yield execPython("pip install", [`"${inputs.aqtSource}"`]);
        }
        else {
            yield execPython("pip install", [`"aqtinstall${inputs.aqtVersion}"`]);
        }
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
        const cacheId = yield cache.saveCache([inputs.dir], inputs.cacheKey);
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
    if (err instanceof Error) {
        core.setFailed(err);
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
