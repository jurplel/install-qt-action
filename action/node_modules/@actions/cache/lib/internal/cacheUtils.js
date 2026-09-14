var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as glob from '@actions/glob';
import * as io from '@actions/io';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as semver from 'semver';
import * as util from 'util';
import { CacheFilename, CompressionMethod, GnuTarPathOnWindows } from './constants.js';
const versionSalt = '1.0';
// From https://github.com/actions/toolkit/blob/main/packages/tool-cache/src/tool-cache.ts#L23
export function createTempDirectory() {
    return __awaiter(this, void 0, void 0, function* () {
        const IS_WINDOWS = process.platform === 'win32';
        let tempDirectory = process.env['RUNNER_TEMP'] || '';
        if (!tempDirectory) {
            let baseLocation;
            if (IS_WINDOWS) {
                // On Windows use the USERPROFILE env variable
                baseLocation = process.env['USERPROFILE'] || 'C:\\';
            }
            else {
                if (process.platform === 'darwin') {
                    baseLocation = '/Users';
                }
                else {
                    baseLocation = '/home';
                }
            }
            tempDirectory = path.join(baseLocation, 'actions', 'temp');
        }
        const dest = path.join(tempDirectory, crypto.randomUUID());
        yield io.mkdirP(dest);
        return dest;
    });
}
export function getArchiveFileSizeInBytes(filePath) {
    return fs.statSync(filePath).size;
}
export function resolvePaths(patterns) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, e_1, _b, _c;
        var _d;
        const paths = [];
        const workspace = (_d = process.env['GITHUB_WORKSPACE']) !== null && _d !== void 0 ? _d : process.cwd();
        const globber = yield glob.create(patterns.join('\n'), {
            implicitDescendants: false
        });
        try {
            for (var _e = true, _f = __asyncValues(globber.globGenerator()), _g; _g = yield _f.next(), _a = _g.done, !_a; _e = true) {
                _c = _g.value;
                _e = false;
                const file = _c;
                const relativeFile = path
                    .relative(workspace, file)
                    .replace(new RegExp(`\\${path.sep}`, 'g'), '/');
                core.debug(`Matched: ${relativeFile}`);
                // Paths are made relative so the tar entries are all relative to the root of the workspace.
                if (relativeFile === '') {
                    // path.relative returns empty string if workspace and file are equal
                    paths.push('.');
                }
                else {
                    paths.push(`${relativeFile}`);
                }
            }
        }
        catch (e_1_1) { e_1 = { error: e_1_1 }; }
        finally {
            try {
                if (!_e && !_a && (_b = _f.return)) yield _b.call(_f);
            }
            finally { if (e_1) throw e_1.error; }
        }
        return paths;
    });
}
export function unlinkFile(filePath) {
    return __awaiter(this, void 0, void 0, function* () {
        return util.promisify(fs.unlink)(filePath);
    });
}
function getVersion(app_1) {
    return __awaiter(this, arguments, void 0, function* (app, additionalArgs = []) {
        let versionOutput = '';
        additionalArgs.push('--version');
        core.debug(`Checking ${app} ${additionalArgs.join(' ')}`);
        try {
            yield exec.exec(`${app}`, additionalArgs, {
                ignoreReturnCode: true,
                silent: true,
                listeners: {
                    stdout: (data) => (versionOutput += data.toString()),
                    stderr: (data) => (versionOutput += data.toString())
                }
            });
        }
        catch (err) {
            core.debug(err.message);
        }
        versionOutput = versionOutput.trim();
        core.debug(versionOutput);
        return versionOutput;
    });
}
// Use zstandard if possible to maximize cache performance
export function getCompressionMethod() {
    return __awaiter(this, void 0, void 0, function* () {
        const versionOutput = yield getVersion('zstd', ['--quiet']);
        const version = semver.clean(versionOutput);
        core.debug(`zstd version: ${version}`);
        if (versionOutput === '') {
            return CompressionMethod.Gzip;
        }
        else {
            return CompressionMethod.ZstdWithoutLong;
        }
    });
}
export function getCacheFileName(compressionMethod) {
    return compressionMethod === CompressionMethod.Gzip
        ? CacheFilename.Gzip
        : CacheFilename.Zstd;
}
export function getGnuTarPathOnWindows() {
    return __awaiter(this, void 0, void 0, function* () {
        if (fs.existsSync(GnuTarPathOnWindows)) {
            return GnuTarPathOnWindows;
        }
        const versionOutput = yield getVersion('tar');
        return versionOutput.toLowerCase().includes('gnu tar') ? io.which('tar') : '';
    });
}
export function assertDefined(name, value) {
    if (value === undefined) {
        throw Error(`Expected ${name} but value was undefiend`);
    }
    return value;
}
export function getCacheVersion(paths, compressionMethod, enableCrossOsArchive = false) {
    // don't pass changes upstream
    const components = paths.slice();
    // Add compression method to cache version to restore
    // compressed cache as per compression method
    if (compressionMethod) {
        components.push(compressionMethod);
    }
    // Only check for windows platforms if enableCrossOsArchive is false
    if (process.platform === 'win32' && !enableCrossOsArchive) {
        components.push('windows-only');
    }
    // Add salt to cache version to support breaking changes in cache entry
    components.push(versionSalt);
    return crypto.createHash('sha256').update(components.join('|')).digest('hex');
}
export function getRuntimeToken() {
    const token = process.env['ACTIONS_RUNTIME_TOKEN'];
    if (!token) {
        throw new Error('Unable to get the ACTIONS_RUNTIME_TOKEN env variable');
    }
    return token;
}
//# sourceMappingURL=cacheUtils.js.map