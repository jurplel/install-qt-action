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
const core = __importStar(require("@actions/core"));
const exec = __importStar(require("@actions/exec"));
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const dir = (core.getInput("dir") || process.env.RUNNER_WORKSPACE) + "/Qt";
            const version = core.getInput("version");
            // Qt installer assumes basic requirements that are not installed by
            // default on Ubuntu.
            if (process.platform == "linux" && core.getInput("install-deps") == "true") {
                yield exec.exec("sudo apt-get update");
                yield exec.exec("sudo apt-get install build-essential libgl1-mesa-dev -y");
            }
            if (core.getInput("cached") != "true") {
                // 7-zip is required, and not included on macOS
                if (process.platform == "darwin") {
                    yield exec.exec("brew install p7zip");
                }
                yield exec.exec("pip3 install setuptools wheel");
                yield exec.exec("pip3 install \"py7zr" + core.getInput("py7zrversion") + "\"");
                yield exec.exec("pip3 install \"aqtinstall" + core.getInput("aqtversion") + "\"");
                let host = core.getInput("host");
                let target = core.getInput("target");
                let arch = core.getInput("arch");
                let modules = core.getInput("modules").split(" ");
                let mirror = core.getInput("mirror");
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
                        arch = "win64_msvc2017_64";
                    }
                    else if (host == "android") {
                        arch = "android_armv7";
                    }
                }
                //set args
                let args = ["-O", `${dir}`, `${version}`, `${host}`, `${target}`];
                if (arch && (host == "windows" || target == "android")) {
                    args.push(`${arch}`);
                }
                if (modules) {
                    args.push("-m");
                    modules.forEach(function (currentModule) {
                        args.push(currentModule);
                    });
                }
                if (mirror) {
                    args.push("-b");
                    args.push(mirror);
                }
                //accomodate for differences in python 3 executable name
                let pythonName = "python3";
                if (process.platform == "win32") {
                    pythonName = "python";
                }
                //run aqtinstall with args
                yield exec.exec(`${pythonName} -m aqt install`, args);
            }
            //set environment variables
            let qtPath = dir + "/" + version;
            qtPath = glob.sync(qtPath + '/**/*')[0];
            core.exportVariable('Qt5_Dir', qtPath); // Incorrect name that was fixed, but kept around so it doesn't break anything
            core.exportVariable('Qt5_DIR', qtPath);
            core.addPath(qtPath + "/bin");
        }
        catch (error) {
            core.setFailed(error.message);
        }
    });
}
run();
