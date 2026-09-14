// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
export function isNodeReadableStream(x) {
    return Boolean(x && typeof x["pipe"] === "function");
}
export function isWebReadableStream(x) {
    return Boolean(x &&
        typeof x.getReader === "function" &&
        typeof x.tee === "function");
}
export function isBinaryBody(body) {
    return (body !== undefined &&
        (body instanceof Uint8Array ||
            isReadableStream(body) ||
            typeof body === "function" ||
            (typeof Blob !== "undefined" && body instanceof Blob)));
}
export function isReadableStream(x) {
    return isNodeReadableStream(x) || isWebReadableStream(x);
}
export function isBlob(x) {
    return typeof Blob !== "undefined" && x instanceof Blob;
}
//# sourceMappingURL=typeGuards.js.map