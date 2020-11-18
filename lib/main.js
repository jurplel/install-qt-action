"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const process = __importStar(require("process"));
const glob = __importStar(require("glob"));
const compareVersions = __importStar(require("compare-versions"));
const core = __importStar(require("@actions/core"));
const exec = __importStar(require("@actions/exec"));
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const dir = (core.getInput("dir") || process.env.RUNNER_WORKSPACE) + "/Qt";
            let version = core.getInput("version");
            // Qt installer assumes basic requirements that are not installed by
            // default on Ubuntu.
            if (process.platform == "linux" && core.getInput("install-deps") == "true") {
                yield exec.exec("sudo apt-get update");
                yield exec.exec("sudo apt-get install build-essential libgl1-mesa-dev libxkbcommon-x11-0 libpulse-dev -y");
            }
            if (core.getInput("cached") != "true") {
                // 7-zip is required, and not included on macOS
                if (process.platform == "darwin") {
                    yield exec.exec("brew install p7zip");
                }
                //accomodate for differences in python 3 executable name
                let pythonName = "python3";
                if (process.platform == "win32") {
                    pythonName = "python";
                }
                yield exec.exec(pythonName + " -m pip install setuptools wheel");
                yield exec.exec(pythonName + " -m pip install \"py7zr" + core.getInput("py7zrversion") + "\"");
                yield exec.exec(pythonName + " -m pip install \"aqtinstall" + core.getInput("aqtversion") + "\"");
                let host = core.getInput("host");
                const target = core.getInput("target");
                let arch = core.getInput("arch");
                const mirror = core.getInput("mirror");
                const extra = core.getInput("extra");
                const modules = core.getInput("modules");
                const tools = core.getInput("tools");
                //set host automatically if omitted
                if (!host) {
                    switch (process.platform) {
                        case "win32": {
                            host = "windows";
                            break;
                        }
                        case "darwin": {
                            host = "mac";
                            break;
                        }
                        default: {
                            host = "linux";
                            break;
                        }
                    }
                }
                //set arch automatically if omitted
                if (!arch) {
                    if (host == "windows") {
                        if (compareVersions.compare(version, '5.15.0', '>=')) { // if version is greater than or equal to 5.15.0
                            arch = "win64_msvc2019_64";
                        }
                        else if (compareVersions.compare(version, '5.6.0', '<')) { // if version earlier than 5.6
                            arch = "win64_msvc2013_64";
                        }
                        else if (compareVersions.compare(version, '5.9.0', '<')) { // if version is earlier than 5.9
                            arch = "win64_msvc2015_64";
                        }
                        else { // otherwise
                            arch = "win64_msvc2017_64";
                        }
                    }
                    else if (host == "android") {
                        arch = "android_armv7";
                    }
                }
                //set args
                let args = [`${version}`, `${host}`, `${target}`];
                if (arch && ((host == "windows" || target == "android") || arch == "wasm_32")) {
                    args.push(`${arch}`);
                }
                if (modules) {
                    args.push("-m");
                    modules.split(" ").forEach(function (currentModule) {
                        args.push(currentModule);
                    });
                }
                let extraArgs = ["-O", `${dir}`];
                if (mirror) {
                    extraArgs.push("-b");
                    extraArgs.push(mirror);
                }
                if (extra) {
                    extra.split(" ").forEach(function (string) {
                        extraArgs.push(string);
                    });
                }
                args = args.concat(extraArgs);
                //run aqtinstall with args, and install tools if requested
                if (core.getInput("tools-only") != "true") {
                    yield exec.exec(`${pythonName} -m aqt install`, args);
                }
                if (tools) {
                    tools.split(" ").forEach((element) => __awaiter(this, void 0, void 0, function* () {
                        let elements = element.split(",");
                        yield exec.exec(`${pythonName} -m aqt tool ${host} ${elements[0]} ${elements[1]} ${elements[2]}`, extraArgs);
                    }));
                }
            }
            //set environment variables
            let qtPath = dir + "/" + version;
            qtPath = glob.sync(qtPath + '/**/*')[0];
            // If less than qt6, set qt5_dir variable, otherwise set qt6_dir variable
            if (compareVersions.compare(version, '6.0.0', '<')) {
                core.exportVariable('Qt5_Dir', qtPath); // Incorrect name that was fixed, but kept around so it doesn't break anything
                core.exportVariable('Qt5_DIR', qtPath);
            }
            else {
                core.exportVariable('Qt6_DIR', qtPath);
            }
            core.exportVariable('QT_PLUGIN_PATH', qtPath + '/plugins');
            core.exportVariable('QML2_IMPORT_PATH', qtPath + '/qml');
            core.addPath(qtPath + "/bin");
        }
        catch (error) {
            core.setFailed(error.message);
        }
    });
}
run();
