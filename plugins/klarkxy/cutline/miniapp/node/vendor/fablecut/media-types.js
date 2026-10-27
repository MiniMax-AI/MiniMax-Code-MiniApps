/* ═══════════════════════════════════════════════════════════════════════════
   What may live in the managed folders.

   The editor serves /media/ and /library/ from the same origin as its own
   page. A file a browser would RUN there — an HTML page, a script, an XML
   document — is therefore a script sink: opened as a document, it would
   execute on the editor's origin. So the lists below are the file types the
   editor treats as media (video, audio, image, SVG) plus the fonts the asset
   library holds, and everything else is refused where a file would be copied
   in.

   The media list is the union of the kinds the editor's own media module
   (media-lib.js), the MCP tools and the page's file picker already accept, so
   nothing that works today stops working.
   ═══════════════════════════════════════════════════════════════════════════ */
"use strict";
const path = require("path");

/** Extension → media kind. */
const MEDIA_KIND_BY_EXT = {
  ".mp4": "video", ".webm": "video", ".mov": "video", ".mkv": "video", ".m4v": "video",
  ".avi": "video", ".mpg": "video", ".mpeg": "video",
  ".mp3": "audio", ".wav": "audio", ".ogg": "audio", ".m4a": "audio", ".aac": "audio",
  ".flac": "audio", ".opus": "audio", ".wma": "audio",
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image", ".webp": "image",
  ".bmp": "image", ".avif": "image",
  ".svg": "svg",
};
/** Font files the asset library holds (library/fonts). */
const FONT_EXT = new Set([".ttf", ".otf", ".woff", ".woff2"]);
/** Types a browser may execute, or render as a document of its own. */
const DOCUMENT_EXT = new Set([
  ".html", ".htm", ".xhtml", ".xht", ".shtml", ".mhtml", ".mht", ".hta",
  ".xml", ".xsl", ".xslt", ".js", ".mjs", ".wasm", ".svg",
]);

/** The lower-case extension of a file name, with the dot. @param {string} name */
function extOf(name) {
  return path.extname(String(name || "")).toLowerCase();
}
/** video | audio | image | svg from a file name, or null. @param {string} name */
function kindFromName(name) {
  return MEDIA_KIND_BY_EXT[extOf(name)] || null;
}
/** A media file: video, audio, image or SVG. @param {string} name */
function isMediaName(name) {
  return kindFromName(name) !== null;
}
/** A media file or a font — anything the managed folders may hold. @param {string} name */
function isManagedName(name) {
  const ext = extOf(name);
  return MEDIA_KIND_BY_EXT[ext] !== undefined || FONT_EXT.has(ext);
}
/** A type a browser would execute, or render as a document. @param {string} name */
function isDocumentName(name) {
  return DOCUMENT_EXT.has(extOf(name));
}
/**
 * The refusal message for a file that may not be copied into media/.
 *
 * @param {string} name
 * @param {string} what what the file was (the upload, the media file …)
 */
function refuseMessage(name, what) {
  return `${what} ${JSON.stringify(String(name))} is not a media file — ` +
    `only video, audio, image and SVG files are kept in media/`;
}
/**
 * The refusal message for a file that may not be copied into the library.
 *
 * @param {string} name
 */
function refuseLibraryMessage(name) {
  return `library asset ${JSON.stringify(String(name))} is not a library asset — ` +
    `a library holds media files and fonts`;
}

module.exports = {
  MEDIA_KIND_BY_EXT, FONT_EXT, DOCUMENT_EXT,
  extOf, kindFromName, isMediaName, isManagedName, isDocumentName,
  refuseMessage, refuseLibraryMessage,
};
