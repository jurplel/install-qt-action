var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { exec } from '@actions/exec';
import * as io from '@actions/io';
import { existsSync, writeFileSync } from 'fs';
import * as path from 'path';
import * as utils from './cacheUtils.js';
import { CompressionMethod, SystemTarPathOnWindows, ArchiveToolType, TarFilename, ManifestFilename } from './constants.js';
const IS_WINDOWS = process.platform === 'win32';
// Returns tar path and type: BSD or GNU
function getTarPath() {
    return __awaiter(this, void 0, void 0, function* () {
        switch (process.platform) {
            case 'win32': {
                const gnuTar = yield utils.getGnuTarPathOnWindows();
                const systemTar = SystemTarPathOnWindows;
                if (gnuTar) {
                    // Use GNUtar as default on windows
                    return { path: gnuTar, type: ArchiveToolType.GNU };
                }
                else if (existsSync(systemTar)) {
                    return { path: systemTar, type: ArchiveToolType.BSD };
                }
                break;
            }
            case 'darwin': {
                const gnuTar = yield io.which('gtar', false);
                if (gnuTar) {
                    // fix permission denied errors when extracting BSD tar archive with GNU tar - https://github.com/actions/cache/issues/527
                    return { path: gnuTar, type: ArchiveToolType.GNU };
                }
                else {
                    return {
                        path: yield io.which('tar', true),
                        type: ArchiveToolType.BSD
                    };
                }
            }
            default:
                break;
        }
        // Default assumption is GNU tar is present in path
        return {
            path: yield io.which('tar', true),
            type: ArchiveToolType.GNU
        };
    });
}
// Return arguments for tar as per tarPath, compressionMethod, method type and os
function getTarArgs(tarPath_1, compressionMethod_1, type_1) {
    return __awaiter(this, arguments, void 0, function* (tarPath, compressionMethod, type, archivePath = '') {
        const args = [`"${tarPath.path}"`];
        const cacheFileName = utils.getCacheFileName(compressionMethod);
        const tarFile = 'cache.tar';
        const workingDirectory = getWorkingDirectory();
        // Speficic args for BSD tar on windows for workaround
        const BSD_TAR_ZSTD = tarPath.type === ArchiveToolType.BSD &&
            compressionMethod !== CompressionMethod.Gzip &&
            IS_WINDOWS;
        // Method specific args
        switch (type) {
            case 'create':
                args.push('--posix', '-cf', BSD_TAR_ZSTD
                    ? tarFile
                    : cacheFileName.replace(new RegExp(`\\${path.sep}`, 'g'), '/'), '--exclude', BSD_TAR_ZSTD
                    ? tarFile
                    : cacheFileName.replace(new RegExp(`\\${path.sep}`, 'g'), '/'), '-P', '-C', workingDirectory.replace(new RegExp(`\\${path.sep}`, 'g'), '/'), '--files-from', ManifestFilename);
                break;
            case 'extract':
                args.push('-xf', BSD_TAR_ZSTD
                    ? tarFile
                    : archivePath.replace(new RegExp(`\\${path.sep}`, 'g'), '/'), '-P', '-C', workingDirectory.replace(new RegExp(`\\${path.sep}`, 'g'), '/'));
                break;
            case 'list':
                args.push('-tf', BSD_TAR_ZSTD
                    ? tarFile
                    : archivePath.replace(new RegExp(`\\${path.sep}`, 'g'), '/'), '-P');
                break;
        }
        // Platform specific args
        if (tarPath.type === ArchiveToolType.GNU) {
            switch (process.platform) {
                case 'win32':
                    args.push('--force-local');
                    break;
                case 'darwin':
                    args.push('--delay-directory-restore');
                    break;
            }
        }
        return args;
    });
}
// Returns commands to run tar and compression program
function getCommands(compressionMethod_1, type_1) {
    return __awaiter(this, arguments, void 0, function* (compressionMethod, type, archivePath = '') {
        let args;
        const tarPath = yield getTarPath();
        const tarArgs = yield getTarArgs(tarPath, compressionMethod, type, archivePath);
        const compressionArgs = type !== 'create'
            ? yield getDecompressionProgram(tarPath, compressionMethod, archivePath)
            : yield getCompressionProgram(tarPath, compressionMethod);
        const BSD_TAR_ZSTD = tarPath.type === ArchiveToolType.BSD &&
            compressionMethod !== CompressionMethod.Gzip &&
            IS_WINDOWS;
        if (BSD_TAR_ZSTD && type !== 'create') {
            args = [[...compressionArgs].join(' '), [...tarArgs].join(' ')];
        }
        else {
            args = [[...tarArgs].join(' '), [...compressionArgs].join(' ')];
        }
        if (BSD_TAR_ZSTD) {
            return args;
        }
        return [args.join(' ')];
    });
}
function getWorkingDirectory() {
    var _a;
    return (_a = process.env['GITHUB_WORKSPACE']) !== null && _a !== void 0 ? _a : process.cwd();
}
// Common function for extractTar and listTar to get the compression method
function getDecompressionProgram(tarPath, compressionMethod, archivePath) {
    return __awaiter(this, void 0, void 0, function* () {
        // -d: Decompress.
        // unzstd is equivalent to 'zstd -d'
        // --long=#: Enables long distance matching with # bits. Maximum is 30 (1GB) on 32-bit OS and 31 (2GB) on 64-bit.
        // Using 30 here because we also support 32-bit self-hosted runners.
        const BSD_TAR_ZSTD = tarPath.type === ArchiveToolType.BSD &&
            compressionMethod !== CompressionMethod.Gzip &&
            IS_WINDOWS;
        switch (compressionMethod) {
            case CompressionMethod.Zstd:
                return BSD_TAR_ZSTD
                    ? [
                        'zstd -d --long=30 --force -o',
                        TarFilename,
                        archivePath.replace(new RegExp(`\\${path.sep}`, 'g'), '/')
                    ]
                    : [
                        '--use-compress-program',
                        IS_WINDOWS ? '"zstd -d --long=30"' : 'unzstd --long=30'
                    ];
            case CompressionMethod.ZstdWithoutLong:
                return BSD_TAR_ZSTD
                    ? [
                        'zstd -d --force -o',
                        TarFilename,
                        archivePath.replace(new RegExp(`\\${path.sep}`, 'g'), '/')
                    ]
                    : ['--use-compress-program', IS_WINDOWS ? '"zstd -d"' : 'unzstd'];
            default:
                return ['-z'];
        }
    });
}
// Used for creating the archive
// -T#: Compress using # working thread. If # is 0, attempt to detect and use the number of physical CPU cores.
// zstdmt is equivalent to 'zstd -T0'
// --long=#: Enables long distance matching with # bits. Maximum is 30 (1GB) on 32-bit OS and 31 (2GB) on 64-bit.
// Using 30 here because we also support 32-bit self-hosted runners.
// Long range mode is added to zstd in v1.3.2 release, so we will not use --long in older version of zstd.
function getCompressionProgram(tarPath, compressionMethod) {
    return __awaiter(this, void 0, void 0, function* () {
        const cacheFileName = utils.getCacheFileName(compressionMethod);
        const BSD_TAR_ZSTD = tarPath.type === ArchiveToolType.BSD &&
            compressionMethod !== CompressionMethod.Gzip &&
            IS_WINDOWS;
        switch (compressionMethod) {
            case CompressionMethod.Zstd:
                return BSD_TAR_ZSTD
                    ? [
                        'zstd -T0 --long=30 --force -o',
                        cacheFileName.replace(new RegExp(`\\${path.sep}`, 'g'), '/'),
                        TarFilename
                    ]
                    : [
                        '--use-compress-program',
                        IS_WINDOWS ? '"zstd -T0 --long=30"' : 'zstdmt --long=30'
                    ];
            case CompressionMethod.ZstdWithoutLong:
                return BSD_TAR_ZSTD
                    ? [
                        'zstd -T0 --force -o',
                        cacheFileName.replace(new RegExp(`\\${path.sep}`, 'g'), '/'),
                        TarFilename
                    ]
                    : ['--use-compress-program', IS_WINDOWS ? '"zstd -T0"' : 'zstdmt'];
            default:
                return ['-z'];
        }
    });
}
// Executes all commands as separate processes
function execCommands(commands, cwd) {
    return __awaiter(this, void 0, void 0, function* () {
        for (const command of commands) {
            try {
                yield exec(command, undefined, {
                    cwd,
                    env: Object.assign(Object.assign({}, process.env), { MSYS: 'winsymlinks:nativestrict' })
                });
            }
            catch (error) {
                throw new Error(`${command.split(' ')[0]} failed with error: ${error === null || error === void 0 ? void 0 : error.message}`);
            }
        }
    });
}
// List the contents of a tar
export function listTar(archivePath, compressionMethod) {
    return __awaiter(this, void 0, void 0, function* () {
        const commands = yield getCommands(compressionMethod, 'list', archivePath);
        yield execCommands(commands);
    });
}
// Extract a tar
export function extractTar(archivePath, compressionMethod) {
    return __awaiter(this, void 0, void 0, function* () {
        // Create directory to extract tar into
        const workingDirectory = getWorkingDirectory();
        yield io.mkdirP(workingDirectory);
        const commands = yield getCommands(compressionMethod, 'extract', archivePath);
        yield execCommands(commands);
    });
}
// Create a tar
export function createTar(archiveFolder, sourceDirectories, compressionMethod) {
    return __awaiter(this, void 0, void 0, function* () {
        // Write source directories to manifest.txt to avoid command length limits
        writeFileSync(path.join(archiveFolder, ManifestFilename), sourceDirectories.join('\n'));
        const commands = yield getCommands(compressionMethod, 'create');
        yield execCommands(commands, archiveFolder);
    });
}
//# sourceMappingURL=tar.js.map