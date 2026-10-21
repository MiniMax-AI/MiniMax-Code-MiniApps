"use strict";
(globalThis["webpackChunkopenchatcut"] = globalThis["webpackChunkopenchatcut"] || []).push([[825],{

/***/ 7825
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  z: () => (/* reexport */ external_namespaceObject)
});

// UNUSED EXPORTS: $brand, $input, $output, NEVER, TimePrecision, ZodAny, ZodArray, ZodBase64, ZodBase64URL, ZodBigInt, ZodBigIntFormat, ZodBoolean, ZodCIDRv4, ZodCIDRv6, ZodCUID, ZodCUID2, ZodCatch, ZodCodec, ZodCustom, ZodCustomStringFormat, ZodDate, ZodDefault, ZodDiscriminatedUnion, ZodE164, ZodEmail, ZodEmoji, ZodEnum, ZodError, ZodExactOptional, ZodFile, ZodFirstPartyTypeKind, ZodFunction, ZodGUID, ZodIPv4, ZodIPv6, ZodISODate, ZodISODateTime, ZodISODuration, ZodISOTime, ZodIntersection, ZodIssueCode, ZodJWT, ZodKSUID, ZodLazy, ZodLiteral, ZodMAC, ZodMap, ZodNaN, ZodNanoID, ZodNever, ZodNonOptional, ZodNull, ZodNullable, ZodNumber, ZodNumberFormat, ZodObject, ZodOptional, ZodPipe, ZodPrefault, ZodPreprocess, ZodPromise, ZodReadonly, ZodRealError, ZodRecord, ZodSet, ZodString, ZodStringFormat, ZodSuccess, ZodSymbol, ZodTemplateLiteral, ZodTransform, ZodTuple, ZodType, ZodULID, ZodURL, ZodUUID, ZodUndefined, ZodUnion, ZodUnknown, ZodVoid, ZodXID, ZodXor, _ZodString, _default, _function, any, array, base64, base64url, bigint, boolean, catch, check, cidrv4, cidrv6, clone, codec, coerce, config, core, cuid, cuid2, custom, date, decode, decodeAsync, default, describe, discriminatedUnion, e164, email, emoji, encode, encodeAsync, endsWith, enum, exactOptional, file, flattenError, float32, float64, formatError, fromJSONSchema, function, getErrorMap, globalRegistry, gt, gte, guid, hash, hex, hostname, httpUrl, includes, instanceof, int, int32, int64, intersection, invertCodec, ipv4, ipv6, iso, json, jwt, keyof, ksuid, lazy, length, literal, locales, looseObject, looseRecord, lowercase, lt, lte, mac, map, maxLength, maxSize, meta, mime, minLength, minSize, multipleOf, nan, nanoid, nativeEnum, negative, never, nonnegative, nonoptional, nonpositive, normalize, null, nullable, nullish, number, object, optional, overwrite, parse, parseAsync, partialRecord, pipe, positive, prefault, preprocess, prettifyError, promise, property, readonly, record, refine, regex, regexes, registry, safeDecode, safeDecodeAsync, safeEncode, safeEncodeAsync, safeParse, safeParseAsync, set, setErrorMap, size, slugify, startsWith, strictObject, string, stringFormat, stringbool, success, superRefine, symbol, templateLiteral, toJSONSchema, toLowerCase, toUpperCase, transform, treeifyError, trim, tuple, uint32, uint64, ulid, undefined, union, unknown, uppercase, url, util, uuid, uuidv4, uuidv6, uuidv7, void, xid, xor

// NAMESPACE OBJECT: ./node_modules/zod/v4/locales/index.js
var locales_namespaceObject = {};
__webpack_require__.r(locales_namespaceObject);
__webpack_require__.d(locales_namespaceObject, {
  ar: () => (ar),
  az: () => (az),
  be: () => (be),
  bg: () => (bg),
  ca: () => (ca),
  cs: () => (cs),
  da: () => (da),
  de: () => (de),
  el: () => (el),
  en: () => (en),
  eo: () => (eo),
  es: () => (es),
  fa: () => (fa),
  fi: () => (fi),
  fr: () => (fr),
  frCA: () => (fr_CA),
  he: () => (he),
  hr: () => (hr),
  hu: () => (hu),
  hy: () => (hy),
  id: () => (id),
  is: () => (is),
  it: () => (it),
  ja: () => (ja),
  ka: () => (ka),
  kh: () => (kh),
  km: () => (km),
  ko: () => (ko),
  lt: () => (lt),
  mk: () => (mk),
  ms: () => (ms),
  nl: () => (nl),
  no: () => (no),
  ota: () => (ota),
  pl: () => (pl),
  ps: () => (ps),
  pt: () => (pt),
  ro: () => (ro),
  ru: () => (ru),
  sl: () => (sl),
  sv: () => (sv),
  ta: () => (ta),
  th: () => (th),
  tr: () => (tr),
  ua: () => (ua),
  uk: () => (uk),
  ur: () => (ur),
  uz: () => (uz),
  vi: () => (vi),
  yo: () => (yo),
  zhCN: () => (zh_CN),
  zhTW: () => (zh_TW)
});

// NAMESPACE OBJECT: ./node_modules/zod/v4/core/json-schema.js
var json_schema_namespaceObject = {};
__webpack_require__.r(json_schema_namespaceObject);

// NAMESPACE OBJECT: ./node_modules/zod/v4/core/index.js
var core_namespaceObject = {};
__webpack_require__.r(core_namespaceObject);
__webpack_require__.d(core_namespaceObject, {
  $ZodAny: () => (schemas/* $ZodAny */.Gb),
  $ZodArray: () => (schemas/* $ZodArray */.$p),
  $ZodAsyncError: () => (core/* $ZodAsyncError */.GT),
  $ZodBase64: () => (schemas/* $ZodBase64 */.Dq),
  $ZodBase64URL: () => (schemas/* $ZodBase64URL */.CQ),
  $ZodBigInt: () => (schemas/* $ZodBigInt */.BN),
  $ZodBigIntFormat: () => (schemas/* $ZodBigIntFormat */.IT),
  $ZodBoolean: () => (schemas/* $ZodBoolean */.sF),
  $ZodCIDRv4: () => (schemas/* $ZodCIDRv4 */.CI),
  $ZodCIDRv6: () => (schemas/* $ZodCIDRv6 */.Cn),
  $ZodCUID: () => (schemas/* $ZodCUID */.bl),
  $ZodCUID2: () => (schemas/* $ZodCUID2 */.Zu),
  $ZodCatch: () => (schemas/* $ZodCatch */.t$),
  $ZodCheck: () => (checks/* $ZodCheck */.QP),
  $ZodCheckBigIntFormat: () => (checks/* $ZodCheckBigIntFormat */.uE),
  $ZodCheckEndsWith: () => (checks/* $ZodCheckEndsWith */.E6),
  $ZodCheckGreaterThan: () => (checks/* $ZodCheckGreaterThan */.J_),
  $ZodCheckIncludes: () => (checks/* $ZodCheckIncludes */.Tt),
  $ZodCheckLengthEquals: () => (checks/* $ZodCheckLengthEquals */.RM),
  $ZodCheckLessThan: () => (checks/* $ZodCheckLessThan */.sm),
  $ZodCheckLowerCase: () => (checks/* $ZodCheckLowerCase */.NI),
  $ZodCheckMaxLength: () => (checks/* $ZodCheckMaxLength */.Yk),
  $ZodCheckMaxSize: () => (checks/* $ZodCheckMaxSize */.j2),
  $ZodCheckMimeType: () => (checks/* $ZodCheckMimeType */.sj),
  $ZodCheckMinLength: () => (checks/* $ZodCheckMinLength */.Kk),
  $ZodCheckMinSize: () => (checks/* $ZodCheckMinSize */.PH),
  $ZodCheckMultipleOf: () => (checks/* $ZodCheckMultipleOf */.Jk),
  $ZodCheckNumberFormat: () => (checks/* $ZodCheckNumberFormat */.KH),
  $ZodCheckOverwrite: () => (checks/* $ZodCheckOverwrite */.v$),
  $ZodCheckProperty: () => (checks/* $ZodCheckProperty */.XF),
  $ZodCheckRegex: () => (checks/* $ZodCheckRegex */.DG),
  $ZodCheckSizeEquals: () => (checks/* $ZodCheckSizeEquals */.e2),
  $ZodCheckStartsWith: () => (checks/* $ZodCheckStartsWith */.J),
  $ZodCheckStringFormat: () => (checks/* $ZodCheckStringFormat */.ql),
  $ZodCheckUpperCase: () => (checks/* $ZodCheckUpperCase */.kH),
  $ZodCodec: () => (schemas/* $ZodCodec */.YY),
  $ZodCustom: () => (schemas/* $ZodCustom */.b0),
  $ZodCustomStringFormat: () => (schemas/* $ZodCustomStringFormat */.ZQ),
  $ZodDate: () => (schemas/* $ZodDate */.o5),
  $ZodDefault: () => (schemas/* $ZodDefault */.rv),
  $ZodDiscriminatedUnion: () => (schemas/* $ZodDiscriminatedUnion */.P0),
  $ZodE164: () => (schemas/* $ZodE164 */.Oy),
  $ZodEmail: () => (schemas/* $ZodEmail */.qG),
  $ZodEmoji: () => (schemas/* $ZodEmoji */.cG),
  $ZodEncodeError: () => (core/* $ZodEncodeError */.cV),
  $ZodEnum: () => (schemas/* $ZodEnum */.VO),
  $ZodError: () => (errors/* $ZodError */.a$),
  $ZodExactOptional: () => (schemas/* $ZodExactOptional */.RL),
  $ZodFile: () => (schemas/* $ZodFile */.CT),
  $ZodFunction: () => (schemas/* $ZodFunction */._A),
  $ZodGUID: () => (schemas/* $ZodGUID */.Zc),
  $ZodIPv4: () => (schemas/* $ZodIPv4 */.Lc),
  $ZodIPv6: () => (schemas/* $ZodIPv6 */.Zy),
  $ZodISODate: () => (schemas/* $ZodISODate */.v1),
  $ZodISODateTime: () => (schemas/* $ZodISODateTime */.Ko),
  $ZodISODuration: () => (schemas/* $ZodISODuration */.$N),
  $ZodISOTime: () => (schemas/* $ZodISOTime */.Ax),
  $ZodIntersection: () => (schemas/* $ZodIntersection */.LJ),
  $ZodJWT: () => (schemas/* $ZodJWT */.h8),
  $ZodKSUID: () => (schemas/* $ZodKSUID */.GY),
  $ZodLazy: () => (schemas/* $ZodLazy */.kU),
  $ZodLiteral: () => (schemas/* $ZodLiteral */.nu),
  $ZodMAC: () => (schemas/* $ZodMAC */.rO),
  $ZodMap: () => (schemas/* $ZodMap */.eb),
  $ZodNaN: () => (schemas/* $ZodNaN */.zP),
  $ZodNanoID: () => (schemas/* $ZodNanoID */.Py),
  $ZodNever: () => (schemas/* $ZodNever */.Um),
  $ZodNonOptional: () => (schemas/* $ZodNonOptional */.N$),
  $ZodNull: () => (schemas/* $ZodNull */.x8),
  $ZodNullable: () => (schemas/* $ZodNullable */.qc),
  $ZodNumber: () => (schemas/* $ZodNumber */.vz),
  $ZodNumberFormat: () => (schemas/* $ZodNumberFormat */.I),
  $ZodObject: () => (schemas/* $ZodObject */.L8),
  $ZodObjectJIT: () => (schemas/* $ZodObjectJIT */.w),
  $ZodOptional: () => (schemas/* $ZodOptional */.ig),
  $ZodPipe: () => (schemas/* $ZodPipe */._m),
  $ZodPrefault: () => (schemas/* $ZodPrefault */.VF),
  $ZodPreprocess: () => (schemas/* $ZodPreprocess */.KX),
  $ZodPromise: () => (schemas/* $ZodPromise */.hA),
  $ZodReadonly: () => (schemas/* $ZodReadonly */.Sb),
  $ZodRealError: () => (errors/* $ZodRealError */.Kd),
  $ZodRecord: () => (schemas/* $ZodRecord */.h),
  $ZodRegistry: () => (registries/* $ZodRegistry */.rs),
  $ZodSet: () => (schemas/* $ZodSet */.Oi),
  $ZodString: () => (schemas/* $ZodString */.$v),
  $ZodStringFormat: () => (schemas/* $ZodStringFormat */.EY),
  $ZodSuccess: () => (schemas/* $ZodSuccess */.Dw),
  $ZodSymbol: () => (schemas/* $ZodSymbol */.U5),
  $ZodTemplateLiteral: () => (schemas/* $ZodTemplateLiteral */.d),
  $ZodTransform: () => (schemas/* $ZodTransform */.Wc),
  $ZodTuple: () => (schemas/* $ZodTuple */.G3),
  $ZodType: () => (schemas/* $ZodType */.W4),
  $ZodULID: () => (schemas/* $ZodULID */.g5),
  $ZodURL: () => (schemas/* $ZodURL */.VY),
  $ZodUUID: () => (schemas/* $ZodUUID */.Zn),
  $ZodUndefined: () => (schemas/* $ZodUndefined */.Mv),
  $ZodUnion: () => (schemas/* $ZodUnion */.cu),
  $ZodUnknown: () => (schemas/* $ZodUnknown */.GP),
  $ZodVoid: () => (schemas/* $ZodVoid */.WH),
  $ZodXID: () => (schemas/* $ZodXID */.TF),
  $ZodXor: () => (schemas/* $ZodXor */.pm),
  $brand: () => (core/* $brand */._e),
  $constructor: () => (core/* $constructor */.xI),
  $input: () => (registries/* $input */.nP),
  $output: () => (registries/* $output */.UY),
  Doc: () => (doc/* Doc */.J),
  JSONSchema: () => (json_schema_namespaceObject),
  JSONSchemaGenerator: () => (JSONSchemaGenerator),
  NEVER: () => (core/* NEVER */.tm),
  TimePrecision: () => (api/* TimePrecision */.So),
  _any: () => (api/* _any */.KA),
  _array: () => (api/* _array */.dZ),
  _base64: () => (api/* _base64 */.rt),
  _base64url: () => (api/* _base64url */.cU),
  _bigint: () => (api/* _bigint */.z$),
  _boolean: () => (api/* _boolean */._L),
  _catch: () => (api/* _catch */.nb),
  _check: () => (api/* _check */.ST),
  _cidrv4: () => (api/* _cidrv4 */.Uy),
  _cidrv6: () => (api/* _cidrv6 */.gP),
  _coercedBigint: () => (api/* _coercedBigint */.St),
  _coercedBoolean: () => (api/* _coercedBoolean */.dN),
  _coercedDate: () => (api/* _coercedDate */.B4),
  _coercedNumber: () => (api/* _coercedNumber */.qG),
  _coercedString: () => (api/* _coercedString */.K_),
  _cuid: () => (api/* _cuid */.fs),
  _cuid2: () => (api/* _cuid2 */.Bj),
  _custom: () => (api/* _custom */.FO),
  _date: () => (api/* _date */.YY),
  _decode: () => (parse/* _decode */.e2),
  _decodeAsync: () => (parse/* _decodeAsync */.or),
  _default: () => (api/* _default */.Rv),
  _discriminatedUnion: () => (api/* _discriminatedUnion */.FG),
  _e164: () => (api/* _e164 */.KB),
  _email: () => (api/* _email */.Mu),
  _emoji: () => (api/* _emoji */.aC),
  _encode: () => (parse/* _encode */.Mv),
  _encodeAsync: () => (parse/* _encodeAsync */.GW),
  _endsWith: () => (api/* _endsWith */.ER),
  _enum: () => (api/* _enum */.$8),
  _file: () => (api/* _file */.K2),
  _float32: () => (api/* _float32 */.HL),
  _float64: () => (api/* _float64 */.g6),
  _gt: () => (api/* _gt */.Tx),
  _gte: () => (api/* _gte */.qm),
  _guid: () => (api/* _guid */.tB),
  _includes: () => (api/* _includes */.dR),
  _int: () => (api/* _int */.LK),
  _int32: () => (api/* _int32 */.sw),
  _int64: () => (api/* _int64 */.Jg),
  _intersection: () => (api/* _intersection */.tj),
  _ipv4: () => (api/* _ipv4 */.Ny),
  _ipv6: () => (api/* _ipv6 */.$O),
  _isoDate: () => (api/* _isoDate */.db),
  _isoDateTime: () => (api/* _isoDateTime */.G1),
  _isoDuration: () => (api/* _isoDuration */.f2),
  _isoTime: () => (api/* _isoTime */.Kn),
  _jwt: () => (api/* _jwt */.rk),
  _ksuid: () => (api/* _ksuid */._z),
  _lazy: () => (api/* _lazy */.kx),
  _length: () => (api/* _length */.YA),
  _literal: () => (api/* _literal */.rn),
  _lowercase: () => (api/* _lowercase */.hH),
  _lt: () => (api/* _lt */.Au),
  _lte: () => (api/* _lte */.Zm),
  _mac: () => (api/* _mac */.R8),
  _map: () => (api/* _map */.rF),
  _max: () => (api/* _max */.Yv),
  _maxLength: () => (api/* _maxLength */.Eb),
  _maxSize: () => (api/* _maxSize */.vL),
  _mime: () => (api/* _mime */.GZ),
  _min: () => (api/* _min */.Q_),
  _minLength: () => (api/* _minLength */.m9),
  _minSize: () => (api/* _minSize */.Nd),
  _multipleOf: () => (api/* _multipleOf */.Hi),
  _nan: () => (api/* _nan */.L4),
  _nanoid: () => (api/* _nanoid */.Dl),
  _nativeEnum: () => (api/* _nativeEnum */.Un),
  _negative: () => (api/* _negative */.bR),
  _never: () => (api/* _never */.G8),
  _nonnegative: () => (api/* _nonnegative */.UI),
  _nonoptional: () => (api/* _nonoptional */.v$),
  _nonpositive: () => (api/* _nonpositive */.ej),
  _normalize: () => (api/* _normalize */.lo),
  _null: () => (api/* _null */.jw),
  _nullable: () => (api/* _nullable */.jS),
  _number: () => (api/* _number */.F7),
  _optional: () => (api/* _optional */.oI),
  _overwrite: () => (api/* _overwrite */.bS),
  _parse: () => (parse/* _parse */.Tj),
  _parseAsync: () => (parse/* _parseAsync */.Rb),
  _pipe: () => (api/* _pipe */.yz),
  _positive: () => (api/* _positive */.NC),
  _promise: () => (api/* _promise */.Z$),
  _property: () => (api/* _property */.Jf),
  _readonly: () => (api/* _readonly */.CM),
  _record: () => (api/* _record */.Bb),
  _refine: () => (api/* _refine */.fU),
  _regex: () => (api/* _regex */.Fk),
  _safeDecode: () => (parse/* _safeDecode */.VS),
  _safeDecodeAsync: () => (parse/* _safeDecodeAsync */.R3),
  _safeEncode: () => (parse/* _safeEncode */.rh),
  _safeEncodeAsync: () => (parse/* _safeEncodeAsync */.v_),
  _safeParse: () => (parse/* _safeParse */.Od),
  _safeParseAsync: () => (parse/* _safeParseAsync */.wG),
  _set: () => (api/* _set */.QC),
  _size: () => (api/* _size */.d$),
  _slugify: () => (api/* _slugify */.TL),
  _startsWith: () => (api/* _startsWith */.$S),
  _string: () => (api/* _string */.Rl),
  _stringFormat: () => (api/* _stringFormat */.Af),
  _stringbool: () => (api/* _stringbool */.fI),
  _success: () => (api/* _success */.P7),
  _superRefine: () => (api/* _superRefine */.MB),
  _symbol: () => (api/* _symbol */.W7),
  _templateLiteral: () => (api/* _templateLiteral */.Bt),
  _toLowerCase: () => (api/* _toLowerCase */.Il),
  _toUpperCase: () => (api/* _toUpperCase */.xY),
  _transform: () => (api/* _transform */.MQ),
  _trim: () => (api/* _trim */.WN),
  _tuple: () => (api/* _tuple */.gt),
  _uint32: () => (api/* _uint32 */.P),
  _uint64: () => (api/* _uint64 */.ii),
  _ulid: () => (api/* _ulid */.Ct),
  _undefined: () => (api/* _undefined */.E4),
  _union: () => (api/* _union */.h8),
  _unknown: () => (api/* _unknown */.em),
  _uppercase: () => (api/* _uppercase */.qF),
  _url: () => (api/* _url */.Fn),
  _uuid: () => (api/* _uuid */.Be),
  _uuidv4: () => (api/* _uuidv4 */.nA),
  _uuidv6: () => (api/* _uuidv6 */.pY),
  _uuidv7: () => (api/* _uuidv7 */.wA),
  _void: () => (api/* _void */.OC),
  _xid: () => (api/* _xid */.Pw),
  _xor: () => (api/* _xor */.f0),
  clone: () => (schemas/* clone */.o8),
  config: () => (core/* config */.$W),
  createStandardJSONSchemaMethod: () => (to_json_schema/* createStandardJSONSchemaMethod */.uE),
  createToJSONSchemaMethod: () => (to_json_schema/* createToJSONSchemaMethod */.OA),
  decode: () => (parse/* decode */.D4),
  decodeAsync: () => (parse/* decodeAsync */.Re),
  describe: () => (api/* describe */.q0),
  encode: () => (parse/* encode */.lF),
  encodeAsync: () => (parse/* encodeAsync */.X$),
  extractDefs: () => (to_json_schema/* extractDefs */.Wb),
  finalize: () => (to_json_schema/* finalize */.jE),
  flattenError: () => (errors/* flattenError */.JM),
  formatError: () => (errors/* formatError */.Wk),
  globalConfig: () => (core/* globalConfig */.cr),
  globalRegistry: () => (registries/* globalRegistry */.fd),
  initializeContext: () => (to_json_schema/* initializeContext */.az),
  isValidBase64: () => (schemas/* isValidBase64 */.UY),
  isValidBase64URL: () => (schemas/* isValidBase64URL */.tV),
  isValidJWT: () => (schemas/* isValidJWT */.c2),
  locales: () => (locales_namespaceObject),
  meta: () => (api/* meta */.mI),
  parse: () => (parse/* parse */.qg),
  parseAsync: () => (parse/* parseAsync */.EJ),
  prettifyError: () => (errors/* prettifyError */.S1),
  process: () => (to_json_schema/* process */.eh),
  regexes: () => (regexes),
  registry: () => (registries/* registry */.u5),
  safeDecode: () => (parse/* safeDecode */.ex),
  safeDecodeAsync: () => (parse/* safeDecodeAsync */.yR),
  safeEncode: () => (parse/* safeEncode */.wy),
  safeEncodeAsync: () => (parse/* safeEncodeAsync */.EM),
  safeParse: () => (parse/* safeParse */.xL),
  safeParseAsync: () => (parse/* safeParseAsync */.bp),
  toDotPath: () => (errors/* toDotPath */.sR),
  toJSONSchema: () => (json_schema_processors/* toJSONSchema */.bl),
  treeifyError: () => (errors/* treeifyError */.ZC),
  util: () => (util),
  version: () => (versions/* version */.r)
});

// NAMESPACE OBJECT: ./node_modules/zod/v4/classic/checks.js
var checks_namespaceObject = {};
__webpack_require__.r(checks_namespaceObject);
__webpack_require__.d(checks_namespaceObject, {
  endsWith: () => (api/* _endsWith */.ER),
  gt: () => (api/* _gt */.Tx),
  gte: () => (api/* _gte */.qm),
  includes: () => (api/* _includes */.dR),
  length: () => (api/* _length */.YA),
  lowercase: () => (api/* _lowercase */.hH),
  lt: () => (api/* _lt */.Au),
  lte: () => (api/* _lte */.Zm),
  maxLength: () => (api/* _maxLength */.Eb),
  maxSize: () => (api/* _maxSize */.vL),
  mime: () => (api/* _mime */.GZ),
  minLength: () => (api/* _minLength */.m9),
  minSize: () => (api/* _minSize */.Nd),
  multipleOf: () => (api/* _multipleOf */.Hi),
  negative: () => (api/* _negative */.bR),
  nonnegative: () => (api/* _nonnegative */.UI),
  nonpositive: () => (api/* _nonpositive */.ej),
  normalize: () => (api/* _normalize */.lo),
  overwrite: () => (api/* _overwrite */.bS),
  positive: () => (api/* _positive */.NC),
  property: () => (api/* _property */.Jf),
  regex: () => (api/* _regex */.Fk),
  size: () => (api/* _size */.d$),
  slugify: () => (api/* _slugify */.TL),
  startsWith: () => (api/* _startsWith */.$S),
  toLowerCase: () => (api/* _toLowerCase */.Il),
  toUpperCase: () => (api/* _toUpperCase */.xY),
  trim: () => (api/* _trim */.WN),
  uppercase: () => (api/* _uppercase */.qF)
});

// NAMESPACE OBJECT: ./node_modules/zod/v4/classic/coerce.js
var coerce_namespaceObject = {};
__webpack_require__.r(coerce_namespaceObject);
__webpack_require__.d(coerce_namespaceObject, {
  bigint: () => (bigint),
  boolean: () => (coerce_boolean),
  date: () => (date),
  number: () => (number),
  string: () => (string)
});

// NAMESPACE OBJECT: ./node_modules/zod/v4/classic/external.js
var external_namespaceObject = {};
__webpack_require__.r(external_namespaceObject);
__webpack_require__.d(external_namespaceObject, {
  $brand: () => (core/* $brand */._e),
  $input: () => (registries/* $input */.nP),
  $output: () => (registries/* $output */.UY),
  NEVER: () => (core/* NEVER */.tm),
  TimePrecision: () => (api/* TimePrecision */.So),
  ZodAny: () => (classic_schemas.ZodAny),
  ZodArray: () => (classic_schemas.ZodArray),
  ZodBase64: () => (classic_schemas.ZodBase64),
  ZodBase64URL: () => (classic_schemas.ZodBase64URL),
  ZodBigInt: () => (classic_schemas.ZodBigInt),
  ZodBigIntFormat: () => (classic_schemas.ZodBigIntFormat),
  ZodBoolean: () => (classic_schemas.ZodBoolean),
  ZodCIDRv4: () => (classic_schemas.ZodCIDRv4),
  ZodCIDRv6: () => (classic_schemas.ZodCIDRv6),
  ZodCUID: () => (classic_schemas.ZodCUID),
  ZodCUID2: () => (classic_schemas.ZodCUID2),
  ZodCatch: () => (classic_schemas.ZodCatch),
  ZodCodec: () => (classic_schemas.ZodCodec),
  ZodCustom: () => (classic_schemas.ZodCustom),
  ZodCustomStringFormat: () => (classic_schemas.ZodCustomStringFormat),
  ZodDate: () => (classic_schemas.ZodDate),
  ZodDefault: () => (classic_schemas.ZodDefault),
  ZodDiscriminatedUnion: () => (classic_schemas.ZodDiscriminatedUnion),
  ZodE164: () => (classic_schemas.ZodE164),
  ZodEmail: () => (classic_schemas.ZodEmail),
  ZodEmoji: () => (classic_schemas.ZodEmoji),
  ZodEnum: () => (classic_schemas.ZodEnum),
  ZodError: () => (classic_errors/* ZodError */.G),
  ZodExactOptional: () => (classic_schemas.ZodExactOptional),
  ZodFile: () => (classic_schemas.ZodFile),
  ZodFirstPartyTypeKind: () => (ZodFirstPartyTypeKind),
  ZodFunction: () => (classic_schemas.ZodFunction),
  ZodGUID: () => (classic_schemas.ZodGUID),
  ZodIPv4: () => (classic_schemas.ZodIPv4),
  ZodIPv6: () => (classic_schemas.ZodIPv6),
  ZodISODate: () => (iso.ZodISODate),
  ZodISODateTime: () => (iso.ZodISODateTime),
  ZodISODuration: () => (iso.ZodISODuration),
  ZodISOTime: () => (iso.ZodISOTime),
  ZodIntersection: () => (classic_schemas.ZodIntersection),
  ZodIssueCode: () => (ZodIssueCode),
  ZodJWT: () => (classic_schemas.ZodJWT),
  ZodKSUID: () => (classic_schemas.ZodKSUID),
  ZodLazy: () => (classic_schemas.ZodLazy),
  ZodLiteral: () => (classic_schemas.ZodLiteral),
  ZodMAC: () => (classic_schemas.ZodMAC),
  ZodMap: () => (classic_schemas.ZodMap),
  ZodNaN: () => (classic_schemas.ZodNaN),
  ZodNanoID: () => (classic_schemas.ZodNanoID),
  ZodNever: () => (classic_schemas.ZodNever),
  ZodNonOptional: () => (classic_schemas.ZodNonOptional),
  ZodNull: () => (classic_schemas.ZodNull),
  ZodNullable: () => (classic_schemas.ZodNullable),
  ZodNumber: () => (classic_schemas.ZodNumber),
  ZodNumberFormat: () => (classic_schemas.ZodNumberFormat),
  ZodObject: () => (classic_schemas.ZodObject),
  ZodOptional: () => (classic_schemas.ZodOptional),
  ZodPipe: () => (classic_schemas.ZodPipe),
  ZodPrefault: () => (classic_schemas.ZodPrefault),
  ZodPreprocess: () => (classic_schemas.ZodPreprocess),
  ZodPromise: () => (classic_schemas.ZodPromise),
  ZodReadonly: () => (classic_schemas.ZodReadonly),
  ZodRealError: () => (classic_errors/* ZodRealError */.g),
  ZodRecord: () => (classic_schemas.ZodRecord),
  ZodSet: () => (classic_schemas.ZodSet),
  ZodString: () => (classic_schemas.ZodString),
  ZodStringFormat: () => (classic_schemas.ZodStringFormat),
  ZodSuccess: () => (classic_schemas.ZodSuccess),
  ZodSymbol: () => (classic_schemas.ZodSymbol),
  ZodTemplateLiteral: () => (classic_schemas.ZodTemplateLiteral),
  ZodTransform: () => (classic_schemas.ZodTransform),
  ZodTuple: () => (classic_schemas.ZodTuple),
  ZodType: () => (classic_schemas.ZodType),
  ZodULID: () => (classic_schemas.ZodULID),
  ZodURL: () => (classic_schemas.ZodURL),
  ZodUUID: () => (classic_schemas.ZodUUID),
  ZodUndefined: () => (classic_schemas.ZodUndefined),
  ZodUnion: () => (classic_schemas.ZodUnion),
  ZodUnknown: () => (classic_schemas.ZodUnknown),
  ZodVoid: () => (classic_schemas.ZodVoid),
  ZodXID: () => (classic_schemas.ZodXID),
  ZodXor: () => (classic_schemas.ZodXor),
  _ZodString: () => (classic_schemas._ZodString),
  _default: () => (classic_schemas._default),
  _function: () => (classic_schemas._function),
  any: () => (classic_schemas.any),
  array: () => (classic_schemas.array),
  base64: () => (classic_schemas.base64),
  base64url: () => (classic_schemas.base64url),
  bigint: () => (classic_schemas.bigint),
  boolean: () => (classic_schemas.boolean),
  "catch": () => (classic_schemas["catch"]),
  check: () => (classic_schemas.check),
  cidrv4: () => (classic_schemas.cidrv4),
  cidrv6: () => (classic_schemas.cidrv6),
  clone: () => (util.clone),
  codec: () => (classic_schemas.codec),
  coerce: () => (coerce_namespaceObject),
  config: () => (core/* config */.$W),
  core: () => (core_namespaceObject),
  cuid: () => (classic_schemas.cuid),
  cuid2: () => (classic_schemas.cuid2),
  custom: () => (classic_schemas.custom),
  date: () => (classic_schemas.date),
  decode: () => (classic_parse/* decode */.D4),
  decodeAsync: () => (classic_parse/* decodeAsync */.Re),
  describe: () => (classic_schemas.describe),
  discriminatedUnion: () => (classic_schemas.discriminatedUnion),
  e164: () => (classic_schemas.e164),
  email: () => (classic_schemas.email),
  emoji: () => (classic_schemas.emoji),
  encode: () => (classic_parse/* encode */.lF),
  encodeAsync: () => (classic_parse/* encodeAsync */.X$),
  endsWith: () => (api/* _endsWith */.ER),
  "enum": () => (classic_schemas["enum"]),
  exactOptional: () => (classic_schemas.exactOptional),
  file: () => (classic_schemas.file),
  flattenError: () => (errors/* flattenError */.JM),
  float32: () => (classic_schemas.float32),
  float64: () => (classic_schemas.float64),
  formatError: () => (errors/* formatError */.Wk),
  fromJSONSchema: () => (fromJSONSchema),
  "function": () => (classic_schemas["function"]),
  getErrorMap: () => (getErrorMap),
  globalRegistry: () => (registries/* globalRegistry */.fd),
  gt: () => (api/* _gt */.Tx),
  gte: () => (api/* _gte */.qm),
  guid: () => (classic_schemas.guid),
  hash: () => (classic_schemas.hash),
  hex: () => (classic_schemas.hex),
  hostname: () => (classic_schemas.hostname),
  httpUrl: () => (classic_schemas.httpUrl),
  includes: () => (api/* _includes */.dR),
  "instanceof": () => (classic_schemas["instanceof"]),
  int: () => (classic_schemas.int),
  int32: () => (classic_schemas.int32),
  int64: () => (classic_schemas.int64),
  intersection: () => (classic_schemas.intersection),
  invertCodec: () => (classic_schemas.invertCodec),
  ipv4: () => (classic_schemas.ipv4),
  ipv6: () => (classic_schemas.ipv6),
  iso: () => (iso),
  json: () => (classic_schemas.json),
  jwt: () => (classic_schemas.jwt),
  keyof: () => (classic_schemas.keyof),
  ksuid: () => (classic_schemas.ksuid),
  lazy: () => (classic_schemas.lazy),
  length: () => (api/* _length */.YA),
  literal: () => (classic_schemas.literal),
  locales: () => (locales_namespaceObject),
  looseObject: () => (classic_schemas.looseObject),
  looseRecord: () => (classic_schemas.looseRecord),
  lowercase: () => (api/* _lowercase */.hH),
  lt: () => (api/* _lt */.Au),
  lte: () => (api/* _lte */.Zm),
  mac: () => (classic_schemas.mac),
  map: () => (classic_schemas.map),
  maxLength: () => (api/* _maxLength */.Eb),
  maxSize: () => (api/* _maxSize */.vL),
  meta: () => (classic_schemas.meta),
  mime: () => (api/* _mime */.GZ),
  minLength: () => (api/* _minLength */.m9),
  minSize: () => (api/* _minSize */.Nd),
  multipleOf: () => (api/* _multipleOf */.Hi),
  nan: () => (classic_schemas.nan),
  nanoid: () => (classic_schemas.nanoid),
  nativeEnum: () => (classic_schemas.nativeEnum),
  negative: () => (api/* _negative */.bR),
  never: () => (classic_schemas.never),
  nonnegative: () => (api/* _nonnegative */.UI),
  nonoptional: () => (classic_schemas.nonoptional),
  nonpositive: () => (api/* _nonpositive */.ej),
  normalize: () => (api/* _normalize */.lo),
  "null": () => (classic_schemas["null"]),
  nullable: () => (classic_schemas.nullable),
  nullish: () => (classic_schemas.nullish),
  number: () => (classic_schemas.number),
  object: () => (classic_schemas.object),
  optional: () => (classic_schemas.optional),
  overwrite: () => (api/* _overwrite */.bS),
  parse: () => (classic_parse/* parse */.qg),
  parseAsync: () => (classic_parse/* parseAsync */.EJ),
  partialRecord: () => (classic_schemas.partialRecord),
  pipe: () => (classic_schemas.pipe),
  positive: () => (api/* _positive */.NC),
  prefault: () => (classic_schemas.prefault),
  preprocess: () => (classic_schemas.preprocess),
  prettifyError: () => (errors/* prettifyError */.S1),
  promise: () => (classic_schemas.promise),
  property: () => (api/* _property */.Jf),
  readonly: () => (classic_schemas.readonly),
  record: () => (classic_schemas.record),
  refine: () => (classic_schemas.refine),
  regex: () => (api/* _regex */.Fk),
  regexes: () => (regexes),
  registry: () => (registries/* registry */.u5),
  safeDecode: () => (classic_parse/* safeDecode */.ex),
  safeDecodeAsync: () => (classic_parse/* safeDecodeAsync */.yR),
  safeEncode: () => (classic_parse/* safeEncode */.wy),
  safeEncodeAsync: () => (classic_parse/* safeEncodeAsync */.EM),
  safeParse: () => (classic_parse/* safeParse */.xL),
  safeParseAsync: () => (classic_parse/* safeParseAsync */.bp),
  set: () => (classic_schemas.set),
  setErrorMap: () => (setErrorMap),
  size: () => (api/* _size */.d$),
  slugify: () => (api/* _slugify */.TL),
  startsWith: () => (api/* _startsWith */.$S),
  strictObject: () => (classic_schemas.strictObject),
  string: () => (classic_schemas.string),
  stringFormat: () => (classic_schemas.stringFormat),
  stringbool: () => (classic_schemas.stringbool),
  success: () => (classic_schemas.success),
  superRefine: () => (classic_schemas.superRefine),
  symbol: () => (classic_schemas.symbol),
  templateLiteral: () => (classic_schemas.templateLiteral),
  toJSONSchema: () => (json_schema_processors/* toJSONSchema */.bl),
  toLowerCase: () => (api/* _toLowerCase */.Il),
  toUpperCase: () => (api/* _toUpperCase */.xY),
  transform: () => (classic_schemas.transform),
  treeifyError: () => (errors/* treeifyError */.ZC),
  trim: () => (api/* _trim */.WN),
  tuple: () => (classic_schemas.tuple),
  uint32: () => (classic_schemas.uint32),
  uint64: () => (classic_schemas.uint64),
  ulid: () => (classic_schemas.ulid),
  undefined: () => (classic_schemas.undefined),
  union: () => (classic_schemas.union),
  unknown: () => (classic_schemas.unknown),
  uppercase: () => (api/* _uppercase */.qF),
  url: () => (classic_schemas.url),
  util: () => (util),
  uuid: () => (classic_schemas.uuid),
  uuidv4: () => (classic_schemas.uuidv4),
  uuidv6: () => (classic_schemas.uuidv6),
  uuidv7: () => (classic_schemas.uuidv7),
  "void": () => (classic_schemas["void"]),
  xid: () => (classic_schemas.xid),
  xor: () => (classic_schemas.xor)
});

// EXTERNAL MODULE: ./node_modules/zod/v4/core/core.js
var core = __webpack_require__(5435);
// EXTERNAL MODULE: ./node_modules/zod/v4/core/parse.js
var parse = __webpack_require__(2373);
// EXTERNAL MODULE: ./node_modules/zod/v4/core/errors.js
var errors = __webpack_require__(3371);
// EXTERNAL MODULE: ./node_modules/zod/v4/core/schemas.js
var schemas = __webpack_require__(666);
// EXTERNAL MODULE: ./node_modules/zod/v4/core/checks.js
var checks = __webpack_require__(9737);
// EXTERNAL MODULE: ./node_modules/zod/v4/core/versions.js
var versions = __webpack_require__(3457);
// EXTERNAL MODULE: ./node_modules/zod/v4/core/util.js
var util = __webpack_require__(7048);
// EXTERNAL MODULE: ./node_modules/zod/v4/core/regexes.js
var regexes = __webpack_require__(3705);
;// ./node_modules/zod/v4/locales/ar.js

const error = () => {
    const Sizable = {
        string: { unit: "حرف", verb: "أن يحوي" },
        file: { unit: "بايت", verb: "أن يحوي" },
        array: { unit: "عنصر", verb: "أن يحوي" },
        set: { unit: "عنصر", verb: "أن يحوي" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "مدخل",
        email: "بريد إلكتروني",
        url: "رابط",
        emoji: "إيموجي",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "تاريخ ووقت بمعيار ISO",
        date: "تاريخ بمعيار ISO",
        time: "وقت بمعيار ISO",
        duration: "مدة بمعيار ISO",
        ipv4: "عنوان IPv4",
        ipv6: "عنوان IPv6",
        cidrv4: "مدى عناوين بصيغة IPv4",
        cidrv6: "مدى عناوين بصيغة IPv6",
        base64: "نَص بترميز base64-encoded",
        base64url: "نَص بترميز base64url-encoded",
        json_string: "نَص على هيئة JSON",
        e164: "رقم هاتف بمعيار E.164",
        jwt: "JWT",
        template_literal: "مدخل",
    };
    const TypeDictionary = {
        nan: "NaN",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `مدخلات غير مقبولة: يفترض إدخال instanceof ${issue.expected}، ولكن تم إدخال ${received}`;
                }
                return `مدخلات غير مقبولة: يفترض إدخال ${expected}، ولكن تم إدخال ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `مدخلات غير مقبولة: يفترض إدخال ${util.stringifyPrimitive(issue.values[0])}`;
                return `اختيار غير مقبول: يتوقع انتقاء أحد هذه الخيارات: ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return ` أكبر من اللازم: يفترض أن تكون ${issue.origin ?? "القيمة"} ${adj} ${issue.maximum.toString()} ${sizing.unit ?? "عنصر"}`;
                return `أكبر من اللازم: يفترض أن تكون ${issue.origin ?? "القيمة"} ${adj} ${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `أصغر من اللازم: يفترض لـ ${issue.origin} أن يكون ${adj} ${issue.minimum.toString()} ${sizing.unit}`;
                }
                return `أصغر من اللازم: يفترض لـ ${issue.origin} أن يكون ${adj} ${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with")
                    return `نَص غير مقبول: يجب أن يبدأ بـ "${issue.prefix}"`;
                if (_issue.format === "ends_with")
                    return `نَص غير مقبول: يجب أن ينتهي بـ "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `نَص غير مقبول: يجب أن يتضمَّن "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `نَص غير مقبول: يجب أن يطابق النمط ${_issue.pattern}`;
                return `${FormatDictionary[_issue.format] ?? issue.format} غير مقبول`;
            }
            case "not_multiple_of":
                return `رقم غير مقبول: يجب أن يكون من مضاعفات ${issue.divisor}`;
            case "unrecognized_keys":
                return `معرف${issue.keys.length > 1 ? "ات" : ""} غريب${issue.keys.length > 1 ? "ة" : ""}: ${util.joinValues(issue.keys, "، ")}`;
            case "invalid_key":
                return `معرف غير مقبول في ${issue.origin}`;
            case "invalid_union":
                return "مدخل غير مقبول";
            case "invalid_element":
                return `مدخل غير مقبول في ${issue.origin}`;
            default:
                return "مدخل غير مقبول";
        }
    };
};
/* harmony default export */ function ar() {
    return {
        localeError: error(),
    };
}

;// ./node_modules/zod/v4/locales/az.js

const az_error = () => {
    const Sizable = {
        string: { unit: "simvol", verb: "olmalıdır" },
        file: { unit: "bayt", verb: "olmalıdır" },
        array: { unit: "element", verb: "olmalıdır" },
        set: { unit: "element", verb: "olmalıdır" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "input",
        email: "email address",
        url: "URL",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO datetime",
        date: "ISO date",
        time: "ISO time",
        duration: "ISO duration",
        ipv4: "IPv4 address",
        ipv6: "IPv6 address",
        cidrv4: "IPv4 range",
        cidrv6: "IPv6 range",
        base64: "base64-encoded string",
        base64url: "base64url-encoded string",
        json_string: "JSON string",
        e164: "E.164 number",
        jwt: "JWT",
        template_literal: "input",
    };
    const TypeDictionary = {
        nan: "NaN",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Yanlış dəyər: gözlənilən instanceof ${issue.expected}, daxil olan ${received}`;
                }
                return `Yanlış dəyər: gözlənilən ${expected}, daxil olan ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Yanlış dəyər: gözlənilən ${util.stringifyPrimitive(issue.values[0])}`;
                return `Yanlış seçim: aşağıdakılardan biri olmalıdır: ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `Çox böyük: gözlənilən ${issue.origin ?? "dəyər"} ${adj}${issue.maximum.toString()} ${sizing.unit ?? "element"}`;
                return `Çox böyük: gözlənilən ${issue.origin ?? "dəyər"} ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `Çox kiçik: gözlənilən ${issue.origin} ${adj}${issue.minimum.toString()} ${sizing.unit}`;
                return `Çox kiçik: gözlənilən ${issue.origin} ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with")
                    return `Yanlış mətn: "${_issue.prefix}" ilə başlamalıdır`;
                if (_issue.format === "ends_with")
                    return `Yanlış mətn: "${_issue.suffix}" ilə bitməlidir`;
                if (_issue.format === "includes")
                    return `Yanlış mətn: "${_issue.includes}" daxil olmalıdır`;
                if (_issue.format === "regex")
                    return `Yanlış mətn: ${_issue.pattern} şablonuna uyğun olmalıdır`;
                return `Yanlış ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Yanlış ədəd: ${issue.divisor} ilə bölünə bilən olmalıdır`;
            case "unrecognized_keys":
                return `Tanınmayan açar${issue.keys.length > 1 ? "lar" : ""}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `${issue.origin} daxilində yanlış açar`;
            case "invalid_union":
                return "Yanlış dəyər";
            case "invalid_element":
                return `${issue.origin} daxilində yanlış dəyər`;
            default:
                return `Yanlış dəyər`;
        }
    };
};
/* harmony default export */ function az() {
    return {
        localeError: az_error(),
    };
}

;// ./node_modules/zod/v4/locales/be.js

function getBelarusianPlural(count, one, few, many) {
    const absCount = Math.abs(count);
    const lastDigit = absCount % 10;
    const lastTwoDigits = absCount % 100;
    if (lastTwoDigits >= 11 && lastTwoDigits <= 19) {
        return many;
    }
    if (lastDigit === 1) {
        return one;
    }
    if (lastDigit >= 2 && lastDigit <= 4) {
        return few;
    }
    return many;
}
const be_error = () => {
    const Sizable = {
        string: {
            unit: {
                one: "сімвал",
                few: "сімвалы",
                many: "сімвалаў",
            },
            verb: "мець",
        },
        array: {
            unit: {
                one: "элемент",
                few: "элементы",
                many: "элементаў",
            },
            verb: "мець",
        },
        set: {
            unit: {
                one: "элемент",
                few: "элементы",
                many: "элементаў",
            },
            verb: "мець",
        },
        file: {
            unit: {
                one: "байт",
                few: "байты",
                many: "байтаў",
            },
            verb: "мець",
        },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "увод",
        email: "email адрас",
        url: "URL",
        emoji: "эмодзі",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO дата і час",
        date: "ISO дата",
        time: "ISO час",
        duration: "ISO працягласць",
        ipv4: "IPv4 адрас",
        ipv6: "IPv6 адрас",
        cidrv4: "IPv4 дыяпазон",
        cidrv6: "IPv6 дыяпазон",
        base64: "радок у фармаце base64",
        base64url: "радок у фармаце base64url",
        json_string: "JSON радок",
        e164: "нумар E.164",
        jwt: "JWT",
        template_literal: "увод",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "лік",
        array: "масіў",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Няправільны ўвод: чакаўся instanceof ${issue.expected}, атрымана ${received}`;
                }
                return `Няправільны ўвод: чакаўся ${expected}, атрымана ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Няправільны ўвод: чакалася ${util.stringifyPrimitive(issue.values[0])}`;
                return `Няправільны варыянт: чакаўся адзін з ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    const maxValue = Number(issue.maximum);
                    const unit = getBelarusianPlural(maxValue, sizing.unit.one, sizing.unit.few, sizing.unit.many);
                    return `Занадта вялікі: чакалася, што ${issue.origin ?? "значэнне"} павінна ${sizing.verb} ${adj}${issue.maximum.toString()} ${unit}`;
                }
                return `Занадта вялікі: чакалася, што ${issue.origin ?? "значэнне"} павінна быць ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    const minValue = Number(issue.minimum);
                    const unit = getBelarusianPlural(minValue, sizing.unit.one, sizing.unit.few, sizing.unit.many);
                    return `Занадта малы: чакалася, што ${issue.origin} павінна ${sizing.verb} ${adj}${issue.minimum.toString()} ${unit}`;
                }
                return `Занадта малы: чакалася, што ${issue.origin} павінна быць ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with")
                    return `Няправільны радок: павінен пачынацца з "${_issue.prefix}"`;
                if (_issue.format === "ends_with")
                    return `Няправільны радок: павінен заканчвацца на "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `Няправільны радок: павінен змяшчаць "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `Няправільны радок: павінен адпавядаць шаблону ${_issue.pattern}`;
                return `Няправільны ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Няправільны лік: павінен быць кратным ${issue.divisor}`;
            case "unrecognized_keys":
                return `Нераспазнаны ${issue.keys.length > 1 ? "ключы" : "ключ"}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Няправільны ключ у ${issue.origin}`;
            case "invalid_union":
                return "Няправільны ўвод";
            case "invalid_element":
                return `Няправільнае значэнне ў ${issue.origin}`;
            default:
                return `Няправільны ўвод`;
        }
    };
};
/* harmony default export */ function be() {
    return {
        localeError: be_error(),
    };
}

;// ./node_modules/zod/v4/locales/bg.js

const bg_error = () => {
    const Sizable = {
        string: { unit: "символа", verb: "да съдържа" },
        file: { unit: "байта", verb: "да съдържа" },
        array: { unit: "елемента", verb: "да съдържа" },
        set: { unit: "елемента", verb: "да съдържа" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "вход",
        email: "имейл адрес",
        url: "URL",
        emoji: "емоджи",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO време",
        date: "ISO дата",
        time: "ISO време",
        duration: "ISO продължителност",
        ipv4: "IPv4 адрес",
        ipv6: "IPv6 адрес",
        cidrv4: "IPv4 диапазон",
        cidrv6: "IPv6 диапазон",
        base64: "base64-кодиран низ",
        base64url: "base64url-кодиран низ",
        json_string: "JSON низ",
        e164: "E.164 номер",
        jwt: "JWT",
        template_literal: "вход",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "число",
        array: "масив",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Невалиден вход: очакван instanceof ${issue.expected}, получен ${received}`;
                }
                return `Невалиден вход: очакван ${expected}, получен ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Невалиден вход: очакван ${util.stringifyPrimitive(issue.values[0])}`;
                return `Невалидна опция: очаквано едно от ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `Твърде голямо: очаква се ${issue.origin ?? "стойност"} да съдържа ${adj}${issue.maximum.toString()} ${sizing.unit ?? "елемента"}`;
                return `Твърде голямо: очаква се ${issue.origin ?? "стойност"} да бъде ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `Твърде малко: очаква се ${issue.origin} да съдържа ${adj}${issue.minimum.toString()} ${sizing.unit}`;
                }
                return `Твърде малко: очаква се ${issue.origin} да бъде ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with") {
                    return `Невалиден низ: трябва да започва с "${_issue.prefix}"`;
                }
                if (_issue.format === "ends_with")
                    return `Невалиден низ: трябва да завършва с "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `Невалиден низ: трябва да включва "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `Невалиден низ: трябва да съвпада с ${_issue.pattern}`;
                let invalid_adj = "Невалиден";
                if (_issue.format === "emoji")
                    invalid_adj = "Невалидно";
                if (_issue.format === "datetime")
                    invalid_adj = "Невалидно";
                if (_issue.format === "date")
                    invalid_adj = "Невалидна";
                if (_issue.format === "time")
                    invalid_adj = "Невалидно";
                if (_issue.format === "duration")
                    invalid_adj = "Невалидна";
                return `${invalid_adj} ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Невалидно число: трябва да бъде кратно на ${issue.divisor}`;
            case "unrecognized_keys":
                return `Неразпознат${issue.keys.length > 1 ? "и" : ""} ключ${issue.keys.length > 1 ? "ове" : ""}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Невалиден ключ в ${issue.origin}`;
            case "invalid_union":
                return "Невалиден вход";
            case "invalid_element":
                return `Невалидна стойност в ${issue.origin}`;
            default:
                return `Невалиден вход`;
        }
    };
};
/* harmony default export */ function bg() {
    return {
        localeError: bg_error(),
    };
}

;// ./node_modules/zod/v4/locales/ca.js

const ca_error = () => {
    const Sizable = {
        string: { unit: "caràcters", verb: "contenir" },
        file: { unit: "bytes", verb: "contenir" },
        array: { unit: "elements", verb: "contenir" },
        set: { unit: "elements", verb: "contenir" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "entrada",
        email: "adreça electrònica",
        url: "URL",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "data i hora ISO",
        date: "data ISO",
        time: "hora ISO",
        duration: "durada ISO",
        ipv4: "adreça IPv4",
        ipv6: "adreça IPv6",
        cidrv4: "rang IPv4",
        cidrv6: "rang IPv6",
        base64: "cadena codificada en base64",
        base64url: "cadena codificada en base64url",
        json_string: "cadena JSON",
        e164: "número E.164",
        jwt: "JWT",
        template_literal: "entrada",
    };
    const TypeDictionary = {
        nan: "NaN",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Tipus invàlid: s'esperava instanceof ${issue.expected}, s'ha rebut ${received}`;
                }
                return `Tipus invàlid: s'esperava ${expected}, s'ha rebut ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Valor invàlid: s'esperava ${util.stringifyPrimitive(issue.values[0])}`;
                return `Opció invàlida: s'esperava una de ${util.joinValues(issue.values, " o ")}`;
            case "too_big": {
                const adj = issue.inclusive ? "com a màxim" : "menys de";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `Massa gran: s'esperava que ${issue.origin ?? "el valor"} contingués ${adj} ${issue.maximum.toString()} ${sizing.unit ?? "elements"}`;
                return `Massa gran: s'esperava que ${issue.origin ?? "el valor"} fos ${adj} ${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? "com a mínim" : "més de";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `Massa petit: s'esperava que ${issue.origin} contingués ${adj} ${issue.minimum.toString()} ${sizing.unit}`;
                }
                return `Massa petit: s'esperava que ${issue.origin} fos ${adj} ${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with") {
                    return `Format invàlid: ha de començar amb "${_issue.prefix}"`;
                }
                if (_issue.format === "ends_with")
                    return `Format invàlid: ha d'acabar amb "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `Format invàlid: ha d'incloure "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `Format invàlid: ha de coincidir amb el patró ${_issue.pattern}`;
                return `Format invàlid per a ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Número invàlid: ha de ser múltiple de ${issue.divisor}`;
            case "unrecognized_keys":
                return `Clau${issue.keys.length > 1 ? "s" : ""} no reconeguda${issue.keys.length > 1 ? "s" : ""}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Clau invàlida a ${issue.origin}`;
            case "invalid_union":
                return "Entrada invàlida"; // Could also be "Tipus d'unió invàlid" but "Entrada invàlida" is more general
            case "invalid_element":
                return `Element invàlid a ${issue.origin}`;
            default:
                return `Entrada invàlida`;
        }
    };
};
/* harmony default export */ function ca() {
    return {
        localeError: ca_error(),
    };
}

;// ./node_modules/zod/v4/locales/cs.js

const cs_error = () => {
    const Sizable = {
        string: { unit: "znaků", verb: "mít" },
        file: { unit: "bajtů", verb: "mít" },
        array: { unit: "prvků", verb: "mít" },
        set: { unit: "prvků", verb: "mít" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "regulární výraz",
        email: "e-mailová adresa",
        url: "URL",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "datum a čas ve formátu ISO",
        date: "datum ve formátu ISO",
        time: "čas ve formátu ISO",
        duration: "doba trvání ISO",
        ipv4: "IPv4 adresa",
        ipv6: "IPv6 adresa",
        cidrv4: "rozsah IPv4",
        cidrv6: "rozsah IPv6",
        base64: "řetězec zakódovaný ve formátu base64",
        base64url: "řetězec zakódovaný ve formátu base64url",
        json_string: "řetězec ve formátu JSON",
        e164: "číslo E.164",
        jwt: "JWT",
        template_literal: "vstup",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "číslo",
        string: "řetězec",
        function: "funkce",
        array: "pole",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Neplatný vstup: očekáváno instanceof ${issue.expected}, obdrženo ${received}`;
                }
                return `Neplatný vstup: očekáváno ${expected}, obdrženo ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Neplatný vstup: očekáváno ${util.stringifyPrimitive(issue.values[0])}`;
                return `Neplatná možnost: očekávána jedna z hodnot ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `Hodnota je příliš velká: ${issue.origin ?? "hodnota"} musí mít ${adj}${issue.maximum.toString()} ${sizing.unit ?? "prvků"}`;
                }
                return `Hodnota je příliš velká: ${issue.origin ?? "hodnota"} musí být ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `Hodnota je příliš malá: ${issue.origin ?? "hodnota"} musí mít ${adj}${issue.minimum.toString()} ${sizing.unit ?? "prvků"}`;
                }
                return `Hodnota je příliš malá: ${issue.origin ?? "hodnota"} musí být ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with")
                    return `Neplatný řetězec: musí začínat na "${_issue.prefix}"`;
                if (_issue.format === "ends_with")
                    return `Neplatný řetězec: musí končit na "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `Neplatný řetězec: musí obsahovat "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `Neplatný řetězec: musí odpovídat vzoru ${_issue.pattern}`;
                return `Neplatný formát ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Neplatné číslo: musí být násobkem ${issue.divisor}`;
            case "unrecognized_keys":
                return `Neznámé klíče: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Neplatný klíč v ${issue.origin}`;
            case "invalid_union":
                return "Neplatný vstup";
            case "invalid_element":
                return `Neplatná hodnota v ${issue.origin}`;
            default:
                return `Neplatný vstup`;
        }
    };
};
/* harmony default export */ function cs() {
    return {
        localeError: cs_error(),
    };
}

;// ./node_modules/zod/v4/locales/da.js

const da_error = () => {
    const Sizable = {
        string: { unit: "tegn", verb: "havde" },
        file: { unit: "bytes", verb: "havde" },
        array: { unit: "elementer", verb: "indeholdt" },
        set: { unit: "elementer", verb: "indeholdt" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "input",
        email: "e-mailadresse",
        url: "URL",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO dato- og klokkeslæt",
        date: "ISO-dato",
        time: "ISO-klokkeslæt",
        duration: "ISO-varighed",
        ipv4: "IPv4-område",
        ipv6: "IPv6-område",
        cidrv4: "IPv4-spektrum",
        cidrv6: "IPv6-spektrum",
        base64: "base64-kodet streng",
        base64url: "base64url-kodet streng",
        json_string: "JSON-streng",
        e164: "E.164-nummer",
        jwt: "JWT",
        template_literal: "input",
    };
    const TypeDictionary = {
        nan: "NaN",
        string: "streng",
        number: "tal",
        boolean: "boolean",
        array: "liste",
        object: "objekt",
        set: "sæt",
        file: "fil",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Ugyldigt input: forventede instanceof ${issue.expected}, fik ${received}`;
                }
                return `Ugyldigt input: forventede ${expected}, fik ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Ugyldig værdi: forventede ${util.stringifyPrimitive(issue.values[0])}`;
                return `Ugyldigt valg: forventede en af følgende ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                const origin = TypeDictionary[issue.origin] ?? issue.origin;
                if (sizing)
                    return `For stor: forventede ${origin ?? "value"} ${sizing.verb} ${adj} ${issue.maximum.toString()} ${sizing.unit ?? "elementer"}`;
                return `For stor: forventede ${origin ?? "value"} havde ${adj} ${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                const origin = TypeDictionary[issue.origin] ?? issue.origin;
                if (sizing) {
                    return `For lille: forventede ${origin} ${sizing.verb} ${adj} ${issue.minimum.toString()} ${sizing.unit}`;
                }
                return `For lille: forventede ${origin} havde ${adj} ${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with")
                    return `Ugyldig streng: skal starte med "${_issue.prefix}"`;
                if (_issue.format === "ends_with")
                    return `Ugyldig streng: skal ende med "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `Ugyldig streng: skal indeholde "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `Ugyldig streng: skal matche mønsteret ${_issue.pattern}`;
                return `Ugyldig ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Ugyldigt tal: skal være deleligt med ${issue.divisor}`;
            case "unrecognized_keys":
                return `${issue.keys.length > 1 ? "Ukendte nøgler" : "Ukendt nøgle"}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Ugyldig nøgle i ${issue.origin}`;
            case "invalid_union":
                return "Ugyldigt input: matcher ingen af de tilladte typer";
            case "invalid_element":
                return `Ugyldig værdi i ${issue.origin}`;
            default:
                return `Ugyldigt input`;
        }
    };
};
/* harmony default export */ function da() {
    return {
        localeError: da_error(),
    };
}

;// ./node_modules/zod/v4/locales/de.js

const de_error = () => {
    const Sizable = {
        string: { unit: "Zeichen", verb: "zu haben" },
        file: { unit: "Bytes", verb: "zu haben" },
        array: { unit: "Elemente", verb: "zu haben" },
        set: { unit: "Elemente", verb: "zu haben" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "Eingabe",
        email: "E-Mail-Adresse",
        url: "URL",
        emoji: "Emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO-Datum und -Uhrzeit",
        date: "ISO-Datum",
        time: "ISO-Uhrzeit",
        duration: "ISO-Dauer",
        ipv4: "IPv4-Adresse",
        ipv6: "IPv6-Adresse",
        cidrv4: "IPv4-Bereich",
        cidrv6: "IPv6-Bereich",
        base64: "Base64-codierter String",
        base64url: "Base64-URL-codierter String",
        json_string: "JSON-String",
        e164: "E.164-Nummer",
        jwt: "JWT",
        template_literal: "Eingabe",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "Zahl",
        array: "Array",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Ungültige Eingabe: erwartet instanceof ${issue.expected}, erhalten ${received}`;
                }
                return `Ungültige Eingabe: erwartet ${expected}, erhalten ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Ungültige Eingabe: erwartet ${util.stringifyPrimitive(issue.values[0])}`;
                return `Ungültige Option: erwartet eine von ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `Zu groß: erwartet, dass ${issue.origin ?? "Wert"} ${adj}${issue.maximum.toString()} ${sizing.unit ?? "Elemente"} hat`;
                return `Zu groß: erwartet, dass ${issue.origin ?? "Wert"} ${adj}${issue.maximum.toString()} ist`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `Zu klein: erwartet, dass ${issue.origin} ${adj}${issue.minimum.toString()} ${sizing.unit} hat`;
                }
                return `Zu klein: erwartet, dass ${issue.origin} ${adj}${issue.minimum.toString()} ist`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with")
                    return `Ungültiger String: muss mit "${_issue.prefix}" beginnen`;
                if (_issue.format === "ends_with")
                    return `Ungültiger String: muss mit "${_issue.suffix}" enden`;
                if (_issue.format === "includes")
                    return `Ungültiger String: muss "${_issue.includes}" enthalten`;
                if (_issue.format === "regex")
                    return `Ungültiger String: muss dem Muster ${_issue.pattern} entsprechen`;
                return `Ungültig: ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Ungültige Zahl: muss ein Vielfaches von ${issue.divisor} sein`;
            case "unrecognized_keys":
                return `${issue.keys.length > 1 ? "Unbekannte Schlüssel" : "Unbekannter Schlüssel"}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Ungültiger Schlüssel in ${issue.origin}`;
            case "invalid_union":
                return "Ungültige Eingabe";
            case "invalid_element":
                return `Ungültiger Wert in ${issue.origin}`;
            default:
                return `Ungültige Eingabe`;
        }
    };
};
/* harmony default export */ function de() {
    return {
        localeError: de_error(),
    };
}

;// ./node_modules/zod/v4/locales/el.js

const el_error = () => {
    const Sizable = {
        string: { unit: "χαρακτήρες", verb: "να έχει" },
        file: { unit: "bytes", verb: "να έχει" },
        array: { unit: "στοιχεία", verb: "να έχει" },
        set: { unit: "στοιχεία", verb: "να έχει" },
        map: { unit: "καταχωρήσεις", verb: "να έχει" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "είσοδος",
        email: "διεύθυνση email",
        url: "URL",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO ημερομηνία και ώρα",
        date: "ISO ημερομηνία",
        time: "ISO ώρα",
        duration: "ISO διάρκεια",
        ipv4: "διεύθυνση IPv4",
        ipv6: "διεύθυνση IPv6",
        mac: "διεύθυνση MAC",
        cidrv4: "εύρος IPv4",
        cidrv6: "εύρος IPv6",
        base64: "συμβολοσειρά κωδικοποιημένη σε base64",
        base64url: "συμβολοσειρά κωδικοποιημένη σε base64url",
        json_string: "συμβολοσειρά JSON",
        e164: "αριθμός E.164",
        jwt: "JWT",
        template_literal: "είσοδος",
    };
    const TypeDictionary = {
        nan: "NaN",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (typeof issue.expected === "string" && /^[A-Z]/.test(issue.expected)) {
                    return `Μη έγκυρη είσοδος: αναμενόταν instanceof ${issue.expected}, λήφθηκε ${received}`;
                }
                return `Μη έγκυρη είσοδος: αναμενόταν ${expected}, λήφθηκε ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Μη έγκυρη είσοδος: αναμενόταν ${util.stringifyPrimitive(issue.values[0])}`;
                return `Μη έγκυρη επιλογή: αναμενόταν ένα από ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `Πολύ μεγάλο: αναμενόταν ${issue.origin ?? "τιμή"} να έχει ${adj}${issue.maximum.toString()} ${sizing.unit ?? "στοιχεία"}`;
                return `Πολύ μεγάλο: αναμενόταν ${issue.origin ?? "τιμή"} να είναι ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `Πολύ μικρό: αναμενόταν ${issue.origin} να έχει ${adj}${issue.minimum.toString()} ${sizing.unit}`;
                }
                return `Πολύ μικρό: αναμενόταν ${issue.origin} να είναι ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with") {
                    return `Μη έγκυρη συμβολοσειρά: πρέπει να ξεκινά με "${_issue.prefix}"`;
                }
                if (_issue.format === "ends_with")
                    return `Μη έγκυρη συμβολοσειρά: πρέπει να τελειώνει με "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `Μη έγκυρη συμβολοσειρά: πρέπει να περιέχει "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `Μη έγκυρη συμβολοσειρά: πρέπει να ταιριάζει με το μοτίβο ${_issue.pattern}`;
                return `Μη έγκυρο: ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Μη έγκυρος αριθμός: πρέπει να είναι πολλαπλάσιο του ${issue.divisor}`;
            case "unrecognized_keys":
                return `Άγνωστ${issue.keys.length > 1 ? "α" : "ο"} κλειδ${issue.keys.length > 1 ? "ιά" : "ί"}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Μη έγκυρο κλειδί στο ${issue.origin}`;
            case "invalid_union":
                return "Μη έγκυρη είσοδος";
            case "invalid_element":
                return `Μη έγκυρη τιμή στο ${issue.origin}`;
            default:
                return `Μη έγκυρη είσοδος`;
        }
    };
};
/* harmony default export */ function el() {
    return {
        localeError: el_error(),
    };
}

;// ./node_modules/zod/v4/locales/en.js

const en_error = () => {
    const Sizable = {
        string: { unit: "characters", verb: "to have" },
        file: { unit: "bytes", verb: "to have" },
        array: { unit: "items", verb: "to have" },
        set: { unit: "items", verb: "to have" },
        map: { unit: "entries", verb: "to have" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "input",
        email: "email address",
        url: "URL",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO datetime",
        date: "ISO date",
        time: "ISO time",
        duration: "ISO duration",
        ipv4: "IPv4 address",
        ipv6: "IPv6 address",
        mac: "MAC address",
        cidrv4: "IPv4 range",
        cidrv6: "IPv6 range",
        base64: "base64-encoded string",
        base64url: "base64url-encoded string",
        json_string: "JSON string",
        e164: "E.164 number",
        jwt: "JWT",
        template_literal: "input",
    };
    // type names: missing keys = do not translate (use raw value via ?? fallback)
    const TypeDictionary = {
        // Compatibility: "nan" -> "NaN" for display
        nan: "NaN",
        // All other type names omitted - they fall back to raw values via ?? operator
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                return `Invalid input: expected ${expected}, received ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Invalid input: expected ${util.stringifyPrimitive(issue.values[0])}`;
                return `Invalid option: expected one of ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `Too big: expected ${issue.origin ?? "value"} to have ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elements"}`;
                return `Too big: expected ${issue.origin ?? "value"} to be ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `Too small: expected ${issue.origin} to have ${adj}${issue.minimum.toString()} ${sizing.unit}`;
                }
                return `Too small: expected ${issue.origin} to be ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with") {
                    return `Invalid string: must start with "${_issue.prefix}"`;
                }
                if (_issue.format === "ends_with")
                    return `Invalid string: must end with "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `Invalid string: must include "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `Invalid string: must match pattern ${_issue.pattern}`;
                return `Invalid ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Invalid number: must be a multiple of ${issue.divisor}`;
            case "unrecognized_keys":
                return `Unrecognized key${issue.keys.length > 1 ? "s" : ""}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Invalid key in ${issue.origin}`;
            case "invalid_union":
                if (issue.options && Array.isArray(issue.options) && issue.options.length > 0) {
                    const opts = issue.options.map((o) => `'${o}'`).join(" | ");
                    return `Invalid discriminator value. Expected ${opts}`;
                }
                return "Invalid input";
            case "invalid_element":
                return `Invalid value in ${issue.origin}`;
            default:
                return `Invalid input`;
        }
    };
};
/* harmony default export */ function en() {
    return {
        localeError: en_error(),
    };
}

;// ./node_modules/zod/v4/locales/eo.js

const eo_error = () => {
    const Sizable = {
        string: { unit: "karaktrojn", verb: "havi" },
        file: { unit: "bajtojn", verb: "havi" },
        array: { unit: "elementojn", verb: "havi" },
        set: { unit: "elementojn", verb: "havi" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "enigo",
        email: "retadreso",
        url: "URL",
        emoji: "emoĝio",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO-datotempo",
        date: "ISO-dato",
        time: "ISO-tempo",
        duration: "ISO-daŭro",
        ipv4: "IPv4-adreso",
        ipv6: "IPv6-adreso",
        cidrv4: "IPv4-rango",
        cidrv6: "IPv6-rango",
        base64: "64-ume kodita karaktraro",
        base64url: "URL-64-ume kodita karaktraro",
        json_string: "JSON-karaktraro",
        e164: "E.164-nombro",
        jwt: "JWT",
        template_literal: "enigo",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "nombro",
        array: "tabelo",
        null: "senvalora",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Nevalida enigo: atendiĝis instanceof ${issue.expected}, riceviĝis ${received}`;
                }
                return `Nevalida enigo: atendiĝis ${expected}, riceviĝis ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Nevalida enigo: atendiĝis ${util.stringifyPrimitive(issue.values[0])}`;
                return `Nevalida opcio: atendiĝis unu el ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `Tro granda: atendiĝis ke ${issue.origin ?? "valoro"} havu ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elementojn"}`;
                return `Tro granda: atendiĝis ke ${issue.origin ?? "valoro"} havu ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `Tro malgranda: atendiĝis ke ${issue.origin} havu ${adj}${issue.minimum.toString()} ${sizing.unit}`;
                }
                return `Tro malgranda: atendiĝis ke ${issue.origin} estu ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with")
                    return `Nevalida karaktraro: devas komenciĝi per "${_issue.prefix}"`;
                if (_issue.format === "ends_with")
                    return `Nevalida karaktraro: devas finiĝi per "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `Nevalida karaktraro: devas inkluzivi "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `Nevalida karaktraro: devas kongrui kun la modelo ${_issue.pattern}`;
                return `Nevalida ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Nevalida nombro: devas esti oblo de ${issue.divisor}`;
            case "unrecognized_keys":
                return `Nekonata${issue.keys.length > 1 ? "j" : ""} ŝlosilo${issue.keys.length > 1 ? "j" : ""}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Nevalida ŝlosilo en ${issue.origin}`;
            case "invalid_union":
                return "Nevalida enigo";
            case "invalid_element":
                return `Nevalida valoro en ${issue.origin}`;
            default:
                return `Nevalida enigo`;
        }
    };
};
/* harmony default export */ function eo() {
    return {
        localeError: eo_error(),
    };
}

;// ./node_modules/zod/v4/locales/es.js

const es_error = () => {
    const Sizable = {
        string: { unit: "caracteres", verb: "tener" },
        file: { unit: "bytes", verb: "tener" },
        array: { unit: "elementos", verb: "tener" },
        set: { unit: "elementos", verb: "tener" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "entrada",
        email: "dirección de correo electrónico",
        url: "URL",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "fecha y hora ISO",
        date: "fecha ISO",
        time: "hora ISO",
        duration: "duración ISO",
        ipv4: "dirección IPv4",
        ipv6: "dirección IPv6",
        cidrv4: "rango IPv4",
        cidrv6: "rango IPv6",
        base64: "cadena codificada en base64",
        base64url: "URL codificada en base64",
        json_string: "cadena JSON",
        e164: "número E.164",
        jwt: "JWT",
        template_literal: "entrada",
    };
    const TypeDictionary = {
        nan: "NaN",
        string: "texto",
        number: "número",
        boolean: "booleano",
        array: "arreglo",
        object: "objeto",
        set: "conjunto",
        file: "archivo",
        date: "fecha",
        bigint: "número grande",
        symbol: "símbolo",
        undefined: "indefinido",
        null: "nulo",
        function: "función",
        map: "mapa",
        record: "registro",
        tuple: "tupla",
        enum: "enumeración",
        union: "unión",
        literal: "literal",
        promise: "promesa",
        void: "vacío",
        never: "nunca",
        unknown: "desconocido",
        any: "cualquiera",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Entrada inválida: se esperaba instanceof ${issue.expected}, recibido ${received}`;
                }
                return `Entrada inválida: se esperaba ${expected}, recibido ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Entrada inválida: se esperaba ${util.stringifyPrimitive(issue.values[0])}`;
                return `Opción inválida: se esperaba una de ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                const origin = TypeDictionary[issue.origin] ?? issue.origin;
                if (sizing)
                    return `Demasiado grande: se esperaba que ${origin ?? "valor"} tuviera ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elementos"}`;
                return `Demasiado grande: se esperaba que ${origin ?? "valor"} fuera ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                const origin = TypeDictionary[issue.origin] ?? issue.origin;
                if (sizing) {
                    return `Demasiado pequeño: se esperaba que ${origin} tuviera ${adj}${issue.minimum.toString()} ${sizing.unit}`;
                }
                return `Demasiado pequeño: se esperaba que ${origin} fuera ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with")
                    return `Cadena inválida: debe comenzar con "${_issue.prefix}"`;
                if (_issue.format === "ends_with")
                    return `Cadena inválida: debe terminar en "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `Cadena inválida: debe incluir "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `Cadena inválida: debe coincidir con el patrón ${_issue.pattern}`;
                return `Inválido ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Número inválido: debe ser múltiplo de ${issue.divisor}`;
            case "unrecognized_keys":
                return `Llave${issue.keys.length > 1 ? "s" : ""} desconocida${issue.keys.length > 1 ? "s" : ""}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Llave inválida en ${TypeDictionary[issue.origin] ?? issue.origin}`;
            case "invalid_union":
                return "Entrada inválida";
            case "invalid_element":
                return `Valor inválido en ${TypeDictionary[issue.origin] ?? issue.origin}`;
            default:
                return `Entrada inválida`;
        }
    };
};
/* harmony default export */ function es() {
    return {
        localeError: es_error(),
    };
}

;// ./node_modules/zod/v4/locales/fa.js

const fa_error = () => {
    const Sizable = {
        string: { unit: "کاراکتر", verb: "داشته باشد" },
        file: { unit: "بایت", verb: "داشته باشد" },
        array: { unit: "آیتم", verb: "داشته باشد" },
        set: { unit: "آیتم", verb: "داشته باشد" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "ورودی",
        email: "آدرس ایمیل",
        url: "URL",
        emoji: "ایموجی",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "تاریخ و زمان ایزو",
        date: "تاریخ ایزو",
        time: "زمان ایزو",
        duration: "مدت زمان ایزو",
        ipv4: "IPv4 آدرس",
        ipv6: "IPv6 آدرس",
        cidrv4: "IPv4 دامنه",
        cidrv6: "IPv6 دامنه",
        base64: "base64-encoded رشته",
        base64url: "base64url-encoded رشته",
        json_string: "JSON رشته",
        e164: "E.164 عدد",
        jwt: "JWT",
        template_literal: "ورودی",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "عدد",
        array: "آرایه",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `ورودی نامعتبر: می‌بایست instanceof ${issue.expected} می‌بود، ${received} دریافت شد`;
                }
                return `ورودی نامعتبر: می‌بایست ${expected} می‌بود، ${received} دریافت شد`;
            }
            case "invalid_value":
                if (issue.values.length === 1) {
                    return `ورودی نامعتبر: می‌بایست ${util.stringifyPrimitive(issue.values[0])} می‌بود`;
                }
                return `گزینه نامعتبر: می‌بایست یکی از ${util.joinValues(issue.values, "|")} می‌بود`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `خیلی بزرگ: ${issue.origin ?? "مقدار"} باید ${adj}${issue.maximum.toString()} ${sizing.unit ?? "عنصر"} باشد`;
                }
                return `خیلی بزرگ: ${issue.origin ?? "مقدار"} باید ${adj}${issue.maximum.toString()} باشد`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `خیلی کوچک: ${issue.origin} باید ${adj}${issue.minimum.toString()} ${sizing.unit} باشد`;
                }
                return `خیلی کوچک: ${issue.origin} باید ${adj}${issue.minimum.toString()} باشد`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with") {
                    return `رشته نامعتبر: باید با "${_issue.prefix}" شروع شود`;
                }
                if (_issue.format === "ends_with") {
                    return `رشته نامعتبر: باید با "${_issue.suffix}" تمام شود`;
                }
                if (_issue.format === "includes") {
                    return `رشته نامعتبر: باید شامل "${_issue.includes}" باشد`;
                }
                if (_issue.format === "regex") {
                    return `رشته نامعتبر: باید با الگوی ${_issue.pattern} مطابقت داشته باشد`;
                }
                return `${FormatDictionary[_issue.format] ?? issue.format} نامعتبر`;
            }
            case "not_multiple_of":
                return `عدد نامعتبر: باید مضرب ${issue.divisor} باشد`;
            case "unrecognized_keys":
                return `کلید${issue.keys.length > 1 ? "های" : ""} ناشناس: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `کلید ناشناس در ${issue.origin}`;
            case "invalid_union":
                return `ورودی نامعتبر`;
            case "invalid_element":
                return `مقدار نامعتبر در ${issue.origin}`;
            default:
                return `ورودی نامعتبر`;
        }
    };
};
/* harmony default export */ function fa() {
    return {
        localeError: fa_error(),
    };
}

;// ./node_modules/zod/v4/locales/fi.js

const fi_error = () => {
    const Sizable = {
        string: { unit: "merkkiä", subject: "merkkijonon" },
        file: { unit: "tavua", subject: "tiedoston" },
        array: { unit: "alkiota", subject: "listan" },
        set: { unit: "alkiota", subject: "joukon" },
        number: { unit: "", subject: "luvun" },
        bigint: { unit: "", subject: "suuren kokonaisluvun" },
        int: { unit: "", subject: "kokonaisluvun" },
        date: { unit: "", subject: "päivämäärän" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "säännöllinen lauseke",
        email: "sähköpostiosoite",
        url: "URL-osoite",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO-aikaleima",
        date: "ISO-päivämäärä",
        time: "ISO-aika",
        duration: "ISO-kesto",
        ipv4: "IPv4-osoite",
        ipv6: "IPv6-osoite",
        cidrv4: "IPv4-alue",
        cidrv6: "IPv6-alue",
        base64: "base64-koodattu merkkijono",
        base64url: "base64url-koodattu merkkijono",
        json_string: "JSON-merkkijono",
        e164: "E.164-luku",
        jwt: "JWT",
        template_literal: "templaattimerkkijono",
    };
    const TypeDictionary = {
        nan: "NaN",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Virheellinen tyyppi: odotettiin instanceof ${issue.expected}, oli ${received}`;
                }
                return `Virheellinen tyyppi: odotettiin ${expected}, oli ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Virheellinen syöte: täytyy olla ${util.stringifyPrimitive(issue.values[0])}`;
                return `Virheellinen valinta: täytyy olla yksi seuraavista: ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `Liian suuri: ${sizing.subject} täytyy olla ${adj}${issue.maximum.toString()} ${sizing.unit}`.trim();
                }
                return `Liian suuri: arvon täytyy olla ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `Liian pieni: ${sizing.subject} täytyy olla ${adj}${issue.minimum.toString()} ${sizing.unit}`.trim();
                }
                return `Liian pieni: arvon täytyy olla ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with")
                    return `Virheellinen syöte: täytyy alkaa "${_issue.prefix}"`;
                if (_issue.format === "ends_with")
                    return `Virheellinen syöte: täytyy loppua "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `Virheellinen syöte: täytyy sisältää "${_issue.includes}"`;
                if (_issue.format === "regex") {
                    return `Virheellinen syöte: täytyy vastata säännöllistä lauseketta ${_issue.pattern}`;
                }
                return `Virheellinen ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Virheellinen luku: täytyy olla luvun ${issue.divisor} monikerta`;
            case "unrecognized_keys":
                return `${issue.keys.length > 1 ? "Tuntemattomat avaimet" : "Tuntematon avain"}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return "Virheellinen avain tietueessa";
            case "invalid_union":
                return "Virheellinen unioni";
            case "invalid_element":
                return "Virheellinen arvo joukossa";
            default:
                return `Virheellinen syöte`;
        }
    };
};
/* harmony default export */ function fi() {
    return {
        localeError: fi_error(),
    };
}

;// ./node_modules/zod/v4/locales/fr.js

const fr_error = () => {
    const Sizable = {
        string: { unit: "caractères", verb: "avoir" },
        file: { unit: "octets", verb: "avoir" },
        array: { unit: "éléments", verb: "avoir" },
        set: { unit: "éléments", verb: "avoir" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "entrée",
        email: "adresse e-mail",
        url: "URL",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "date et heure ISO",
        date: "date ISO",
        time: "heure ISO",
        duration: "durée ISO",
        ipv4: "adresse IPv4",
        ipv6: "adresse IPv6",
        cidrv4: "plage IPv4",
        cidrv6: "plage IPv6",
        base64: "chaîne encodée en base64",
        base64url: "chaîne encodée en base64url",
        json_string: "chaîne JSON",
        e164: "numéro E.164",
        jwt: "JWT",
        template_literal: "entrée",
    };
    const TypeDictionary = {
        string: "chaîne",
        number: "nombre",
        int: "entier",
        boolean: "booléen",
        bigint: "grand entier",
        symbol: "symbole",
        undefined: "indéfini",
        null: "null",
        never: "jamais",
        void: "vide",
        date: "date",
        array: "tableau",
        object: "objet",
        tuple: "tuple",
        record: "enregistrement",
        map: "carte",
        set: "ensemble",
        file: "fichier",
        nonoptional: "non-optionnel",
        nan: "NaN",
        function: "fonction",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Entrée invalide : instanceof ${issue.expected} attendu, ${received} reçu`;
                }
                return `Entrée invalide : ${expected} attendu, ${received} reçu`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Entrée invalide : ${util.stringifyPrimitive(issue.values[0])} attendu`;
                return `Option invalide : une valeur parmi ${util.joinValues(issue.values, "|")} attendue`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `Trop grand : ${TypeDictionary[issue.origin] ?? "valeur"} doit ${sizing.verb} ${adj}${issue.maximum.toString()} ${sizing.unit ?? "élément(s)"}`;
                return `Trop grand : ${TypeDictionary[issue.origin] ?? "valeur"} doit être ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `Trop petit : ${TypeDictionary[issue.origin] ?? "valeur"} doit ${sizing.verb} ${adj}${issue.minimum.toString()} ${sizing.unit}`;
                return `Trop petit : ${TypeDictionary[issue.origin] ?? "valeur"} doit être ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with")
                    return `Chaîne invalide : doit commencer par "${_issue.prefix}"`;
                if (_issue.format === "ends_with")
                    return `Chaîne invalide : doit se terminer par "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `Chaîne invalide : doit inclure "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `Chaîne invalide : doit correspondre au modèle ${_issue.pattern}`;
                return `${FormatDictionary[_issue.format] ?? issue.format} invalide`;
            }
            case "not_multiple_of":
                return `Nombre invalide : doit être un multiple de ${issue.divisor}`;
            case "unrecognized_keys":
                return `Clé${issue.keys.length > 1 ? "s" : ""} non reconnue${issue.keys.length > 1 ? "s" : ""} : ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Clé invalide dans ${issue.origin}`;
            case "invalid_union":
                return "Entrée invalide";
            case "invalid_element":
                return `Valeur invalide dans ${issue.origin}`;
            default:
                return `Entrée invalide`;
        }
    };
};
/* harmony default export */ function fr() {
    return {
        localeError: fr_error(),
    };
}

;// ./node_modules/zod/v4/locales/fr-CA.js

const fr_CA_error = () => {
    const Sizable = {
        string: { unit: "caractères", verb: "avoir" },
        file: { unit: "octets", verb: "avoir" },
        array: { unit: "éléments", verb: "avoir" },
        set: { unit: "éléments", verb: "avoir" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "entrée",
        email: "adresse courriel",
        url: "URL",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "date-heure ISO",
        date: "date ISO",
        time: "heure ISO",
        duration: "durée ISO",
        ipv4: "adresse IPv4",
        ipv6: "adresse IPv6",
        cidrv4: "plage IPv4",
        cidrv6: "plage IPv6",
        base64: "chaîne encodée en base64",
        base64url: "chaîne encodée en base64url",
        json_string: "chaîne JSON",
        e164: "numéro E.164",
        jwt: "JWT",
        template_literal: "entrée",
    };
    const TypeDictionary = {
        nan: "NaN",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Entrée invalide : attendu instanceof ${issue.expected}, reçu ${received}`;
                }
                return `Entrée invalide : attendu ${expected}, reçu ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Entrée invalide : attendu ${util.stringifyPrimitive(issue.values[0])}`;
                return `Option invalide : attendu l'une des valeurs suivantes ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "≤" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `Trop grand : attendu que ${issue.origin ?? "la valeur"} ait ${adj}${issue.maximum.toString()} ${sizing.unit}`;
                return `Trop grand : attendu que ${issue.origin ?? "la valeur"} soit ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? "≥" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `Trop petit : attendu que ${issue.origin} ait ${adj}${issue.minimum.toString()} ${sizing.unit}`;
                }
                return `Trop petit : attendu que ${issue.origin} soit ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with") {
                    return `Chaîne invalide : doit commencer par "${_issue.prefix}"`;
                }
                if (_issue.format === "ends_with")
                    return `Chaîne invalide : doit se terminer par "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `Chaîne invalide : doit inclure "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `Chaîne invalide : doit correspondre au motif ${_issue.pattern}`;
                return `${FormatDictionary[_issue.format] ?? issue.format} invalide`;
            }
            case "not_multiple_of":
                return `Nombre invalide : doit être un multiple de ${issue.divisor}`;
            case "unrecognized_keys":
                return `Clé${issue.keys.length > 1 ? "s" : ""} non reconnue${issue.keys.length > 1 ? "s" : ""} : ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Clé invalide dans ${issue.origin}`;
            case "invalid_union":
                return "Entrée invalide";
            case "invalid_element":
                return `Valeur invalide dans ${issue.origin}`;
            default:
                return `Entrée invalide`;
        }
    };
};
/* harmony default export */ function fr_CA() {
    return {
        localeError: fr_CA_error(),
    };
}

;// ./node_modules/zod/v4/locales/he.js

const he_error = () => {
    // Hebrew labels + grammatical gender
    const TypeNames = {
        string: { label: "מחרוזת", gender: "f" },
        number: { label: "מספר", gender: "m" },
        boolean: { label: "ערך בוליאני", gender: "m" },
        bigint: { label: "BigInt", gender: "m" },
        date: { label: "תאריך", gender: "m" },
        array: { label: "מערך", gender: "m" },
        object: { label: "אובייקט", gender: "m" },
        null: { label: "ערך ריק (null)", gender: "m" },
        undefined: { label: "ערך לא מוגדר (undefined)", gender: "m" },
        symbol: { label: "סימבול (Symbol)", gender: "m" },
        function: { label: "פונקציה", gender: "f" },
        map: { label: "מפה (Map)", gender: "f" },
        set: { label: "קבוצה (Set)", gender: "f" },
        file: { label: "קובץ", gender: "m" },
        promise: { label: "Promise", gender: "m" },
        NaN: { label: "NaN", gender: "m" },
        unknown: { label: "ערך לא ידוע", gender: "m" },
        value: { label: "ערך", gender: "m" },
    };
    // Sizing units for size-related messages + localized origin labels
    const Sizable = {
        string: { unit: "תווים", shortLabel: "קצר", longLabel: "ארוך" },
        file: { unit: "בייטים", shortLabel: "קטן", longLabel: "גדול" },
        array: { unit: "פריטים", shortLabel: "קטן", longLabel: "גדול" },
        set: { unit: "פריטים", shortLabel: "קטן", longLabel: "גדול" },
        number: { unit: "", shortLabel: "קטן", longLabel: "גדול" }, // no unit
    };
    // Helpers — labels, articles, and verbs
    const typeEntry = (t) => (t ? TypeNames[t] : undefined);
    const typeLabel = (t) => {
        const e = typeEntry(t);
        if (e)
            return e.label;
        // fallback: show raw string if unknown
        return t ?? TypeNames.unknown.label;
    };
    const withDefinite = (t) => `ה${typeLabel(t)}`;
    const verbFor = (t) => {
        const e = typeEntry(t);
        const gender = e?.gender ?? "m";
        return gender === "f" ? "צריכה להיות" : "צריך להיות";
    };
    const getSizing = (origin) => {
        if (!origin)
            return null;
        return Sizable[origin] ?? null;
    };
    const FormatDictionary = {
        regex: { label: "קלט", gender: "m" },
        email: { label: "כתובת אימייל", gender: "f" },
        url: { label: "כתובת רשת", gender: "f" },
        emoji: { label: "אימוג'י", gender: "m" },
        uuid: { label: "UUID", gender: "m" },
        nanoid: { label: "nanoid", gender: "m" },
        guid: { label: "GUID", gender: "m" },
        cuid: { label: "cuid", gender: "m" },
        cuid2: { label: "cuid2", gender: "m" },
        ulid: { label: "ULID", gender: "m" },
        xid: { label: "XID", gender: "m" },
        ksuid: { label: "KSUID", gender: "m" },
        datetime: { label: "תאריך וזמן ISO", gender: "m" },
        date: { label: "תאריך ISO", gender: "m" },
        time: { label: "זמן ISO", gender: "m" },
        duration: { label: "משך זמן ISO", gender: "m" },
        ipv4: { label: "כתובת IPv4", gender: "f" },
        ipv6: { label: "כתובת IPv6", gender: "f" },
        cidrv4: { label: "טווח IPv4", gender: "m" },
        cidrv6: { label: "טווח IPv6", gender: "m" },
        base64: { label: "מחרוזת בבסיס 64", gender: "f" },
        base64url: { label: "מחרוזת בבסיס 64 לכתובות רשת", gender: "f" },
        json_string: { label: "מחרוזת JSON", gender: "f" },
        e164: { label: "מספר E.164", gender: "m" },
        jwt: { label: "JWT", gender: "m" },
        ends_with: { label: "קלט", gender: "m" },
        includes: { label: "קלט", gender: "m" },
        lowercase: { label: "קלט", gender: "m" },
        starts_with: { label: "קלט", gender: "m" },
        uppercase: { label: "קלט", gender: "m" },
    };
    const TypeDictionary = {
        nan: "NaN",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                // Expected type: show without definite article for clearer Hebrew
                const expectedKey = issue.expected;
                const expected = TypeDictionary[expectedKey ?? ""] ?? typeLabel(expectedKey);
                // Received: show localized label if known, otherwise constructor/raw
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? TypeNames[receivedType]?.label ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `קלט לא תקין: צריך להיות instanceof ${issue.expected}, התקבל ${received}`;
                }
                return `קלט לא תקין: צריך להיות ${expected}, התקבל ${received}`;
            }
            case "invalid_value": {
                if (issue.values.length === 1) {
                    return `ערך לא תקין: הערך חייב להיות ${util.stringifyPrimitive(issue.values[0])}`;
                }
                // Join values with proper Hebrew formatting
                const stringified = issue.values.map((v) => util.stringifyPrimitive(v));
                if (issue.values.length === 2) {
                    return `ערך לא תקין: האפשרויות המתאימות הן ${stringified[0]} או ${stringified[1]}`;
                }
                // For 3+ values: "a", "b" או "c"
                const lastValue = stringified[stringified.length - 1];
                const restValues = stringified.slice(0, -1).join(", ");
                return `ערך לא תקין: האפשרויות המתאימות הן ${restValues} או ${lastValue}`;
            }
            case "too_big": {
                const sizing = getSizing(issue.origin);
                const subject = withDefinite(issue.origin ?? "value");
                if (issue.origin === "string") {
                    // Special handling for strings - more natural Hebrew
                    return `${sizing?.longLabel ?? "ארוך"} מדי: ${subject} צריכה להכיל ${issue.maximum.toString()} ${sizing?.unit ?? ""} ${issue.inclusive ? "או פחות" : "לכל היותר"}`.trim();
                }
                if (issue.origin === "number") {
                    // Natural Hebrew for numbers
                    const comparison = issue.inclusive ? `קטן או שווה ל-${issue.maximum}` : `קטן מ-${issue.maximum}`;
                    return `גדול מדי: ${subject} צריך להיות ${comparison}`;
                }
                if (issue.origin === "array" || issue.origin === "set") {
                    // Natural Hebrew for arrays and sets
                    const verb = issue.origin === "set" ? "צריכה" : "צריך";
                    const comparison = issue.inclusive
                        ? `${issue.maximum} ${sizing?.unit ?? ""} או פחות`
                        : `פחות מ-${issue.maximum} ${sizing?.unit ?? ""}`;
                    return `גדול מדי: ${subject} ${verb} להכיל ${comparison}`.trim();
                }
                const adj = issue.inclusive ? "<=" : "<";
                const be = verbFor(issue.origin ?? "value");
                if (sizing?.unit) {
                    return `${sizing.longLabel} מדי: ${subject} ${be} ${adj}${issue.maximum.toString()} ${sizing.unit}`;
                }
                return `${sizing?.longLabel ?? "גדול"} מדי: ${subject} ${be} ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const sizing = getSizing(issue.origin);
                const subject = withDefinite(issue.origin ?? "value");
                if (issue.origin === "string") {
                    // Special handling for strings - more natural Hebrew
                    return `${sizing?.shortLabel ?? "קצר"} מדי: ${subject} צריכה להכיל ${issue.minimum.toString()} ${sizing?.unit ?? ""} ${issue.inclusive ? "או יותר" : "לפחות"}`.trim();
                }
                if (issue.origin === "number") {
                    // Natural Hebrew for numbers
                    const comparison = issue.inclusive ? `גדול או שווה ל-${issue.minimum}` : `גדול מ-${issue.minimum}`;
                    return `קטן מדי: ${subject} צריך להיות ${comparison}`;
                }
                if (issue.origin === "array" || issue.origin === "set") {
                    // Natural Hebrew for arrays and sets
                    const verb = issue.origin === "set" ? "צריכה" : "צריך";
                    // Special case for singular (minimum === 1)
                    if (issue.minimum === 1 && issue.inclusive) {
                        const singularPhrase = issue.origin === "set" ? "לפחות פריט אחד" : "לפחות פריט אחד";
                        return `קטן מדי: ${subject} ${verb} להכיל ${singularPhrase}`;
                    }
                    const comparison = issue.inclusive
                        ? `${issue.minimum} ${sizing?.unit ?? ""} או יותר`
                        : `יותר מ-${issue.minimum} ${sizing?.unit ?? ""}`;
                    return `קטן מדי: ${subject} ${verb} להכיל ${comparison}`.trim();
                }
                const adj = issue.inclusive ? ">=" : ">";
                const be = verbFor(issue.origin ?? "value");
                if (sizing?.unit) {
                    return `${sizing.shortLabel} מדי: ${subject} ${be} ${adj}${issue.minimum.toString()} ${sizing.unit}`;
                }
                return `${sizing?.shortLabel ?? "קטן"} מדי: ${subject} ${be} ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                // These apply to strings — use feminine grammar + ה׳ הידיעה
                if (_issue.format === "starts_with")
                    return `המחרוזת חייבת להתחיל ב "${_issue.prefix}"`;
                if (_issue.format === "ends_with")
                    return `המחרוזת חייבת להסתיים ב "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `המחרוזת חייבת לכלול "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `המחרוזת חייבת להתאים לתבנית ${_issue.pattern}`;
                // Handle gender agreement for formats
                const nounEntry = FormatDictionary[_issue.format];
                const noun = nounEntry?.label ?? _issue.format;
                const gender = nounEntry?.gender ?? "m";
                const adjective = gender === "f" ? "תקינה" : "תקין";
                return `${noun} לא ${adjective}`;
            }
            case "not_multiple_of":
                return `מספר לא תקין: חייב להיות מכפלה של ${issue.divisor}`;
            case "unrecognized_keys":
                return `מפתח${issue.keys.length > 1 ? "ות" : ""} לא מזוה${issue.keys.length > 1 ? "ים" : "ה"}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key": {
                return `שדה לא תקין באובייקט`;
            }
            case "invalid_union":
                return "קלט לא תקין";
            case "invalid_element": {
                const place = withDefinite(issue.origin ?? "array");
                return `ערך לא תקין ב${place}`;
            }
            default:
                return `קלט לא תקין`;
        }
    };
};
/* harmony default export */ function he() {
    return {
        localeError: he_error(),
    };
}

;// ./node_modules/zod/v4/locales/hr.js

const hr_error = () => {
    const Sizable = {
        string: { unit: "znakova", verb: "imati" },
        file: { unit: "bajtova", verb: "imati" },
        array: { unit: "stavki", verb: "imati" },
        set: { unit: "stavki", verb: "imati" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "unos",
        email: "email adresa",
        url: "URL",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO datum i vrijeme",
        date: "ISO datum",
        time: "ISO vrijeme",
        duration: "ISO trajanje",
        ipv4: "IPv4 adresa",
        ipv6: "IPv6 adresa",
        cidrv4: "IPv4 raspon",
        cidrv6: "IPv6 raspon",
        base64: "base64 kodirani tekst",
        base64url: "base64url kodirani tekst",
        json_string: "JSON tekst",
        e164: "E.164 broj",
        jwt: "JWT",
        template_literal: "unos",
    };
    const TypeDictionary = {
        nan: "NaN",
        string: "tekst",
        number: "broj",
        boolean: "boolean",
        array: "niz",
        object: "objekt",
        set: "skup",
        file: "datoteka",
        date: "datum",
        bigint: "bigint",
        symbol: "simbol",
        undefined: "undefined",
        null: "null",
        function: "funkcija",
        map: "mapa",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Neispravan unos: očekuje se instanceof ${issue.expected}, a primljeno je ${received}`;
                }
                return `Neispravan unos: očekuje se ${expected}, a primljeno je ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Neispravna vrijednost: očekivano ${util.stringifyPrimitive(issue.values[0])}`;
                return `Neispravna opcija: očekivano jedno od ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                const origin = TypeDictionary[issue.origin] ?? issue.origin;
                if (sizing)
                    return `Preveliko: očekivano da ${origin ?? "vrijednost"} ima ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elemenata"}`;
                return `Preveliko: očekivano da ${origin ?? "vrijednost"} bude ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                const origin = TypeDictionary[issue.origin] ?? issue.origin;
                if (sizing) {
                    return `Premalo: očekivano da ${origin} ima ${adj}${issue.minimum.toString()} ${sizing.unit}`;
                }
                return `Premalo: očekivano da ${origin} bude ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with")
                    return `Neispravan tekst: mora započinjati s "${_issue.prefix}"`;
                if (_issue.format === "ends_with")
                    return `Neispravan tekst: mora završavati s "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `Neispravan tekst: mora sadržavati "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `Neispravan tekst: mora odgovarati uzorku ${_issue.pattern}`;
                return `Neispravna ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Neispravan broj: mora biti višekratnik od ${issue.divisor}`;
            case "unrecognized_keys":
                return `Neprepoznat${issue.keys.length > 1 ? "i ključevi" : " ključ"}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Neispravan ključ u ${TypeDictionary[issue.origin] ?? issue.origin}`;
            case "invalid_union":
                return "Neispravan unos";
            case "invalid_element":
                return `Neispravna vrijednost u ${TypeDictionary[issue.origin] ?? issue.origin}`;
            default:
                return `Neispravan unos`;
        }
    };
};
/* harmony default export */ function hr() {
    return {
        localeError: hr_error(),
    };
}

;// ./node_modules/zod/v4/locales/hu.js

const hu_error = () => {
    const Sizable = {
        string: { unit: "karakter", verb: "legyen" },
        file: { unit: "byte", verb: "legyen" },
        array: { unit: "elem", verb: "legyen" },
        set: { unit: "elem", verb: "legyen" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "bemenet",
        email: "email cím",
        url: "URL",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO időbélyeg",
        date: "ISO dátum",
        time: "ISO idő",
        duration: "ISO időintervallum",
        ipv4: "IPv4 cím",
        ipv6: "IPv6 cím",
        cidrv4: "IPv4 tartomány",
        cidrv6: "IPv6 tartomány",
        base64: "base64-kódolt string",
        base64url: "base64url-kódolt string",
        json_string: "JSON string",
        e164: "E.164 szám",
        jwt: "JWT",
        template_literal: "bemenet",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "szám",
        array: "tömb",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Érvénytelen bemenet: a várt érték instanceof ${issue.expected}, a kapott érték ${received}`;
                }
                return `Érvénytelen bemenet: a várt érték ${expected}, a kapott érték ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Érvénytelen bemenet: a várt érték ${util.stringifyPrimitive(issue.values[0])}`;
                return `Érvénytelen opció: valamelyik érték várt ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `Túl nagy: ${issue.origin ?? "érték"} mérete túl nagy ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elem"}`;
                return `Túl nagy: a bemeneti érték ${issue.origin ?? "érték"} túl nagy: ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `Túl kicsi: a bemeneti érték ${issue.origin} mérete túl kicsi ${adj}${issue.minimum.toString()} ${sizing.unit}`;
                }
                return `Túl kicsi: a bemeneti érték ${issue.origin} túl kicsi ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with")
                    return `Érvénytelen string: "${_issue.prefix}" értékkel kell kezdődnie`;
                if (_issue.format === "ends_with")
                    return `Érvénytelen string: "${_issue.suffix}" értékkel kell végződnie`;
                if (_issue.format === "includes")
                    return `Érvénytelen string: "${_issue.includes}" értéket kell tartalmaznia`;
                if (_issue.format === "regex")
                    return `Érvénytelen string: ${_issue.pattern} mintának kell megfelelnie`;
                return `Érvénytelen ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Érvénytelen szám: ${issue.divisor} többszörösének kell lennie`;
            case "unrecognized_keys":
                return `Ismeretlen kulcs${issue.keys.length > 1 ? "s" : ""}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Érvénytelen kulcs ${issue.origin}`;
            case "invalid_union":
                return "Érvénytelen bemenet";
            case "invalid_element":
                return `Érvénytelen érték: ${issue.origin}`;
            default:
                return `Érvénytelen bemenet`;
        }
    };
};
/* harmony default export */ function hu() {
    return {
        localeError: hu_error(),
    };
}

;// ./node_modules/zod/v4/locales/hy.js

function getArmenianPlural(count, one, many) {
    return Math.abs(count) === 1 ? one : many;
}
function withDefiniteArticle(word) {
    if (!word)
        return "";
    const vowels = ["ա", "ե", "ը", "ի", "ո", "ու", "օ"];
    const lastChar = word[word.length - 1];
    return word + (vowels.includes(lastChar) ? "ն" : "ը");
}
const hy_error = () => {
    const Sizable = {
        string: {
            unit: {
                one: "նշան",
                many: "նշաններ",
            },
            verb: "ունենալ",
        },
        file: {
            unit: {
                one: "բայթ",
                many: "բայթեր",
            },
            verb: "ունենալ",
        },
        array: {
            unit: {
                one: "տարր",
                many: "տարրեր",
            },
            verb: "ունենալ",
        },
        set: {
            unit: {
                one: "տարր",
                many: "տարրեր",
            },
            verb: "ունենալ",
        },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "մուտք",
        email: "էլ. հասցե",
        url: "URL",
        emoji: "էմոջի",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO ամսաթիվ և ժամ",
        date: "ISO ամսաթիվ",
        time: "ISO ժամ",
        duration: "ISO տևողություն",
        ipv4: "IPv4 հասցե",
        ipv6: "IPv6 հասցե",
        cidrv4: "IPv4 միջակայք",
        cidrv6: "IPv6 միջակայք",
        base64: "base64 ձևաչափով տող",
        base64url: "base64url ձևաչափով տող",
        json_string: "JSON տող",
        e164: "E.164 համար",
        jwt: "JWT",
        template_literal: "մուտք",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "թիվ",
        array: "զանգված",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Սխալ մուտքագրում․ սպասվում էր instanceof ${issue.expected}, ստացվել է ${received}`;
                }
                return `Սխալ մուտքագրում․ սպասվում էր ${expected}, ստացվել է ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Սխալ մուտքագրում․ սպասվում էր ${util.stringifyPrimitive(issue.values[1])}`;
                return `Սխալ տարբերակ․ սպասվում էր հետևյալներից մեկը՝ ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    const maxValue = Number(issue.maximum);
                    const unit = getArmenianPlural(maxValue, sizing.unit.one, sizing.unit.many);
                    return `Չափազանց մեծ արժեք․ սպասվում է, որ ${withDefiniteArticle(issue.origin ?? "արժեք")} կունենա ${adj}${issue.maximum.toString()} ${unit}`;
                }
                return `Չափազանց մեծ արժեք․ սպասվում է, որ ${withDefiniteArticle(issue.origin ?? "արժեք")} լինի ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    const minValue = Number(issue.minimum);
                    const unit = getArmenianPlural(minValue, sizing.unit.one, sizing.unit.many);
                    return `Չափազանց փոքր արժեք․ սպասվում է, որ ${withDefiniteArticle(issue.origin)} կունենա ${adj}${issue.minimum.toString()} ${unit}`;
                }
                return `Չափազանց փոքր արժեք․ սպասվում է, որ ${withDefiniteArticle(issue.origin)} լինի ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with")
                    return `Սխալ տող․ պետք է սկսվի "${_issue.prefix}"-ով`;
                if (_issue.format === "ends_with")
                    return `Սխալ տող․ պետք է ավարտվի "${_issue.suffix}"-ով`;
                if (_issue.format === "includes")
                    return `Սխալ տող․ պետք է պարունակի "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `Սխալ տող․ պետք է համապատասխանի ${_issue.pattern} ձևաչափին`;
                return `Սխալ ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Սխալ թիվ․ պետք է բազմապատիկ լինի ${issue.divisor}-ի`;
            case "unrecognized_keys":
                return `Չճանաչված բանալի${issue.keys.length > 1 ? "ներ" : ""}. ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Սխալ բանալի ${withDefiniteArticle(issue.origin)}-ում`;
            case "invalid_union":
                return "Սխալ մուտքագրում";
            case "invalid_element":
                return `Սխալ արժեք ${withDefiniteArticle(issue.origin)}-ում`;
            default:
                return `Սխալ մուտքագրում`;
        }
    };
};
/* harmony default export */ function hy() {
    return {
        localeError: hy_error(),
    };
}

;// ./node_modules/zod/v4/locales/id.js

const id_error = () => {
    const Sizable = {
        string: { unit: "karakter", verb: "memiliki" },
        file: { unit: "byte", verb: "memiliki" },
        array: { unit: "item", verb: "memiliki" },
        set: { unit: "item", verb: "memiliki" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "input",
        email: "alamat email",
        url: "URL",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "tanggal dan waktu format ISO",
        date: "tanggal format ISO",
        time: "jam format ISO",
        duration: "durasi format ISO",
        ipv4: "alamat IPv4",
        ipv6: "alamat IPv6",
        cidrv4: "rentang alamat IPv4",
        cidrv6: "rentang alamat IPv6",
        base64: "string dengan enkode base64",
        base64url: "string dengan enkode base64url",
        json_string: "string JSON",
        e164: "angka E.164",
        jwt: "JWT",
        template_literal: "input",
    };
    const TypeDictionary = {
        nan: "NaN",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Input tidak valid: diharapkan instanceof ${issue.expected}, diterima ${received}`;
                }
                return `Input tidak valid: diharapkan ${expected}, diterima ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Input tidak valid: diharapkan ${util.stringifyPrimitive(issue.values[0])}`;
                return `Pilihan tidak valid: diharapkan salah satu dari ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `Terlalu besar: diharapkan ${issue.origin ?? "value"} memiliki ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elemen"}`;
                return `Terlalu besar: diharapkan ${issue.origin ?? "value"} menjadi ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `Terlalu kecil: diharapkan ${issue.origin} memiliki ${adj}${issue.minimum.toString()} ${sizing.unit}`;
                }
                return `Terlalu kecil: diharapkan ${issue.origin} menjadi ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with")
                    return `String tidak valid: harus dimulai dengan "${_issue.prefix}"`;
                if (_issue.format === "ends_with")
                    return `String tidak valid: harus berakhir dengan "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `String tidak valid: harus menyertakan "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `String tidak valid: harus sesuai pola ${_issue.pattern}`;
                return `${FormatDictionary[_issue.format] ?? issue.format} tidak valid`;
            }
            case "not_multiple_of":
                return `Angka tidak valid: harus kelipatan dari ${issue.divisor}`;
            case "unrecognized_keys":
                return `Kunci tidak dikenali ${issue.keys.length > 1 ? "s" : ""}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Kunci tidak valid di ${issue.origin}`;
            case "invalid_union":
                return "Input tidak valid";
            case "invalid_element":
                return `Nilai tidak valid di ${issue.origin}`;
            default:
                return `Input tidak valid`;
        }
    };
};
/* harmony default export */ function id() {
    return {
        localeError: id_error(),
    };
}

;// ./node_modules/zod/v4/locales/is.js

const is_error = () => {
    const Sizable = {
        string: { unit: "stafi", verb: "að hafa" },
        file: { unit: "bæti", verb: "að hafa" },
        array: { unit: "hluti", verb: "að hafa" },
        set: { unit: "hluti", verb: "að hafa" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "gildi",
        email: "netfang",
        url: "vefslóð",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO dagsetning og tími",
        date: "ISO dagsetning",
        time: "ISO tími",
        duration: "ISO tímalengd",
        ipv4: "IPv4 address",
        ipv6: "IPv6 address",
        cidrv4: "IPv4 range",
        cidrv6: "IPv6 range",
        base64: "base64-encoded strengur",
        base64url: "base64url-encoded strengur",
        json_string: "JSON strengur",
        e164: "E.164 tölugildi",
        jwt: "JWT",
        template_literal: "gildi",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "númer",
        array: "fylki",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Rangt gildi: Þú slóst inn ${received} þar sem á að vera instanceof ${issue.expected}`;
                }
                return `Rangt gildi: Þú slóst inn ${received} þar sem á að vera ${expected}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Rangt gildi: gert ráð fyrir ${util.stringifyPrimitive(issue.values[0])}`;
                return `Ógilt val: má vera eitt af eftirfarandi ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `Of stórt: gert er ráð fyrir að ${issue.origin ?? "gildi"} hafi ${adj}${issue.maximum.toString()} ${sizing.unit ?? "hluti"}`;
                return `Of stórt: gert er ráð fyrir að ${issue.origin ?? "gildi"} sé ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `Of lítið: gert er ráð fyrir að ${issue.origin} hafi ${adj}${issue.minimum.toString()} ${sizing.unit}`;
                }
                return `Of lítið: gert er ráð fyrir að ${issue.origin} sé ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with") {
                    return `Ógildur strengur: verður að byrja á "${_issue.prefix}"`;
                }
                if (_issue.format === "ends_with")
                    return `Ógildur strengur: verður að enda á "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `Ógildur strengur: verður að innihalda "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `Ógildur strengur: verður að fylgja mynstri ${_issue.pattern}`;
                return `Rangt ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Röng tala: verður að vera margfeldi af ${issue.divisor}`;
            case "unrecognized_keys":
                return `Óþekkt ${issue.keys.length > 1 ? "ir lyklar" : "ur lykill"}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Rangur lykill í ${issue.origin}`;
            case "invalid_union":
                return "Rangt gildi";
            case "invalid_element":
                return `Rangt gildi í ${issue.origin}`;
            default:
                return `Rangt gildi`;
        }
    };
};
/* harmony default export */ function is() {
    return {
        localeError: is_error(),
    };
}

;// ./node_modules/zod/v4/locales/it.js

const it_error = () => {
    const Sizable = {
        string: { unit: "caratteri", verb: "avere" },
        file: { unit: "byte", verb: "avere" },
        array: { unit: "elementi", verb: "avere" },
        set: { unit: "elementi", verb: "avere" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "input",
        email: "indirizzo email",
        url: "URL",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "data e ora ISO",
        date: "data ISO",
        time: "ora ISO",
        duration: "durata ISO",
        ipv4: "indirizzo IPv4",
        ipv6: "indirizzo IPv6",
        cidrv4: "intervallo IPv4",
        cidrv6: "intervallo IPv6",
        base64: "stringa codificata in base64",
        base64url: "URL codificata in base64",
        json_string: "stringa JSON",
        e164: "numero E.164",
        jwt: "JWT",
        template_literal: "input",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "numero",
        array: "vettore",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Input non valido: atteso instanceof ${issue.expected}, ricevuto ${received}`;
                }
                return `Input non valido: atteso ${expected}, ricevuto ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Input non valido: atteso ${util.stringifyPrimitive(issue.values[0])}`;
                return `Opzione non valida: atteso uno tra ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `Troppo grande: ${issue.origin ?? "valore"} deve avere ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elementi"}`;
                return `Troppo grande: ${issue.origin ?? "valore"} deve essere ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `Troppo piccolo: ${issue.origin} deve avere ${adj}${issue.minimum.toString()} ${sizing.unit}`;
                }
                return `Troppo piccolo: ${issue.origin} deve essere ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with")
                    return `Stringa non valida: deve iniziare con "${_issue.prefix}"`;
                if (_issue.format === "ends_with")
                    return `Stringa non valida: deve terminare con "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `Stringa non valida: deve includere "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `Stringa non valida: deve corrispondere al pattern ${_issue.pattern}`;
                return `Input non valido: ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Numero non valido: deve essere un multiplo di ${issue.divisor}`;
            case "unrecognized_keys":
                return `Chiav${issue.keys.length > 1 ? "i" : "e"} non riconosciut${issue.keys.length > 1 ? "e" : "a"}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Chiave non valida in ${issue.origin}`;
            case "invalid_union":
                return "Input non valido";
            case "invalid_element":
                return `Valore non valido in ${issue.origin}`;
            default:
                return `Input non valido`;
        }
    };
};
/* harmony default export */ function it() {
    return {
        localeError: it_error(),
    };
}

;// ./node_modules/zod/v4/locales/ja.js

const ja_error = () => {
    const Sizable = {
        string: { unit: "文字", verb: "である" },
        file: { unit: "バイト", verb: "である" },
        array: { unit: "要素", verb: "である" },
        set: { unit: "要素", verb: "である" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "入力値",
        email: "メールアドレス",
        url: "URL",
        emoji: "絵文字",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO日時",
        date: "ISO日付",
        time: "ISO時刻",
        duration: "ISO期間",
        ipv4: "IPv4アドレス",
        ipv6: "IPv6アドレス",
        cidrv4: "IPv4範囲",
        cidrv6: "IPv6範囲",
        base64: "base64エンコード文字列",
        base64url: "base64urlエンコード文字列",
        json_string: "JSON文字列",
        e164: "E.164番号",
        jwt: "JWT",
        template_literal: "入力値",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "数値",
        array: "配列",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `無効な入力: instanceof ${issue.expected}が期待されましたが、${received}が入力されました`;
                }
                return `無効な入力: ${expected}が期待されましたが、${received}が入力されました`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `無効な入力: ${util.stringifyPrimitive(issue.values[0])}が期待されました`;
                return `無効な選択: ${util.joinValues(issue.values, "、")}のいずれかである必要があります`;
            case "too_big": {
                const adj = issue.inclusive ? "以下である" : "より小さい";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `大きすぎる値: ${issue.origin ?? "値"}は${issue.maximum.toString()}${sizing.unit ?? "要素"}${adj}必要があります`;
                return `大きすぎる値: ${issue.origin ?? "値"}は${issue.maximum.toString()}${adj}必要があります`;
            }
            case "too_small": {
                const adj = issue.inclusive ? "以上である" : "より大きい";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `小さすぎる値: ${issue.origin}は${issue.minimum.toString()}${sizing.unit}${adj}必要があります`;
                return `小さすぎる値: ${issue.origin}は${issue.minimum.toString()}${adj}必要があります`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with")
                    return `無効な文字列: "${_issue.prefix}"で始まる必要があります`;
                if (_issue.format === "ends_with")
                    return `無効な文字列: "${_issue.suffix}"で終わる必要があります`;
                if (_issue.format === "includes")
                    return `無効な文字列: "${_issue.includes}"を含む必要があります`;
                if (_issue.format === "regex")
                    return `無効な文字列: パターン${_issue.pattern}に一致する必要があります`;
                return `無効な${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `無効な数値: ${issue.divisor}の倍数である必要があります`;
            case "unrecognized_keys":
                return `認識されていないキー${issue.keys.length > 1 ? "群" : ""}: ${util.joinValues(issue.keys, "、")}`;
            case "invalid_key":
                return `${issue.origin}内の無効なキー`;
            case "invalid_union":
                return "無効な入力";
            case "invalid_element":
                return `${issue.origin}内の無効な値`;
            default:
                return `無効な入力`;
        }
    };
};
/* harmony default export */ function ja() {
    return {
        localeError: ja_error(),
    };
}

;// ./node_modules/zod/v4/locales/ka.js

const ka_error = () => {
    const Sizable = {
        string: { unit: "სიმბოლო", verb: "უნდა შეიცავდეს" },
        file: { unit: "ბაიტი", verb: "უნდა შეიცავდეს" },
        array: { unit: "ელემენტი", verb: "უნდა შეიცავდეს" },
        set: { unit: "ელემენტი", verb: "უნდა შეიცავდეს" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "შეყვანა",
        email: "ელ-ფოსტის მისამართი",
        url: "URL",
        emoji: "ემოჯი",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "თარიღი-დრო",
        date: "თარიღი",
        time: "დრო",
        duration: "ხანგრძლივობა",
        ipv4: "IPv4 მისამართი",
        ipv6: "IPv6 მისამართი",
        cidrv4: "IPv4 დიაპაზონი",
        cidrv6: "IPv6 დიაპაზონი",
        base64: "base64-კოდირებული ველი",
        base64url: "base64url-კოდირებული ველი",
        json_string: "JSON ველი",
        e164: "E.164 ნომერი",
        jwt: "JWT",
        template_literal: "შეყვანა",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "რიცხვი",
        string: "ველი",
        boolean: "ბულეანი",
        function: "ფუნქცია",
        array: "მასივი",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `არასწორი შეყვანა: მოსალოდნელი instanceof ${issue.expected}, მიღებული ${received}`;
                }
                return `არასწორი შეყვანა: მოსალოდნელი ${expected}, მიღებული ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `არასწორი შეყვანა: მოსალოდნელი ${util.stringifyPrimitive(issue.values[0])}`;
                return `არასწორი ვარიანტი: მოსალოდნელია ერთ-ერთი ${util.joinValues(issue.values, "|")}-დან`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `ზედმეტად დიდი: მოსალოდნელი ${issue.origin ?? "მნიშვნელობა"} ${sizing.verb} ${adj}${issue.maximum.toString()} ${sizing.unit}`;
                return `ზედმეტად დიდი: მოსალოდნელი ${issue.origin ?? "მნიშვნელობა"} იყოს ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `ზედმეტად პატარა: მოსალოდნელი ${issue.origin} ${sizing.verb} ${adj}${issue.minimum.toString()} ${sizing.unit}`;
                }
                return `ზედმეტად პატარა: მოსალოდნელი ${issue.origin} იყოს ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with") {
                    return `არასწორი ველი: უნდა იწყებოდეს "${_issue.prefix}"-ით`;
                }
                if (_issue.format === "ends_with")
                    return `არასწორი ველი: უნდა მთავრდებოდეს "${_issue.suffix}"-ით`;
                if (_issue.format === "includes")
                    return `არასწორი ველი: უნდა შეიცავდეს "${_issue.includes}"-ს`;
                if (_issue.format === "regex")
                    return `არასწორი ველი: უნდა შეესაბამებოდეს შაბლონს ${_issue.pattern}`;
                return `არასწორი ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `არასწორი რიცხვი: უნდა იყოს ${issue.divisor}-ის ჯერადი`;
            case "unrecognized_keys":
                return `უცნობი გასაღებ${issue.keys.length > 1 ? "ები" : "ი"}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `არასწორი გასაღები ${issue.origin}-ში`;
            case "invalid_union":
                return "არასწორი შეყვანა";
            case "invalid_element":
                return `არასწორი მნიშვნელობა ${issue.origin}-ში`;
            default:
                return `არასწორი შეყვანა`;
        }
    };
};
/* harmony default export */ function ka() {
    return {
        localeError: ka_error(),
    };
}

;// ./node_modules/zod/v4/locales/km.js

const km_error = () => {
    const Sizable = {
        string: { unit: "តួអក្សរ", verb: "គួរមាន" },
        file: { unit: "បៃ", verb: "គួរមាន" },
        array: { unit: "ធាតុ", verb: "គួរមាន" },
        set: { unit: "ធាតុ", verb: "គួរមាន" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "ទិន្នន័យបញ្ចូល",
        email: "អាសយដ្ឋានអ៊ីមែល",
        url: "URL",
        emoji: "សញ្ញាអារម្មណ៍",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "កាលបរិច្ឆេទ និងម៉ោង ISO",
        date: "កាលបរិច្ឆេទ ISO",
        time: "ម៉ោង ISO",
        duration: "រយៈពេល ISO",
        ipv4: "អាសយដ្ឋាន IPv4",
        ipv6: "អាសយដ្ឋាន IPv6",
        cidrv4: "ដែនអាសយដ្ឋាន IPv4",
        cidrv6: "ដែនអាសយដ្ឋាន IPv6",
        base64: "ខ្សែអក្សរអ៊ិកូដ base64",
        base64url: "ខ្សែអក្សរអ៊ិកូដ base64url",
        json_string: "ខ្សែអក្សរ JSON",
        e164: "លេខ E.164",
        jwt: "JWT",
        template_literal: "ទិន្នន័យបញ្ចូល",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "លេខ",
        array: "អារេ (Array)",
        null: "គ្មានតម្លៃ (null)",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `ទិន្នន័យបញ្ចូលមិនត្រឹមត្រូវ៖ ត្រូវការ instanceof ${issue.expected} ប៉ុន្តែទទួលបាន ${received}`;
                }
                return `ទិន្នន័យបញ្ចូលមិនត្រឹមត្រូវ៖ ត្រូវការ ${expected} ប៉ុន្តែទទួលបាន ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `ទិន្នន័យបញ្ចូលមិនត្រឹមត្រូវ៖ ត្រូវការ ${util.stringifyPrimitive(issue.values[0])}`;
                return `ជម្រើសមិនត្រឹមត្រូវ៖ ត្រូវជាមួយក្នុងចំណោម ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `ធំពេក៖ ត្រូវការ ${issue.origin ?? "តម្លៃ"} ${adj} ${issue.maximum.toString()} ${sizing.unit ?? "ធាតុ"}`;
                return `ធំពេក៖ ត្រូវការ ${issue.origin ?? "តម្លៃ"} ${adj} ${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `តូចពេក៖ ត្រូវការ ${issue.origin} ${adj} ${issue.minimum.toString()} ${sizing.unit}`;
                }
                return `តូចពេក៖ ត្រូវការ ${issue.origin} ${adj} ${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with") {
                    return `ខ្សែអក្សរមិនត្រឹមត្រូវ៖ ត្រូវចាប់ផ្តើមដោយ "${_issue.prefix}"`;
                }
                if (_issue.format === "ends_with")
                    return `ខ្សែអក្សរមិនត្រឹមត្រូវ៖ ត្រូវបញ្ចប់ដោយ "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `ខ្សែអក្សរមិនត្រឹមត្រូវ៖ ត្រូវមាន "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `ខ្សែអក្សរមិនត្រឹមត្រូវ៖ ត្រូវតែផ្គូផ្គងនឹងទម្រង់ដែលបានកំណត់ ${_issue.pattern}`;
                return `មិនត្រឹមត្រូវ៖ ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `លេខមិនត្រឹមត្រូវ៖ ត្រូវតែជាពហុគុណនៃ ${issue.divisor}`;
            case "unrecognized_keys":
                return `រកឃើញសោមិនស្គាល់៖ ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `សោមិនត្រឹមត្រូវនៅក្នុង ${issue.origin}`;
            case "invalid_union":
                return `ទិន្នន័យមិនត្រឹមត្រូវ`;
            case "invalid_element":
                return `ទិន្នន័យមិនត្រឹមត្រូវនៅក្នុង ${issue.origin}`;
            default:
                return `ទិន្នន័យមិនត្រឹមត្រូវ`;
        }
    };
};
/* harmony default export */ function km() {
    return {
        localeError: km_error(),
    };
}

;// ./node_modules/zod/v4/locales/kh.js

/** @deprecated Use `km` instead. */
/* harmony default export */ function kh() {
    return km();
}

;// ./node_modules/zod/v4/locales/ko.js

const ko_error = () => {
    const Sizable = {
        string: { unit: "문자", verb: "to have" },
        file: { unit: "바이트", verb: "to have" },
        array: { unit: "개", verb: "to have" },
        set: { unit: "개", verb: "to have" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "입력",
        email: "이메일 주소",
        url: "URL",
        emoji: "이모지",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO 날짜시간",
        date: "ISO 날짜",
        time: "ISO 시간",
        duration: "ISO 기간",
        ipv4: "IPv4 주소",
        ipv6: "IPv6 주소",
        cidrv4: "IPv4 범위",
        cidrv6: "IPv6 범위",
        base64: "base64 인코딩 문자열",
        base64url: "base64url 인코딩 문자열",
        json_string: "JSON 문자열",
        e164: "E.164 번호",
        jwt: "JWT",
        template_literal: "입력",
    };
    const TypeDictionary = {
        nan: "NaN",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `잘못된 입력: 예상 타입은 instanceof ${issue.expected}, 받은 타입은 ${received}입니다`;
                }
                return `잘못된 입력: 예상 타입은 ${expected}, 받은 타입은 ${received}입니다`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `잘못된 입력: 값은 ${util.stringifyPrimitive(issue.values[0])} 이어야 합니다`;
                return `잘못된 옵션: ${util.joinValues(issue.values, "또는 ")} 중 하나여야 합니다`;
            case "too_big": {
                const adj = issue.inclusive ? "이하" : "미만";
                const suffix = adj === "미만" ? "이어야 합니다" : "여야 합니다";
                const sizing = getSizing(issue.origin);
                const unit = sizing?.unit ?? "요소";
                if (sizing)
                    return `${issue.origin ?? "값"}이 너무 큽니다: ${issue.maximum.toString()}${unit} ${adj}${suffix}`;
                return `${issue.origin ?? "값"}이 너무 큽니다: ${issue.maximum.toString()} ${adj}${suffix}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? "이상" : "초과";
                const suffix = adj === "이상" ? "이어야 합니다" : "여야 합니다";
                const sizing = getSizing(issue.origin);
                const unit = sizing?.unit ?? "요소";
                if (sizing) {
                    return `${issue.origin ?? "값"}이 너무 작습니다: ${issue.minimum.toString()}${unit} ${adj}${suffix}`;
                }
                return `${issue.origin ?? "값"}이 너무 작습니다: ${issue.minimum.toString()} ${adj}${suffix}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with") {
                    return `잘못된 문자열: "${_issue.prefix}"(으)로 시작해야 합니다`;
                }
                if (_issue.format === "ends_with")
                    return `잘못된 문자열: "${_issue.suffix}"(으)로 끝나야 합니다`;
                if (_issue.format === "includes")
                    return `잘못된 문자열: "${_issue.includes}"을(를) 포함해야 합니다`;
                if (_issue.format === "regex")
                    return `잘못된 문자열: 정규식 ${_issue.pattern} 패턴과 일치해야 합니다`;
                return `잘못된 ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `잘못된 숫자: ${issue.divisor}의 배수여야 합니다`;
            case "unrecognized_keys":
                return `인식할 수 없는 키: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `잘못된 키: ${issue.origin}`;
            case "invalid_union":
                return `잘못된 입력`;
            case "invalid_element":
                return `잘못된 값: ${issue.origin}`;
            default:
                return `잘못된 입력`;
        }
    };
};
/* harmony default export */ function ko() {
    return {
        localeError: ko_error(),
    };
}

;// ./node_modules/zod/v4/locales/lt.js

const capitalizeFirstCharacter = (text) => {
    return text.charAt(0).toUpperCase() + text.slice(1);
};
function getUnitTypeFromNumber(number) {
    const abs = Math.abs(number);
    const last = abs % 10;
    const last2 = abs % 100;
    if ((last2 >= 11 && last2 <= 19) || last === 0)
        return "many";
    if (last === 1)
        return "one";
    return "few";
}
const lt_error = () => {
    const Sizable = {
        string: {
            unit: {
                one: "simbolis",
                few: "simboliai",
                many: "simbolių",
            },
            verb: {
                smaller: {
                    inclusive: "turi būti ne ilgesnė kaip",
                    notInclusive: "turi būti trumpesnė kaip",
                },
                bigger: {
                    inclusive: "turi būti ne trumpesnė kaip",
                    notInclusive: "turi būti ilgesnė kaip",
                },
            },
        },
        file: {
            unit: {
                one: "baitas",
                few: "baitai",
                many: "baitų",
            },
            verb: {
                smaller: {
                    inclusive: "turi būti ne didesnis kaip",
                    notInclusive: "turi būti mažesnis kaip",
                },
                bigger: {
                    inclusive: "turi būti ne mažesnis kaip",
                    notInclusive: "turi būti didesnis kaip",
                },
            },
        },
        array: {
            unit: {
                one: "elementą",
                few: "elementus",
                many: "elementų",
            },
            verb: {
                smaller: {
                    inclusive: "turi turėti ne daugiau kaip",
                    notInclusive: "turi turėti mažiau kaip",
                },
                bigger: {
                    inclusive: "turi turėti ne mažiau kaip",
                    notInclusive: "turi turėti daugiau kaip",
                },
            },
        },
        set: {
            unit: {
                one: "elementą",
                few: "elementus",
                many: "elementų",
            },
            verb: {
                smaller: {
                    inclusive: "turi turėti ne daugiau kaip",
                    notInclusive: "turi turėti mažiau kaip",
                },
                bigger: {
                    inclusive: "turi turėti ne mažiau kaip",
                    notInclusive: "turi turėti daugiau kaip",
                },
            },
        },
    };
    function getSizing(origin, unitType, inclusive, targetShouldBe) {
        const result = Sizable[origin] ?? null;
        if (result === null)
            return result;
        return {
            unit: result.unit[unitType],
            verb: result.verb[targetShouldBe][inclusive ? "inclusive" : "notInclusive"],
        };
    }
    const FormatDictionary = {
        regex: "įvestis",
        email: "el. pašto adresas",
        url: "URL",
        emoji: "jaustukas",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO data ir laikas",
        date: "ISO data",
        time: "ISO laikas",
        duration: "ISO trukmė",
        ipv4: "IPv4 adresas",
        ipv6: "IPv6 adresas",
        cidrv4: "IPv4 tinklo prefiksas (CIDR)",
        cidrv6: "IPv6 tinklo prefiksas (CIDR)",
        base64: "base64 užkoduota eilutė",
        base64url: "base64url užkoduota eilutė",
        json_string: "JSON eilutė",
        e164: "E.164 numeris",
        jwt: "JWT",
        template_literal: "įvestis",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "skaičius",
        bigint: "sveikasis skaičius",
        string: "eilutė",
        boolean: "loginė reikšmė",
        undefined: "neapibrėžta reikšmė",
        function: "funkcija",
        symbol: "simbolis",
        array: "masyvas",
        object: "objektas",
        null: "nulinė reikšmė",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Gautas tipas ${received}, o tikėtasi - instanceof ${issue.expected}`;
                }
                return `Gautas tipas ${received}, o tikėtasi - ${expected}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Privalo būti ${util.stringifyPrimitive(issue.values[0])}`;
                return `Privalo būti vienas iš ${util.joinValues(issue.values, "|")} pasirinkimų`;
            case "too_big": {
                const origin = TypeDictionary[issue.origin] ?? issue.origin;
                const sizing = getSizing(issue.origin, getUnitTypeFromNumber(Number(issue.maximum)), issue.inclusive ?? false, "smaller");
                if (sizing?.verb)
                    return `${capitalizeFirstCharacter(origin ?? issue.origin ?? "reikšmė")} ${sizing.verb} ${issue.maximum.toString()} ${sizing.unit ?? "elementų"}`;
                const adj = issue.inclusive ? "ne didesnis kaip" : "mažesnis kaip";
                return `${capitalizeFirstCharacter(origin ?? issue.origin ?? "reikšmė")} turi būti ${adj} ${issue.maximum.toString()} ${sizing?.unit}`;
            }
            case "too_small": {
                const origin = TypeDictionary[issue.origin] ?? issue.origin;
                const sizing = getSizing(issue.origin, getUnitTypeFromNumber(Number(issue.minimum)), issue.inclusive ?? false, "bigger");
                if (sizing?.verb)
                    return `${capitalizeFirstCharacter(origin ?? issue.origin ?? "reikšmė")} ${sizing.verb} ${issue.minimum.toString()} ${sizing.unit ?? "elementų"}`;
                const adj = issue.inclusive ? "ne mažesnis kaip" : "didesnis kaip";
                return `${capitalizeFirstCharacter(origin ?? issue.origin ?? "reikšmė")} turi būti ${adj} ${issue.minimum.toString()} ${sizing?.unit}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with") {
                    return `Eilutė privalo prasidėti "${_issue.prefix}"`;
                }
                if (_issue.format === "ends_with")
                    return `Eilutė privalo pasibaigti "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `Eilutė privalo įtraukti "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `Eilutė privalo atitikti ${_issue.pattern}`;
                return `Neteisingas ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Skaičius privalo būti ${issue.divisor} kartotinis.`;
            case "unrecognized_keys":
                return `Neatpažint${issue.keys.length > 1 ? "i" : "as"} rakt${issue.keys.length > 1 ? "ai" : "as"}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return "Rastas klaidingas raktas";
            case "invalid_union":
                return "Klaidinga įvestis";
            case "invalid_element": {
                const origin = TypeDictionary[issue.origin] ?? issue.origin;
                return `${capitalizeFirstCharacter(origin ?? issue.origin ?? "reikšmė")} turi klaidingą įvestį`;
            }
            default:
                return "Klaidinga įvestis";
        }
    };
};
/* harmony default export */ function lt() {
    return {
        localeError: lt_error(),
    };
}

;// ./node_modules/zod/v4/locales/mk.js

const mk_error = () => {
    const Sizable = {
        string: { unit: "знаци", verb: "да имаат" },
        file: { unit: "бајти", verb: "да имаат" },
        array: { unit: "ставки", verb: "да имаат" },
        set: { unit: "ставки", verb: "да имаат" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "внес",
        email: "адреса на е-пошта",
        url: "URL",
        emoji: "емоџи",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO датум и време",
        date: "ISO датум",
        time: "ISO време",
        duration: "ISO времетраење",
        ipv4: "IPv4 адреса",
        ipv6: "IPv6 адреса",
        cidrv4: "IPv4 опсег",
        cidrv6: "IPv6 опсег",
        base64: "base64-енкодирана низа",
        base64url: "base64url-енкодирана низа",
        json_string: "JSON низа",
        e164: "E.164 број",
        jwt: "JWT",
        template_literal: "внес",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "број",
        array: "низа",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Грешен внес: се очекува instanceof ${issue.expected}, примено ${received}`;
                }
                return `Грешен внес: се очекува ${expected}, примено ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Invalid input: expected ${util.stringifyPrimitive(issue.values[0])}`;
                return `Грешана опција: се очекува една ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `Премногу голем: се очекува ${issue.origin ?? "вредноста"} да има ${adj}${issue.maximum.toString()} ${sizing.unit ?? "елементи"}`;
                return `Премногу голем: се очекува ${issue.origin ?? "вредноста"} да биде ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `Премногу мал: се очекува ${issue.origin} да има ${adj}${issue.minimum.toString()} ${sizing.unit}`;
                }
                return `Премногу мал: се очекува ${issue.origin} да биде ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with") {
                    return `Неважечка низа: мора да започнува со "${_issue.prefix}"`;
                }
                if (_issue.format === "ends_with")
                    return `Неважечка низа: мора да завршува со "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `Неважечка низа: мора да вклучува "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `Неважечка низа: мора да одгоара на патернот ${_issue.pattern}`;
                return `Invalid ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Грешен број: мора да биде делив со ${issue.divisor}`;
            case "unrecognized_keys":
                return `${issue.keys.length > 1 ? "Непрепознаени клучеви" : "Непрепознаен клуч"}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Грешен клуч во ${issue.origin}`;
            case "invalid_union":
                return "Грешен внес";
            case "invalid_element":
                return `Грешна вредност во ${issue.origin}`;
            default:
                return `Грешен внес`;
        }
    };
};
/* harmony default export */ function mk() {
    return {
        localeError: mk_error(),
    };
}

;// ./node_modules/zod/v4/locales/ms.js

const ms_error = () => {
    const Sizable = {
        string: { unit: "aksara", verb: "mempunyai" },
        file: { unit: "bait", verb: "mempunyai" },
        array: { unit: "elemen", verb: "mempunyai" },
        set: { unit: "elemen", verb: "mempunyai" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "input",
        email: "alamat e-mel",
        url: "URL",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "tarikh masa ISO",
        date: "tarikh ISO",
        time: "masa ISO",
        duration: "tempoh ISO",
        ipv4: "alamat IPv4",
        ipv6: "alamat IPv6",
        cidrv4: "julat IPv4",
        cidrv6: "julat IPv6",
        base64: "string dikodkan base64",
        base64url: "string dikodkan base64url",
        json_string: "string JSON",
        e164: "nombor E.164",
        jwt: "JWT",
        template_literal: "input",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "nombor",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Input tidak sah: dijangka instanceof ${issue.expected}, diterima ${received}`;
                }
                return `Input tidak sah: dijangka ${expected}, diterima ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Input tidak sah: dijangka ${util.stringifyPrimitive(issue.values[0])}`;
                return `Pilihan tidak sah: dijangka salah satu daripada ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `Terlalu besar: dijangka ${issue.origin ?? "nilai"} ${sizing.verb} ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elemen"}`;
                return `Terlalu besar: dijangka ${issue.origin ?? "nilai"} adalah ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `Terlalu kecil: dijangka ${issue.origin} ${sizing.verb} ${adj}${issue.minimum.toString()} ${sizing.unit}`;
                }
                return `Terlalu kecil: dijangka ${issue.origin} adalah ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with")
                    return `String tidak sah: mesti bermula dengan "${_issue.prefix}"`;
                if (_issue.format === "ends_with")
                    return `String tidak sah: mesti berakhir dengan "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `String tidak sah: mesti mengandungi "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `String tidak sah: mesti sepadan dengan corak ${_issue.pattern}`;
                return `${FormatDictionary[_issue.format] ?? issue.format} tidak sah`;
            }
            case "not_multiple_of":
                return `Nombor tidak sah: perlu gandaan ${issue.divisor}`;
            case "unrecognized_keys":
                return `Kunci tidak dikenali: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Kunci tidak sah dalam ${issue.origin}`;
            case "invalid_union":
                return "Input tidak sah";
            case "invalid_element":
                return `Nilai tidak sah dalam ${issue.origin}`;
            default:
                return `Input tidak sah`;
        }
    };
};
/* harmony default export */ function ms() {
    return {
        localeError: ms_error(),
    };
}

;// ./node_modules/zod/v4/locales/nl.js

const nl_error = () => {
    const Sizable = {
        string: { unit: "tekens", verb: "heeft" },
        file: { unit: "bytes", verb: "heeft" },
        array: { unit: "elementen", verb: "heeft" },
        set: { unit: "elementen", verb: "heeft" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "invoer",
        email: "emailadres",
        url: "URL",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO datum en tijd",
        date: "ISO datum",
        time: "ISO tijd",
        duration: "ISO duur",
        ipv4: "IPv4-adres",
        ipv6: "IPv6-adres",
        cidrv4: "IPv4-bereik",
        cidrv6: "IPv6-bereik",
        base64: "base64-gecodeerde tekst",
        base64url: "base64 URL-gecodeerde tekst",
        json_string: "JSON string",
        e164: "E.164-nummer",
        jwt: "JWT",
        template_literal: "invoer",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "getal",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Ongeldige invoer: verwacht instanceof ${issue.expected}, ontving ${received}`;
                }
                return `Ongeldige invoer: verwacht ${expected}, ontving ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Ongeldige invoer: verwacht ${util.stringifyPrimitive(issue.values[0])}`;
                return `Ongeldige optie: verwacht één van ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                const longName = issue.origin === "date" ? "laat" : issue.origin === "string" ? "lang" : "groot";
                if (sizing)
                    return `Te ${longName}: verwacht dat ${issue.origin ?? "waarde"} ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elementen"} ${sizing.verb}`;
                return `Te ${longName}: verwacht dat ${issue.origin ?? "waarde"} ${adj}${issue.maximum.toString()} is`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                const shortName = issue.origin === "date" ? "vroeg" : issue.origin === "string" ? "kort" : "klein";
                if (sizing) {
                    return `Te ${shortName}: verwacht dat ${issue.origin} ${adj}${issue.minimum.toString()} ${sizing.unit} ${sizing.verb}`;
                }
                return `Te ${shortName}: verwacht dat ${issue.origin} ${adj}${issue.minimum.toString()} is`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with") {
                    return `Ongeldige tekst: moet met "${_issue.prefix}" beginnen`;
                }
                if (_issue.format === "ends_with")
                    return `Ongeldige tekst: moet op "${_issue.suffix}" eindigen`;
                if (_issue.format === "includes")
                    return `Ongeldige tekst: moet "${_issue.includes}" bevatten`;
                if (_issue.format === "regex")
                    return `Ongeldige tekst: moet overeenkomen met patroon ${_issue.pattern}`;
                return `Ongeldig: ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Ongeldig getal: moet een veelvoud van ${issue.divisor} zijn`;
            case "unrecognized_keys":
                return `Onbekende key${issue.keys.length > 1 ? "s" : ""}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Ongeldige key in ${issue.origin}`;
            case "invalid_union":
                return "Ongeldige invoer";
            case "invalid_element":
                return `Ongeldige waarde in ${issue.origin}`;
            default:
                return `Ongeldige invoer`;
        }
    };
};
/* harmony default export */ function nl() {
    return {
        localeError: nl_error(),
    };
}

;// ./node_modules/zod/v4/locales/no.js

const no_error = () => {
    const Sizable = {
        string: { unit: "tegn", verb: "å ha" },
        file: { unit: "bytes", verb: "å ha" },
        array: { unit: "elementer", verb: "å inneholde" },
        set: { unit: "elementer", verb: "å inneholde" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "input",
        email: "e-postadresse",
        url: "URL",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO dato- og klokkeslett",
        date: "ISO-dato",
        time: "ISO-klokkeslett",
        duration: "ISO-varighet",
        ipv4: "IPv4-område",
        ipv6: "IPv6-område",
        cidrv4: "IPv4-spekter",
        cidrv6: "IPv6-spekter",
        base64: "base64-enkodet streng",
        base64url: "base64url-enkodet streng",
        json_string: "JSON-streng",
        e164: "E.164-nummer",
        jwt: "JWT",
        template_literal: "input",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "tall",
        array: "liste",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Ugyldig input: forventet instanceof ${issue.expected}, fikk ${received}`;
                }
                return `Ugyldig input: forventet ${expected}, fikk ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Ugyldig verdi: forventet ${util.stringifyPrimitive(issue.values[0])}`;
                return `Ugyldig valg: forventet en av ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `For stor(t): forventet ${issue.origin ?? "value"} til å ha ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elementer"}`;
                return `For stor(t): forventet ${issue.origin ?? "value"} til å ha ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `For lite(n): forventet ${issue.origin} til å ha ${adj}${issue.minimum.toString()} ${sizing.unit}`;
                }
                return `For lite(n): forventet ${issue.origin} til å ha ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with")
                    return `Ugyldig streng: må starte med "${_issue.prefix}"`;
                if (_issue.format === "ends_with")
                    return `Ugyldig streng: må ende med "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `Ugyldig streng: må inneholde "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `Ugyldig streng: må matche mønsteret ${_issue.pattern}`;
                return `Ugyldig ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Ugyldig tall: må være et multiplum av ${issue.divisor}`;
            case "unrecognized_keys":
                return `${issue.keys.length > 1 ? "Ukjente nøkler" : "Ukjent nøkkel"}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Ugyldig nøkkel i ${issue.origin}`;
            case "invalid_union":
                return "Ugyldig input";
            case "invalid_element":
                return `Ugyldig verdi i ${issue.origin}`;
            default:
                return `Ugyldig input`;
        }
    };
};
/* harmony default export */ function no() {
    return {
        localeError: no_error(),
    };
}

;// ./node_modules/zod/v4/locales/ota.js

const ota_error = () => {
    const Sizable = {
        string: { unit: "harf", verb: "olmalıdır" },
        file: { unit: "bayt", verb: "olmalıdır" },
        array: { unit: "unsur", verb: "olmalıdır" },
        set: { unit: "unsur", verb: "olmalıdır" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "giren",
        email: "epostagâh",
        url: "URL",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO hengâmı",
        date: "ISO tarihi",
        time: "ISO zamanı",
        duration: "ISO müddeti",
        ipv4: "IPv4 nişânı",
        ipv6: "IPv6 nişânı",
        cidrv4: "IPv4 menzili",
        cidrv6: "IPv6 menzili",
        base64: "base64-şifreli metin",
        base64url: "base64url-şifreli metin",
        json_string: "JSON metin",
        e164: "E.164 sayısı",
        jwt: "JWT",
        template_literal: "giren",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "numara",
        array: "saf",
        null: "gayb",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Fâsit giren: umulan instanceof ${issue.expected}, alınan ${received}`;
                }
                return `Fâsit giren: umulan ${expected}, alınan ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Fâsit giren: umulan ${util.stringifyPrimitive(issue.values[0])}`;
                return `Fâsit tercih: mûteberler ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `Fazla büyük: ${issue.origin ?? "value"}, ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elements"} sahip olmalıydı.`;
                return `Fazla büyük: ${issue.origin ?? "value"}, ${adj}${issue.maximum.toString()} olmalıydı.`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `Fazla küçük: ${issue.origin}, ${adj}${issue.minimum.toString()} ${sizing.unit} sahip olmalıydı.`;
                }
                return `Fazla küçük: ${issue.origin}, ${adj}${issue.minimum.toString()} olmalıydı.`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with")
                    return `Fâsit metin: "${_issue.prefix}" ile başlamalı.`;
                if (_issue.format === "ends_with")
                    return `Fâsit metin: "${_issue.suffix}" ile bitmeli.`;
                if (_issue.format === "includes")
                    return `Fâsit metin: "${_issue.includes}" ihtivâ etmeli.`;
                if (_issue.format === "regex")
                    return `Fâsit metin: ${_issue.pattern} nakşına uymalı.`;
                return `Fâsit ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Fâsit sayı: ${issue.divisor} katı olmalıydı.`;
            case "unrecognized_keys":
                return `Tanınmayan anahtar ${issue.keys.length > 1 ? "s" : ""}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `${issue.origin} için tanınmayan anahtar var.`;
            case "invalid_union":
                return "Giren tanınamadı.";
            case "invalid_element":
                return `${issue.origin} için tanınmayan kıymet var.`;
            default:
                return `Kıymet tanınamadı.`;
        }
    };
};
/* harmony default export */ function ota() {
    return {
        localeError: ota_error(),
    };
}

;// ./node_modules/zod/v4/locales/ps.js

const ps_error = () => {
    const Sizable = {
        string: { unit: "توکي", verb: "ولري" },
        file: { unit: "بایټس", verb: "ولري" },
        array: { unit: "توکي", verb: "ولري" },
        set: { unit: "توکي", verb: "ولري" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "ورودي",
        email: "بریښنالیک",
        url: "یو آر ال",
        emoji: "ایموجي",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "نیټه او وخت",
        date: "نېټه",
        time: "وخت",
        duration: "موده",
        ipv4: "د IPv4 پته",
        ipv6: "د IPv6 پته",
        cidrv4: "د IPv4 ساحه",
        cidrv6: "د IPv6 ساحه",
        base64: "base64-encoded متن",
        base64url: "base64url-encoded متن",
        json_string: "JSON متن",
        e164: "د E.164 شمېره",
        jwt: "JWT",
        template_literal: "ورودي",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "عدد",
        array: "ارې",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `ناسم ورودي: باید instanceof ${issue.expected} وای, مګر ${received} ترلاسه شو`;
                }
                return `ناسم ورودي: باید ${expected} وای, مګر ${received} ترلاسه شو`;
            }
            case "invalid_value":
                if (issue.values.length === 1) {
                    return `ناسم ورودي: باید ${util.stringifyPrimitive(issue.values[0])} وای`;
                }
                return `ناسم انتخاب: باید یو له ${util.joinValues(issue.values, "|")} څخه وای`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `ډیر لوی: ${issue.origin ?? "ارزښت"} باید ${adj}${issue.maximum.toString()} ${sizing.unit ?? "عنصرونه"} ولري`;
                }
                return `ډیر لوی: ${issue.origin ?? "ارزښت"} باید ${adj}${issue.maximum.toString()} وي`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `ډیر کوچنی: ${issue.origin} باید ${adj}${issue.minimum.toString()} ${sizing.unit} ولري`;
                }
                return `ډیر کوچنی: ${issue.origin} باید ${adj}${issue.minimum.toString()} وي`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with") {
                    return `ناسم متن: باید د "${_issue.prefix}" سره پیل شي`;
                }
                if (_issue.format === "ends_with") {
                    return `ناسم متن: باید د "${_issue.suffix}" سره پای ته ورسيږي`;
                }
                if (_issue.format === "includes") {
                    return `ناسم متن: باید "${_issue.includes}" ولري`;
                }
                if (_issue.format === "regex") {
                    return `ناسم متن: باید د ${_issue.pattern} سره مطابقت ولري`;
                }
                return `${FormatDictionary[_issue.format] ?? issue.format} ناسم دی`;
            }
            case "not_multiple_of":
                return `ناسم عدد: باید د ${issue.divisor} مضرب وي`;
            case "unrecognized_keys":
                return `ناسم ${issue.keys.length > 1 ? "کلیډونه" : "کلیډ"}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `ناسم کلیډ په ${issue.origin} کې`;
            case "invalid_union":
                return `ناسمه ورودي`;
            case "invalid_element":
                return `ناسم عنصر په ${issue.origin} کې`;
            default:
                return `ناسمه ورودي`;
        }
    };
};
/* harmony default export */ function ps() {
    return {
        localeError: ps_error(),
    };
}

;// ./node_modules/zod/v4/locales/pl.js

const pl_error = () => {
    const Sizable = {
        string: { unit: "znaków", verb: "mieć" },
        file: { unit: "bajtów", verb: "mieć" },
        array: { unit: "elementów", verb: "mieć" },
        set: { unit: "elementów", verb: "mieć" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "wyrażenie",
        email: "adres email",
        url: "URL",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "data i godzina w formacie ISO",
        date: "data w formacie ISO",
        time: "godzina w formacie ISO",
        duration: "czas trwania ISO",
        ipv4: "adres IPv4",
        ipv6: "adres IPv6",
        cidrv4: "zakres IPv4",
        cidrv6: "zakres IPv6",
        base64: "ciąg znaków zakodowany w formacie base64",
        base64url: "ciąg znaków zakodowany w formacie base64url",
        json_string: "ciąg znaków w formacie JSON",
        e164: "liczba E.164",
        jwt: "JWT",
        template_literal: "wejście",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "liczba",
        array: "tablica",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Nieprawidłowe dane wejściowe: oczekiwano instanceof ${issue.expected}, otrzymano ${received}`;
                }
                return `Nieprawidłowe dane wejściowe: oczekiwano ${expected}, otrzymano ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Nieprawidłowe dane wejściowe: oczekiwano ${util.stringifyPrimitive(issue.values[0])}`;
                return `Nieprawidłowa opcja: oczekiwano jednej z wartości ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `Za duża wartość: oczekiwano, że ${issue.origin ?? "wartość"} będzie mieć ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elementów"}`;
                }
                return `Zbyt duż(y/a/e): oczekiwano, że ${issue.origin ?? "wartość"} będzie wynosić ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `Za mała wartość: oczekiwano, że ${issue.origin ?? "wartość"} będzie mieć ${adj}${issue.minimum.toString()} ${sizing.unit ?? "elementów"}`;
                }
                return `Zbyt mał(y/a/e): oczekiwano, że ${issue.origin ?? "wartość"} będzie wynosić ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with")
                    return `Nieprawidłowy ciąg znaków: musi zaczynać się od "${_issue.prefix}"`;
                if (_issue.format === "ends_with")
                    return `Nieprawidłowy ciąg znaków: musi kończyć się na "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `Nieprawidłowy ciąg znaków: musi zawierać "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `Nieprawidłowy ciąg znaków: musi odpowiadać wzorcowi ${_issue.pattern}`;
                return `Nieprawidłow(y/a/e) ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Nieprawidłowa liczba: musi być wielokrotnością ${issue.divisor}`;
            case "unrecognized_keys":
                return `Nierozpoznane klucze${issue.keys.length > 1 ? "s" : ""}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Nieprawidłowy klucz w ${issue.origin}`;
            case "invalid_union":
                return "Nieprawidłowe dane wejściowe";
            case "invalid_element":
                return `Nieprawidłowa wartość w ${issue.origin}`;
            default:
                return `Nieprawidłowe dane wejściowe`;
        }
    };
};
/* harmony default export */ function pl() {
    return {
        localeError: pl_error(),
    };
}

;// ./node_modules/zod/v4/locales/pt.js

const pt_error = () => {
    const Sizable = {
        string: { unit: "caracteres", verb: "ter" },
        file: { unit: "bytes", verb: "ter" },
        array: { unit: "itens", verb: "ter" },
        set: { unit: "itens", verb: "ter" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "padrão",
        email: "endereço de e-mail",
        url: "URL",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "data e hora ISO",
        date: "data ISO",
        time: "hora ISO",
        duration: "duração ISO",
        ipv4: "endereço IPv4",
        ipv6: "endereço IPv6",
        cidrv4: "faixa de IPv4",
        cidrv6: "faixa de IPv6",
        base64: "texto codificado em base64",
        base64url: "URL codificada em base64",
        json_string: "texto JSON",
        e164: "número E.164",
        jwt: "JWT",
        template_literal: "entrada",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "número",
        null: "nulo",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Tipo inválido: esperado instanceof ${issue.expected}, recebido ${received}`;
                }
                return `Tipo inválido: esperado ${expected}, recebido ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Entrada inválida: esperado ${util.stringifyPrimitive(issue.values[0])}`;
                return `Opção inválida: esperada uma das ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `Muito grande: esperado que ${issue.origin ?? "valor"} tivesse ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elementos"}`;
                return `Muito grande: esperado que ${issue.origin ?? "valor"} fosse ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `Muito pequeno: esperado que ${issue.origin} tivesse ${adj}${issue.minimum.toString()} ${sizing.unit}`;
                }
                return `Muito pequeno: esperado que ${issue.origin} fosse ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with")
                    return `Texto inválido: deve começar com "${_issue.prefix}"`;
                if (_issue.format === "ends_with")
                    return `Texto inválido: deve terminar com "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `Texto inválido: deve incluir "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `Texto inválido: deve corresponder ao padrão ${_issue.pattern}`;
                return `${FormatDictionary[_issue.format] ?? issue.format} inválido`;
            }
            case "not_multiple_of":
                return `Número inválido: deve ser múltiplo de ${issue.divisor}`;
            case "unrecognized_keys":
                return `Chave${issue.keys.length > 1 ? "s" : ""} desconhecida${issue.keys.length > 1 ? "s" : ""}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Chave inválida em ${issue.origin}`;
            case "invalid_union":
                return "Entrada inválida";
            case "invalid_element":
                return `Valor inválido em ${issue.origin}`;
            default:
                return `Campo inválido`;
        }
    };
};
/* harmony default export */ function pt() {
    return {
        localeError: pt_error(),
    };
}

;// ./node_modules/zod/v4/locales/ro.js

const ro_error = () => {
    const Sizable = {
        string: { unit: "caractere", verb: "să aibă" },
        file: { unit: "octeți", verb: "să aibă" },
        array: { unit: "elemente", verb: "să aibă" },
        set: { unit: "elemente", verb: "să aibă" },
        map: { unit: "intrări", verb: "să aibă" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "intrare",
        email: "adresă de email",
        url: "URL",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "dată și oră ISO",
        date: "dată ISO",
        time: "oră ISO",
        duration: "durată ISO",
        ipv4: "adresă IPv4",
        ipv6: "adresă IPv6",
        mac: "adresă MAC",
        cidrv4: "interval IPv4",
        cidrv6: "interval IPv6",
        base64: "șir codat base64",
        base64url: "șir codat base64url",
        json_string: "șir JSON",
        e164: "număr E.164",
        jwt: "JWT",
        template_literal: "intrare",
    };
    const TypeDictionary = {
        nan: "NaN",
        string: "șir",
        number: "număr",
        boolean: "boolean",
        function: "funcție",
        array: "matrice",
        object: "obiect",
        undefined: "nedefinit",
        symbol: "simbol",
        bigint: "număr mare",
        void: "void",
        never: "never",
        map: "hartă",
        set: "set",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                return `Intrare invalidă: așteptat ${expected}, primit ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Intrare invalidă: așteptat ${util.stringifyPrimitive(issue.values[0])}`;
                return `Opțiune invalidă: așteptat una dintre ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `Prea mare: așteptat ca ${issue.origin ?? "valoarea"} ${sizing.verb} ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elemente"}`;
                return `Prea mare: așteptat ca ${issue.origin ?? "valoarea"} să fie ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `Prea mic: așteptat ca ${issue.origin} ${sizing.verb} ${adj}${issue.minimum.toString()} ${sizing.unit}`;
                }
                return `Prea mic: așteptat ca ${issue.origin} să fie ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with") {
                    return `Șir invalid: trebuie să înceapă cu "${_issue.prefix}"`;
                }
                if (_issue.format === "ends_with")
                    return `Șir invalid: trebuie să se termine cu "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `Șir invalid: trebuie să includă "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `Șir invalid: trebuie să se potrivească cu modelul ${_issue.pattern}`;
                return `Format invalid: ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Număr invalid: trebuie să fie multiplu de ${issue.divisor}`;
            case "unrecognized_keys":
                return `Chei nerecunoscute: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Cheie invalidă în ${issue.origin}`;
            case "invalid_union":
                return "Intrare invalidă";
            case "invalid_element":
                return `Valoare invalidă în ${issue.origin}`;
            default:
                return `Intrare invalidă`;
        }
    };
};
/* harmony default export */ function ro() {
    return {
        localeError: ro_error(),
    };
}

;// ./node_modules/zod/v4/locales/ru.js

function getRussianPlural(count, one, few, many) {
    const absCount = Math.abs(count);
    const lastDigit = absCount % 10;
    const lastTwoDigits = absCount % 100;
    if (lastTwoDigits >= 11 && lastTwoDigits <= 19) {
        return many;
    }
    if (lastDigit === 1) {
        return one;
    }
    if (lastDigit >= 2 && lastDigit <= 4) {
        return few;
    }
    return many;
}
const ru_error = () => {
    const Sizable = {
        string: {
            unit: {
                one: "символ",
                few: "символа",
                many: "символов",
            },
            verb: "иметь",
        },
        file: {
            unit: {
                one: "байт",
                few: "байта",
                many: "байт",
            },
            verb: "иметь",
        },
        array: {
            unit: {
                one: "элемент",
                few: "элемента",
                many: "элементов",
            },
            verb: "иметь",
        },
        set: {
            unit: {
                one: "элемент",
                few: "элемента",
                many: "элементов",
            },
            verb: "иметь",
        },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "ввод",
        email: "email адрес",
        url: "URL",
        emoji: "эмодзи",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO дата и время",
        date: "ISO дата",
        time: "ISO время",
        duration: "ISO длительность",
        ipv4: "IPv4 адрес",
        ipv6: "IPv6 адрес",
        cidrv4: "IPv4 диапазон",
        cidrv6: "IPv6 диапазон",
        base64: "строка в формате base64",
        base64url: "строка в формате base64url",
        json_string: "JSON строка",
        e164: "номер E.164",
        jwt: "JWT",
        template_literal: "ввод",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "число",
        array: "массив",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Неверный ввод: ожидалось instanceof ${issue.expected}, получено ${received}`;
                }
                return `Неверный ввод: ожидалось ${expected}, получено ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Неверный ввод: ожидалось ${util.stringifyPrimitive(issue.values[0])}`;
                return `Неверный вариант: ожидалось одно из ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    const maxValue = Number(issue.maximum);
                    const unit = getRussianPlural(maxValue, sizing.unit.one, sizing.unit.few, sizing.unit.many);
                    return `Слишком большое значение: ожидалось, что ${issue.origin ?? "значение"} будет иметь ${adj}${issue.maximum.toString()} ${unit}`;
                }
                return `Слишком большое значение: ожидалось, что ${issue.origin ?? "значение"} будет ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    const minValue = Number(issue.minimum);
                    const unit = getRussianPlural(minValue, sizing.unit.one, sizing.unit.few, sizing.unit.many);
                    return `Слишком маленькое значение: ожидалось, что ${issue.origin} будет иметь ${adj}${issue.minimum.toString()} ${unit}`;
                }
                return `Слишком маленькое значение: ожидалось, что ${issue.origin} будет ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with")
                    return `Неверная строка: должна начинаться с "${_issue.prefix}"`;
                if (_issue.format === "ends_with")
                    return `Неверная строка: должна заканчиваться на "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `Неверная строка: должна содержать "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `Неверная строка: должна соответствовать шаблону ${_issue.pattern}`;
                return `Неверный ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Неверное число: должно быть кратным ${issue.divisor}`;
            case "unrecognized_keys":
                return `Нераспознанн${issue.keys.length > 1 ? "ые" : "ый"} ключ${issue.keys.length > 1 ? "и" : ""}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Неверный ключ в ${issue.origin}`;
            case "invalid_union":
                return "Неверные входные данные";
            case "invalid_element":
                return `Неверное значение в ${issue.origin}`;
            default:
                return `Неверные входные данные`;
        }
    };
};
/* harmony default export */ function ru() {
    return {
        localeError: ru_error(),
    };
}

;// ./node_modules/zod/v4/locales/sl.js

const sl_error = () => {
    const Sizable = {
        string: { unit: "znakov", verb: "imeti" },
        file: { unit: "bajtov", verb: "imeti" },
        array: { unit: "elementov", verb: "imeti" },
        set: { unit: "elementov", verb: "imeti" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "vnos",
        email: "e-poštni naslov",
        url: "URL",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO datum in čas",
        date: "ISO datum",
        time: "ISO čas",
        duration: "ISO trajanje",
        ipv4: "IPv4 naslov",
        ipv6: "IPv6 naslov",
        cidrv4: "obseg IPv4",
        cidrv6: "obseg IPv6",
        base64: "base64 kodiran niz",
        base64url: "base64url kodiran niz",
        json_string: "JSON niz",
        e164: "E.164 številka",
        jwt: "JWT",
        template_literal: "vnos",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "število",
        array: "tabela",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Neveljaven vnos: pričakovano instanceof ${issue.expected}, prejeto ${received}`;
                }
                return `Neveljaven vnos: pričakovano ${expected}, prejeto ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Neveljaven vnos: pričakovano ${util.stringifyPrimitive(issue.values[0])}`;
                return `Neveljavna možnost: pričakovano eno izmed ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `Preveliko: pričakovano, da bo ${issue.origin ?? "vrednost"} imelo ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elementov"}`;
                return `Preveliko: pričakovano, da bo ${issue.origin ?? "vrednost"} ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `Premajhno: pričakovano, da bo ${issue.origin} imelo ${adj}${issue.minimum.toString()} ${sizing.unit}`;
                }
                return `Premajhno: pričakovano, da bo ${issue.origin} ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with") {
                    return `Neveljaven niz: mora se začeti z "${_issue.prefix}"`;
                }
                if (_issue.format === "ends_with")
                    return `Neveljaven niz: mora se končati z "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `Neveljaven niz: mora vsebovati "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `Neveljaven niz: mora ustrezati vzorcu ${_issue.pattern}`;
                return `Neveljaven ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Neveljavno število: mora biti večkratnik ${issue.divisor}`;
            case "unrecognized_keys":
                return `Neprepoznan${issue.keys.length > 1 ? "i ključi" : " ključ"}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Neveljaven ključ v ${issue.origin}`;
            case "invalid_union":
                return "Neveljaven vnos";
            case "invalid_element":
                return `Neveljavna vrednost v ${issue.origin}`;
            default:
                return "Neveljaven vnos";
        }
    };
};
/* harmony default export */ function sl() {
    return {
        localeError: sl_error(),
    };
}

;// ./node_modules/zod/v4/locales/sv.js

const sv_error = () => {
    const Sizable = {
        string: { unit: "tecken", verb: "att ha" },
        file: { unit: "bytes", verb: "att ha" },
        array: { unit: "objekt", verb: "att innehålla" },
        set: { unit: "objekt", verb: "att innehålla" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "reguljärt uttryck",
        email: "e-postadress",
        url: "URL",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO-datum och tid",
        date: "ISO-datum",
        time: "ISO-tid",
        duration: "ISO-varaktighet",
        ipv4: "IPv4-intervall",
        ipv6: "IPv6-intervall",
        cidrv4: "IPv4-spektrum",
        cidrv6: "IPv6-spektrum",
        base64: "base64-kodad sträng",
        base64url: "base64url-kodad sträng",
        json_string: "JSON-sträng",
        e164: "E.164-nummer",
        jwt: "JWT",
        template_literal: "mall-literal",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "antal",
        array: "lista",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Ogiltig inmatning: förväntat instanceof ${issue.expected}, fick ${received}`;
                }
                return `Ogiltig inmatning: förväntat ${expected}, fick ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Ogiltig inmatning: förväntat ${util.stringifyPrimitive(issue.values[0])}`;
                return `Ogiltigt val: förväntade en av ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `För stor(t): förväntade ${issue.origin ?? "värdet"} att ha ${adj}${issue.maximum.toString()} ${sizing.unit ?? "element"}`;
                }
                return `För stor(t): förväntat ${issue.origin ?? "värdet"} att ha ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `För lite(t): förväntade ${issue.origin ?? "värdet"} att ha ${adj}${issue.minimum.toString()} ${sizing.unit}`;
                }
                return `För lite(t): förväntade ${issue.origin ?? "värdet"} att ha ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with") {
                    return `Ogiltig sträng: måste börja med "${_issue.prefix}"`;
                }
                if (_issue.format === "ends_with")
                    return `Ogiltig sträng: måste sluta med "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `Ogiltig sträng: måste innehålla "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `Ogiltig sträng: måste matcha mönstret "${_issue.pattern}"`;
                return `Ogiltig(t) ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Ogiltigt tal: måste vara en multipel av ${issue.divisor}`;
            case "unrecognized_keys":
                return `${issue.keys.length > 1 ? "Okända nycklar" : "Okänd nyckel"}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Ogiltig nyckel i ${issue.origin ?? "värdet"}`;
            case "invalid_union":
                return "Ogiltig input";
            case "invalid_element":
                return `Ogiltigt värde i ${issue.origin ?? "värdet"}`;
            default:
                return `Ogiltig input`;
        }
    };
};
/* harmony default export */ function sv() {
    return {
        localeError: sv_error(),
    };
}

;// ./node_modules/zod/v4/locales/ta.js

const ta_error = () => {
    const Sizable = {
        string: { unit: "எழுத்துக்கள்", verb: "கொண்டிருக்க வேண்டும்" },
        file: { unit: "பைட்டுகள்", verb: "கொண்டிருக்க வேண்டும்" },
        array: { unit: "உறுப்புகள்", verb: "கொண்டிருக்க வேண்டும்" },
        set: { unit: "உறுப்புகள்", verb: "கொண்டிருக்க வேண்டும்" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "உள்ளீடு",
        email: "மின்னஞ்சல் முகவரி",
        url: "URL",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO தேதி நேரம்",
        date: "ISO தேதி",
        time: "ISO நேரம்",
        duration: "ISO கால அளவு",
        ipv4: "IPv4 முகவரி",
        ipv6: "IPv6 முகவரி",
        cidrv4: "IPv4 வரம்பு",
        cidrv6: "IPv6 வரம்பு",
        base64: "base64-encoded சரம்",
        base64url: "base64url-encoded சரம்",
        json_string: "JSON சரம்",
        e164: "E.164 எண்",
        jwt: "JWT",
        template_literal: "input",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "எண்",
        array: "அணி",
        null: "வெறுமை",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `தவறான உள்ளீடு: எதிர்பார்க்கப்பட்டது instanceof ${issue.expected}, பெறப்பட்டது ${received}`;
                }
                return `தவறான உள்ளீடு: எதிர்பார்க்கப்பட்டது ${expected}, பெறப்பட்டது ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `தவறான உள்ளீடு: எதிர்பார்க்கப்பட்டது ${util.stringifyPrimitive(issue.values[0])}`;
                return `தவறான விருப்பம்: எதிர்பார்க்கப்பட்டது ${util.joinValues(issue.values, "|")} இல் ஒன்று`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `மிக பெரியது: எதிர்பார்க்கப்பட்டது ${issue.origin ?? "மதிப்பு"} ${adj}${issue.maximum.toString()} ${sizing.unit ?? "உறுப்புகள்"} ஆக இருக்க வேண்டும்`;
                }
                return `மிக பெரியது: எதிர்பார்க்கப்பட்டது ${issue.origin ?? "மதிப்பு"} ${adj}${issue.maximum.toString()} ஆக இருக்க வேண்டும்`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `மிகச் சிறியது: எதிர்பார்க்கப்பட்டது ${issue.origin} ${adj}${issue.minimum.toString()} ${sizing.unit} ஆக இருக்க வேண்டும்`; //
                }
                return `மிகச் சிறியது: எதிர்பார்க்கப்பட்டது ${issue.origin} ${adj}${issue.minimum.toString()} ஆக இருக்க வேண்டும்`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with")
                    return `தவறான சரம்: "${_issue.prefix}" இல் தொடங்க வேண்டும்`;
                if (_issue.format === "ends_with")
                    return `தவறான சரம்: "${_issue.suffix}" இல் முடிவடைய வேண்டும்`;
                if (_issue.format === "includes")
                    return `தவறான சரம்: "${_issue.includes}" ஐ உள்ளடக்க வேண்டும்`;
                if (_issue.format === "regex")
                    return `தவறான சரம்: ${_issue.pattern} முறைபாட்டுடன் பொருந்த வேண்டும்`;
                return `தவறான ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `தவறான எண்: ${issue.divisor} இன் பலமாக இருக்க வேண்டும்`;
            case "unrecognized_keys":
                return `அடையாளம் தெரியாத விசை${issue.keys.length > 1 ? "கள்" : ""}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `${issue.origin} இல் தவறான விசை`;
            case "invalid_union":
                return "தவறான உள்ளீடு";
            case "invalid_element":
                return `${issue.origin} இல் தவறான மதிப்பு`;
            default:
                return `தவறான உள்ளீடு`;
        }
    };
};
/* harmony default export */ function ta() {
    return {
        localeError: ta_error(),
    };
}

;// ./node_modules/zod/v4/locales/th.js

const th_error = () => {
    const Sizable = {
        string: { unit: "ตัวอักษร", verb: "ควรมี" },
        file: { unit: "ไบต์", verb: "ควรมี" },
        array: { unit: "รายการ", verb: "ควรมี" },
        set: { unit: "รายการ", verb: "ควรมี" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "ข้อมูลที่ป้อน",
        email: "ที่อยู่อีเมล",
        url: "URL",
        emoji: "อิโมจิ",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "วันที่เวลาแบบ ISO",
        date: "วันที่แบบ ISO",
        time: "เวลาแบบ ISO",
        duration: "ช่วงเวลาแบบ ISO",
        ipv4: "ที่อยู่ IPv4",
        ipv6: "ที่อยู่ IPv6",
        cidrv4: "ช่วง IP แบบ IPv4",
        cidrv6: "ช่วง IP แบบ IPv6",
        base64: "ข้อความแบบ Base64",
        base64url: "ข้อความแบบ Base64 สำหรับ URL",
        json_string: "ข้อความแบบ JSON",
        e164: "เบอร์โทรศัพท์ระหว่างประเทศ (E.164)",
        jwt: "โทเคน JWT",
        template_literal: "ข้อมูลที่ป้อน",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "ตัวเลข",
        array: "อาร์เรย์ (Array)",
        null: "ไม่มีค่า (null)",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `ประเภทข้อมูลไม่ถูกต้อง: ควรเป็น instanceof ${issue.expected} แต่ได้รับ ${received}`;
                }
                return `ประเภทข้อมูลไม่ถูกต้อง: ควรเป็น ${expected} แต่ได้รับ ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `ค่าไม่ถูกต้อง: ควรเป็น ${util.stringifyPrimitive(issue.values[0])}`;
                return `ตัวเลือกไม่ถูกต้อง: ควรเป็นหนึ่งใน ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "ไม่เกิน" : "น้อยกว่า";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `เกินกำหนด: ${issue.origin ?? "ค่า"} ควรมี${adj} ${issue.maximum.toString()} ${sizing.unit ?? "รายการ"}`;
                return `เกินกำหนด: ${issue.origin ?? "ค่า"} ควรมี${adj} ${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? "อย่างน้อย" : "มากกว่า";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `น้อยกว่ากำหนด: ${issue.origin} ควรมี${adj} ${issue.minimum.toString()} ${sizing.unit}`;
                }
                return `น้อยกว่ากำหนด: ${issue.origin} ควรมี${adj} ${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with") {
                    return `รูปแบบไม่ถูกต้อง: ข้อความต้องขึ้นต้นด้วย "${_issue.prefix}"`;
                }
                if (_issue.format === "ends_with")
                    return `รูปแบบไม่ถูกต้อง: ข้อความต้องลงท้ายด้วย "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `รูปแบบไม่ถูกต้อง: ข้อความต้องมี "${_issue.includes}" อยู่ในข้อความ`;
                if (_issue.format === "regex")
                    return `รูปแบบไม่ถูกต้อง: ต้องตรงกับรูปแบบที่กำหนด ${_issue.pattern}`;
                return `รูปแบบไม่ถูกต้อง: ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `ตัวเลขไม่ถูกต้อง: ต้องเป็นจำนวนที่หารด้วย ${issue.divisor} ได้ลงตัว`;
            case "unrecognized_keys":
                return `พบคีย์ที่ไม่รู้จัก: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `คีย์ไม่ถูกต้องใน ${issue.origin}`;
            case "invalid_union":
                return "ข้อมูลไม่ถูกต้อง: ไม่ตรงกับรูปแบบยูเนียนที่กำหนดไว้";
            case "invalid_element":
                return `ข้อมูลไม่ถูกต้องใน ${issue.origin}`;
            default:
                return `ข้อมูลไม่ถูกต้อง`;
        }
    };
};
/* harmony default export */ function th() {
    return {
        localeError: th_error(),
    };
}

;// ./node_modules/zod/v4/locales/tr.js

const tr_error = () => {
    const Sizable = {
        string: { unit: "karakter", verb: "olmalı" },
        file: { unit: "bayt", verb: "olmalı" },
        array: { unit: "öğe", verb: "olmalı" },
        set: { unit: "öğe", verb: "olmalı" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "girdi",
        email: "e-posta adresi",
        url: "URL",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO tarih ve saat",
        date: "ISO tarih",
        time: "ISO saat",
        duration: "ISO süre",
        ipv4: "IPv4 adresi",
        ipv6: "IPv6 adresi",
        cidrv4: "IPv4 aralığı",
        cidrv6: "IPv6 aralığı",
        base64: "base64 ile şifrelenmiş metin",
        base64url: "base64url ile şifrelenmiş metin",
        json_string: "JSON dizesi",
        e164: "E.164 sayısı",
        jwt: "JWT",
        template_literal: "Şablon dizesi",
    };
    const TypeDictionary = {
        nan: "NaN",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Geçersiz değer: beklenen instanceof ${issue.expected}, alınan ${received}`;
                }
                return `Geçersiz değer: beklenen ${expected}, alınan ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Geçersiz değer: beklenen ${util.stringifyPrimitive(issue.values[0])}`;
                return `Geçersiz seçenek: aşağıdakilerden biri olmalı: ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `Çok büyük: beklenen ${issue.origin ?? "değer"} ${adj}${issue.maximum.toString()} ${sizing.unit ?? "öğe"}`;
                return `Çok büyük: beklenen ${issue.origin ?? "değer"} ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `Çok küçük: beklenen ${issue.origin} ${adj}${issue.minimum.toString()} ${sizing.unit}`;
                return `Çok küçük: beklenen ${issue.origin} ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with")
                    return `Geçersiz metin: "${_issue.prefix}" ile başlamalı`;
                if (_issue.format === "ends_with")
                    return `Geçersiz metin: "${_issue.suffix}" ile bitmeli`;
                if (_issue.format === "includes")
                    return `Geçersiz metin: "${_issue.includes}" içermeli`;
                if (_issue.format === "regex")
                    return `Geçersiz metin: ${_issue.pattern} desenine uymalı`;
                return `Geçersiz ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Geçersiz sayı: ${issue.divisor} ile tam bölünebilmeli`;
            case "unrecognized_keys":
                return `Tanınmayan anahtar${issue.keys.length > 1 ? "lar" : ""}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `${issue.origin} içinde geçersiz anahtar`;
            case "invalid_union":
                return "Geçersiz değer";
            case "invalid_element":
                return `${issue.origin} içinde geçersiz değer`;
            default:
                return `Geçersiz değer`;
        }
    };
};
/* harmony default export */ function tr() {
    return {
        localeError: tr_error(),
    };
}

;// ./node_modules/zod/v4/locales/uk.js

const uk_error = () => {
    const Sizable = {
        string: { unit: "символів", verb: "матиме" },
        file: { unit: "байтів", verb: "матиме" },
        array: { unit: "елементів", verb: "матиме" },
        set: { unit: "елементів", verb: "матиме" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "вхідні дані",
        email: "адреса електронної пошти",
        url: "URL",
        emoji: "емодзі",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "дата та час ISO",
        date: "дата ISO",
        time: "час ISO",
        duration: "тривалість ISO",
        ipv4: "адреса IPv4",
        ipv6: "адреса IPv6",
        cidrv4: "діапазон IPv4",
        cidrv6: "діапазон IPv6",
        base64: "рядок у кодуванні base64",
        base64url: "рядок у кодуванні base64url",
        json_string: "рядок JSON",
        e164: "номер E.164",
        jwt: "JWT",
        template_literal: "вхідні дані",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "число",
        array: "масив",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Неправильні вхідні дані: очікується instanceof ${issue.expected}, отримано ${received}`;
                }
                return `Неправильні вхідні дані: очікується ${expected}, отримано ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Неправильні вхідні дані: очікується ${util.stringifyPrimitive(issue.values[0])}`;
                return `Неправильна опція: очікується одне з ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `Занадто велике: очікується, що ${issue.origin ?? "значення"} ${sizing.verb} ${adj}${issue.maximum.toString()} ${sizing.unit ?? "елементів"}`;
                return `Занадто велике: очікується, що ${issue.origin ?? "значення"} буде ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `Занадто мале: очікується, що ${issue.origin} ${sizing.verb} ${adj}${issue.minimum.toString()} ${sizing.unit}`;
                }
                return `Занадто мале: очікується, що ${issue.origin} буде ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with")
                    return `Неправильний рядок: повинен починатися з "${_issue.prefix}"`;
                if (_issue.format === "ends_with")
                    return `Неправильний рядок: повинен закінчуватися на "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `Неправильний рядок: повинен містити "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `Неправильний рядок: повинен відповідати шаблону ${_issue.pattern}`;
                return `Неправильний ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Неправильне число: повинно бути кратним ${issue.divisor}`;
            case "unrecognized_keys":
                return `Нерозпізнаний ключ${issue.keys.length > 1 ? "і" : ""}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Неправильний ключ у ${issue.origin}`;
            case "invalid_union":
                return "Неправильні вхідні дані";
            case "invalid_element":
                return `Неправильне значення у ${issue.origin}`;
            default:
                return `Неправильні вхідні дані`;
        }
    };
};
/* harmony default export */ function uk() {
    return {
        localeError: uk_error(),
    };
}

;// ./node_modules/zod/v4/locales/ua.js

/** @deprecated Use `uk` instead. */
/* harmony default export */ function ua() {
    return uk();
}

;// ./node_modules/zod/v4/locales/ur.js

const ur_error = () => {
    const Sizable = {
        string: { unit: "حروف", verb: "ہونا" },
        file: { unit: "بائٹس", verb: "ہونا" },
        array: { unit: "آئٹمز", verb: "ہونا" },
        set: { unit: "آئٹمز", verb: "ہونا" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "ان پٹ",
        email: "ای میل ایڈریس",
        url: "یو آر ایل",
        emoji: "ایموجی",
        uuid: "یو یو آئی ڈی",
        uuidv4: "یو یو آئی ڈی وی 4",
        uuidv6: "یو یو آئی ڈی وی 6",
        nanoid: "نینو آئی ڈی",
        guid: "جی یو آئی ڈی",
        cuid: "سی یو آئی ڈی",
        cuid2: "سی یو آئی ڈی 2",
        ulid: "یو ایل آئی ڈی",
        xid: "ایکس آئی ڈی",
        ksuid: "کے ایس یو آئی ڈی",
        datetime: "آئی ایس او ڈیٹ ٹائم",
        date: "آئی ایس او تاریخ",
        time: "آئی ایس او وقت",
        duration: "آئی ایس او مدت",
        ipv4: "آئی پی وی 4 ایڈریس",
        ipv6: "آئی پی وی 6 ایڈریس",
        cidrv4: "آئی پی وی 4 رینج",
        cidrv6: "آئی پی وی 6 رینج",
        base64: "بیس 64 ان کوڈڈ سٹرنگ",
        base64url: "بیس 64 یو آر ایل ان کوڈڈ سٹرنگ",
        json_string: "جے ایس او این سٹرنگ",
        e164: "ای 164 نمبر",
        jwt: "جے ڈبلیو ٹی",
        template_literal: "ان پٹ",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "نمبر",
        array: "آرے",
        null: "نل",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `غلط ان پٹ: instanceof ${issue.expected} متوقع تھا، ${received} موصول ہوا`;
                }
                return `غلط ان پٹ: ${expected} متوقع تھا، ${received} موصول ہوا`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `غلط ان پٹ: ${util.stringifyPrimitive(issue.values[0])} متوقع تھا`;
                return `غلط آپشن: ${util.joinValues(issue.values, "|")} میں سے ایک متوقع تھا`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `بہت بڑا: ${issue.origin ?? "ویلیو"} کے ${adj}${issue.maximum.toString()} ${sizing.unit ?? "عناصر"} ہونے متوقع تھے`;
                return `بہت بڑا: ${issue.origin ?? "ویلیو"} کا ${adj}${issue.maximum.toString()} ہونا متوقع تھا`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `بہت چھوٹا: ${issue.origin} کے ${adj}${issue.minimum.toString()} ${sizing.unit} ہونے متوقع تھے`;
                }
                return `بہت چھوٹا: ${issue.origin} کا ${adj}${issue.minimum.toString()} ہونا متوقع تھا`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with") {
                    return `غلط سٹرنگ: "${_issue.prefix}" سے شروع ہونا چاہیے`;
                }
                if (_issue.format === "ends_with")
                    return `غلط سٹرنگ: "${_issue.suffix}" پر ختم ہونا چاہیے`;
                if (_issue.format === "includes")
                    return `غلط سٹرنگ: "${_issue.includes}" شامل ہونا چاہیے`;
                if (_issue.format === "regex")
                    return `غلط سٹرنگ: پیٹرن ${_issue.pattern} سے میچ ہونا چاہیے`;
                return `غلط ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `غلط نمبر: ${issue.divisor} کا مضاعف ہونا چاہیے`;
            case "unrecognized_keys":
                return `غیر تسلیم شدہ کی${issue.keys.length > 1 ? "ز" : ""}: ${util.joinValues(issue.keys, "، ")}`;
            case "invalid_key":
                return `${issue.origin} میں غلط کی`;
            case "invalid_union":
                return "غلط ان پٹ";
            case "invalid_element":
                return `${issue.origin} میں غلط ویلیو`;
            default:
                return `غلط ان پٹ`;
        }
    };
};
/* harmony default export */ function ur() {
    return {
        localeError: ur_error(),
    };
}

;// ./node_modules/zod/v4/locales/uz.js

const uz_error = () => {
    const Sizable = {
        string: { unit: "belgi", verb: "bo‘lishi kerak" },
        file: { unit: "bayt", verb: "bo‘lishi kerak" },
        array: { unit: "element", verb: "bo‘lishi kerak" },
        set: { unit: "element", verb: "bo‘lishi kerak" },
        map: { unit: "yozuv", verb: "bo‘lishi kerak" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "kirish",
        email: "elektron pochta manzili",
        url: "URL",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO sana va vaqti",
        date: "ISO sana",
        time: "ISO vaqt",
        duration: "ISO davomiylik",
        ipv4: "IPv4 manzil",
        ipv6: "IPv6 manzil",
        mac: "MAC manzil",
        cidrv4: "IPv4 diapazon",
        cidrv6: "IPv6 diapazon",
        base64: "base64 kodlangan satr",
        base64url: "base64url kodlangan satr",
        json_string: "JSON satr",
        e164: "E.164 raqam",
        jwt: "JWT",
        template_literal: "kirish",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "raqam",
        array: "massiv",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Noto‘g‘ri kirish: kutilgan instanceof ${issue.expected}, qabul qilingan ${received}`;
                }
                return `Noto‘g‘ri kirish: kutilgan ${expected}, qabul qilingan ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Noto‘g‘ri kirish: kutilgan ${util.stringifyPrimitive(issue.values[0])}`;
                return `Noto‘g‘ri variant: quyidagilardan biri kutilgan ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `Juda katta: kutilgan ${issue.origin ?? "qiymat"} ${adj}${issue.maximum.toString()} ${sizing.unit} ${sizing.verb}`;
                return `Juda katta: kutilgan ${issue.origin ?? "qiymat"} ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `Juda kichik: kutilgan ${issue.origin} ${adj}${issue.minimum.toString()} ${sizing.unit} ${sizing.verb}`;
                }
                return `Juda kichik: kutilgan ${issue.origin} ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with")
                    return `Noto‘g‘ri satr: "${_issue.prefix}" bilan boshlanishi kerak`;
                if (_issue.format === "ends_with")
                    return `Noto‘g‘ri satr: "${_issue.suffix}" bilan tugashi kerak`;
                if (_issue.format === "includes")
                    return `Noto‘g‘ri satr: "${_issue.includes}" ni o‘z ichiga olishi kerak`;
                if (_issue.format === "regex")
                    return `Noto‘g‘ri satr: ${_issue.pattern} shabloniga mos kelishi kerak`;
                return `Noto‘g‘ri ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Noto‘g‘ri raqam: ${issue.divisor} ning karralisi bo‘lishi kerak`;
            case "unrecognized_keys":
                return `Noma’lum kalit${issue.keys.length > 1 ? "lar" : ""}: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `${issue.origin} dagi kalit noto‘g‘ri`;
            case "invalid_union":
                return "Noto‘g‘ri kirish";
            case "invalid_element":
                return `${issue.origin} da noto‘g‘ri qiymat`;
            default:
                return `Noto‘g‘ri kirish`;
        }
    };
};
/* harmony default export */ function uz() {
    return {
        localeError: uz_error(),
    };
}

;// ./node_modules/zod/v4/locales/vi.js

const vi_error = () => {
    const Sizable = {
        string: { unit: "ký tự", verb: "có" },
        file: { unit: "byte", verb: "có" },
        array: { unit: "phần tử", verb: "có" },
        set: { unit: "phần tử", verb: "có" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "đầu vào",
        email: "địa chỉ email",
        url: "URL",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ngày giờ ISO",
        date: "ngày ISO",
        time: "giờ ISO",
        duration: "khoảng thời gian ISO",
        ipv4: "địa chỉ IPv4",
        ipv6: "địa chỉ IPv6",
        cidrv4: "dải IPv4",
        cidrv6: "dải IPv6",
        base64: "chuỗi mã hóa base64",
        base64url: "chuỗi mã hóa base64url",
        json_string: "chuỗi JSON",
        e164: "số E.164",
        jwt: "JWT",
        template_literal: "đầu vào",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "số",
        array: "mảng",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Đầu vào không hợp lệ: mong đợi instanceof ${issue.expected}, nhận được ${received}`;
                }
                return `Đầu vào không hợp lệ: mong đợi ${expected}, nhận được ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Đầu vào không hợp lệ: mong đợi ${util.stringifyPrimitive(issue.values[0])}`;
                return `Tùy chọn không hợp lệ: mong đợi một trong các giá trị ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `Quá lớn: mong đợi ${issue.origin ?? "giá trị"} ${sizing.verb} ${adj}${issue.maximum.toString()} ${sizing.unit ?? "phần tử"}`;
                return `Quá lớn: mong đợi ${issue.origin ?? "giá trị"} ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `Quá nhỏ: mong đợi ${issue.origin} ${sizing.verb} ${adj}${issue.minimum.toString()} ${sizing.unit}`;
                }
                return `Quá nhỏ: mong đợi ${issue.origin} ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with")
                    return `Chuỗi không hợp lệ: phải bắt đầu bằng "${_issue.prefix}"`;
                if (_issue.format === "ends_with")
                    return `Chuỗi không hợp lệ: phải kết thúc bằng "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `Chuỗi không hợp lệ: phải bao gồm "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `Chuỗi không hợp lệ: phải khớp với mẫu ${_issue.pattern}`;
                return `${FormatDictionary[_issue.format] ?? issue.format} không hợp lệ`;
            }
            case "not_multiple_of":
                return `Số không hợp lệ: phải là bội số của ${issue.divisor}`;
            case "unrecognized_keys":
                return `Khóa không được nhận dạng: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Khóa không hợp lệ trong ${issue.origin}`;
            case "invalid_union":
                return "Đầu vào không hợp lệ";
            case "invalid_element":
                return `Giá trị không hợp lệ trong ${issue.origin}`;
            default:
                return `Đầu vào không hợp lệ`;
        }
    };
};
/* harmony default export */ function vi() {
    return {
        localeError: vi_error(),
    };
}

;// ./node_modules/zod/v4/locales/zh-CN.js

const zh_CN_error = () => {
    const Sizable = {
        string: { unit: "字符", verb: "包含" },
        file: { unit: "字节", verb: "包含" },
        array: { unit: "项", verb: "包含" },
        set: { unit: "项", verb: "包含" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "输入",
        email: "电子邮件",
        url: "URL",
        emoji: "表情符号",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO日期时间",
        date: "ISO日期",
        time: "ISO时间",
        duration: "ISO时长",
        ipv4: "IPv4地址",
        ipv6: "IPv6地址",
        cidrv4: "IPv4网段",
        cidrv6: "IPv6网段",
        base64: "base64编码字符串",
        base64url: "base64url编码字符串",
        json_string: "JSON字符串",
        e164: "E.164号码",
        jwt: "JWT",
        template_literal: "输入",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "数字",
        array: "数组",
        null: "空值(null)",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `无效输入：期望 instanceof ${issue.expected}，实际接收 ${received}`;
                }
                return `无效输入：期望 ${expected}，实际接收 ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `无效输入：期望 ${util.stringifyPrimitive(issue.values[0])}`;
                return `无效选项：期望以下之一 ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `数值过大：期望 ${issue.origin ?? "值"} ${adj}${issue.maximum.toString()} ${sizing.unit ?? "个元素"}`;
                return `数值过大：期望 ${issue.origin ?? "值"} ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `数值过小：期望 ${issue.origin} ${adj}${issue.minimum.toString()} ${sizing.unit}`;
                }
                return `数值过小：期望 ${issue.origin} ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with")
                    return `无效字符串：必须以 "${_issue.prefix}" 开头`;
                if (_issue.format === "ends_with")
                    return `无效字符串：必须以 "${_issue.suffix}" 结尾`;
                if (_issue.format === "includes")
                    return `无效字符串：必须包含 "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `无效字符串：必须满足正则表达式 ${_issue.pattern}`;
                return `无效${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `无效数字：必须是 ${issue.divisor} 的倍数`;
            case "unrecognized_keys":
                return `出现未知的键(key): ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `${issue.origin} 中的键(key)无效`;
            case "invalid_union":
                return "无效输入";
            case "invalid_element":
                return `${issue.origin} 中包含无效值(value)`;
            default:
                return `无效输入`;
        }
    };
};
/* harmony default export */ function zh_CN() {
    return {
        localeError: zh_CN_error(),
    };
}

;// ./node_modules/zod/v4/locales/zh-TW.js

const zh_TW_error = () => {
    const Sizable = {
        string: { unit: "字元", verb: "擁有" },
        file: { unit: "位元組", verb: "擁有" },
        array: { unit: "項目", verb: "擁有" },
        set: { unit: "項目", verb: "擁有" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "輸入",
        email: "郵件地址",
        url: "URL",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "ISO 日期時間",
        date: "ISO 日期",
        time: "ISO 時間",
        duration: "ISO 期間",
        ipv4: "IPv4 位址",
        ipv6: "IPv6 位址",
        cidrv4: "IPv4 範圍",
        cidrv6: "IPv6 範圍",
        base64: "base64 編碼字串",
        base64url: "base64url 編碼字串",
        json_string: "JSON 字串",
        e164: "E.164 數值",
        jwt: "JWT",
        template_literal: "輸入",
    };
    const TypeDictionary = {
        nan: "NaN",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `無效的輸入值：預期為 instanceof ${issue.expected}，但收到 ${received}`;
                }
                return `無效的輸入值：預期為 ${expected}，但收到 ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `無效的輸入值：預期為 ${util.stringifyPrimitive(issue.values[0])}`;
                return `無效的選項：預期為以下其中之一 ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `數值過大：預期 ${issue.origin ?? "值"} 應為 ${adj}${issue.maximum.toString()} ${sizing.unit ?? "個元素"}`;
                return `數值過大：預期 ${issue.origin ?? "值"} 應為 ${adj}${issue.maximum.toString()}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing) {
                    return `數值過小：預期 ${issue.origin} 應為 ${adj}${issue.minimum.toString()} ${sizing.unit}`;
                }
                return `數值過小：預期 ${issue.origin} 應為 ${adj}${issue.minimum.toString()}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with") {
                    return `無效的字串：必須以 "${_issue.prefix}" 開頭`;
                }
                if (_issue.format === "ends_with")
                    return `無效的字串：必須以 "${_issue.suffix}" 結尾`;
                if (_issue.format === "includes")
                    return `無效的字串：必須包含 "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `無效的字串：必須符合格式 ${_issue.pattern}`;
                return `無效的 ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `無效的數字：必須為 ${issue.divisor} 的倍數`;
            case "unrecognized_keys":
                return `無法識別的鍵值${issue.keys.length > 1 ? "們" : ""}：${util.joinValues(issue.keys, "、")}`;
            case "invalid_key":
                return `${issue.origin} 中有無效的鍵值`;
            case "invalid_union":
                return "無效的輸入值";
            case "invalid_element":
                return `${issue.origin} 中有無效的值`;
            default:
                return `無效的輸入值`;
        }
    };
};
/* harmony default export */ function zh_TW() {
    return {
        localeError: zh_TW_error(),
    };
}

;// ./node_modules/zod/v4/locales/yo.js

const yo_error = () => {
    const Sizable = {
        string: { unit: "àmi", verb: "ní" },
        file: { unit: "bytes", verb: "ní" },
        array: { unit: "nkan", verb: "ní" },
        set: { unit: "nkan", verb: "ní" },
    };
    function getSizing(origin) {
        return Sizable[origin] ?? null;
    }
    const FormatDictionary = {
        regex: "ẹ̀rọ ìbáwọlé",
        email: "àdírẹ́sì ìmẹ́lì",
        url: "URL",
        emoji: "emoji",
        uuid: "UUID",
        uuidv4: "UUIDv4",
        uuidv6: "UUIDv6",
        nanoid: "nanoid",
        guid: "GUID",
        cuid: "cuid",
        cuid2: "cuid2",
        ulid: "ULID",
        xid: "XID",
        ksuid: "KSUID",
        datetime: "àkókò ISO",
        date: "ọjọ́ ISO",
        time: "àkókò ISO",
        duration: "àkókò tó pé ISO",
        ipv4: "àdírẹ́sì IPv4",
        ipv6: "àdírẹ́sì IPv6",
        cidrv4: "àgbègbè IPv4",
        cidrv6: "àgbègbè IPv6",
        base64: "ọ̀rọ̀ tí a kọ́ ní base64",
        base64url: "ọ̀rọ̀ base64url",
        json_string: "ọ̀rọ̀ JSON",
        e164: "nọ́mbà E.164",
        jwt: "JWT",
        template_literal: "ẹ̀rọ ìbáwọlé",
    };
    const TypeDictionary = {
        nan: "NaN",
        number: "nọ́mbà",
        array: "akopọ",
    };
    return (issue) => {
        switch (issue.code) {
            case "invalid_type": {
                const expected = TypeDictionary[issue.expected] ?? issue.expected;
                const receivedType = util.parsedType(issue.input);
                const received = TypeDictionary[receivedType] ?? receivedType;
                if (/^[A-Z]/.test(issue.expected)) {
                    return `Ìbáwọlé aṣìṣe: a ní láti fi instanceof ${issue.expected}, àmọ̀ a rí ${received}`;
                }
                return `Ìbáwọlé aṣìṣe: a ní láti fi ${expected}, àmọ̀ a rí ${received}`;
            }
            case "invalid_value":
                if (issue.values.length === 1)
                    return `Ìbáwọlé aṣìṣe: a ní láti fi ${util.stringifyPrimitive(issue.values[0])}`;
                return `Àṣàyàn aṣìṣe: yan ọ̀kan lára ${util.joinValues(issue.values, "|")}`;
            case "too_big": {
                const adj = issue.inclusive ? "<=" : "<";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `Tó pọ̀ jù: a ní láti jẹ́ pé ${issue.origin ?? "iye"} ${sizing.verb} ${adj}${issue.maximum} ${sizing.unit}`;
                return `Tó pọ̀ jù: a ní láti jẹ́ ${adj}${issue.maximum}`;
            }
            case "too_small": {
                const adj = issue.inclusive ? ">=" : ">";
                const sizing = getSizing(issue.origin);
                if (sizing)
                    return `Kéré ju: a ní láti jẹ́ pé ${issue.origin} ${sizing.verb} ${adj}${issue.minimum} ${sizing.unit}`;
                return `Kéré ju: a ní láti jẹ́ ${adj}${issue.minimum}`;
            }
            case "invalid_format": {
                const _issue = issue;
                if (_issue.format === "starts_with")
                    return `Ọ̀rọ̀ aṣìṣe: gbọ́dọ̀ bẹ̀rẹ̀ pẹ̀lú "${_issue.prefix}"`;
                if (_issue.format === "ends_with")
                    return `Ọ̀rọ̀ aṣìṣe: gbọ́dọ̀ parí pẹ̀lú "${_issue.suffix}"`;
                if (_issue.format === "includes")
                    return `Ọ̀rọ̀ aṣìṣe: gbọ́dọ̀ ní "${_issue.includes}"`;
                if (_issue.format === "regex")
                    return `Ọ̀rọ̀ aṣìṣe: gbọ́dọ̀ bá àpẹẹrẹ mu ${_issue.pattern}`;
                return `Aṣìṣe: ${FormatDictionary[_issue.format] ?? issue.format}`;
            }
            case "not_multiple_of":
                return `Nọ́mbà aṣìṣe: gbọ́dọ̀ jẹ́ èyà pípín ti ${issue.divisor}`;
            case "unrecognized_keys":
                return `Bọtìnì àìmọ̀: ${util.joinValues(issue.keys, ", ")}`;
            case "invalid_key":
                return `Bọtìnì aṣìṣe nínú ${issue.origin}`;
            case "invalid_union":
                return "Ìbáwọlé aṣìṣe";
            case "invalid_element":
                return `Iye aṣìṣe nínú ${issue.origin}`;
            default:
                return "Ìbáwọlé aṣìṣe";
        }
    };
};
/* harmony default export */ function yo() {
    return {
        localeError: yo_error(),
    };
}

;// ./node_modules/zod/v4/locales/index.js





















































// EXTERNAL MODULE: ./node_modules/zod/v4/core/registries.js
var registries = __webpack_require__(3795);
// EXTERNAL MODULE: ./node_modules/zod/v4/core/doc.js
var doc = __webpack_require__(8424);
// EXTERNAL MODULE: ./node_modules/zod/v4/core/api.js
var api = __webpack_require__(638);
// EXTERNAL MODULE: ./node_modules/zod/v4/core/to-json-schema.js
var to_json_schema = __webpack_require__(9958);
// EXTERNAL MODULE: ./node_modules/zod/v4/core/json-schema-processors.js
var json_schema_processors = __webpack_require__(4836);
;// ./node_modules/zod/v4/core/json-schema-generator.js


/**
 * Legacy class-based interface for JSON Schema generation.
 * This class wraps the new functional implementation to provide backward compatibility.
 *
 * @deprecated Use the `toJSONSchema` function instead for new code.
 *
 * @example
 * ```typescript
 * // Legacy usage (still supported)
 * const gen = new JSONSchemaGenerator({ target: "draft-07" });
 * gen.process(schema);
 * const result = gen.emit(schema);
 *
 * // Preferred modern usage
 * const result = toJSONSchema(schema, { target: "draft-07" });
 * ```
 */
class JSONSchemaGenerator {
    /** @deprecated Access via ctx instead */
    get metadataRegistry() {
        return this.ctx.metadataRegistry;
    }
    /** @deprecated Access via ctx instead */
    get target() {
        return this.ctx.target;
    }
    /** @deprecated Access via ctx instead */
    get unrepresentable() {
        return this.ctx.unrepresentable;
    }
    /** @deprecated Access via ctx instead */
    get override() {
        return this.ctx.override;
    }
    /** @deprecated Access via ctx instead */
    get io() {
        return this.ctx.io;
    }
    /** @deprecated Access via ctx instead */
    get counter() {
        return this.ctx.counter;
    }
    set counter(value) {
        this.ctx.counter = value;
    }
    /** @deprecated Access via ctx instead */
    get seen() {
        return this.ctx.seen;
    }
    constructor(params) {
        // Normalize target for internal context
        let normalizedTarget = params?.target ?? "draft-2020-12";
        if (normalizedTarget === "draft-4")
            normalizedTarget = "draft-04";
        if (normalizedTarget === "draft-7")
            normalizedTarget = "draft-07";
        this.ctx = (0,to_json_schema/* initializeContext */.az)({
            processors: json_schema_processors/* allProcessors */.Df,
            target: normalizedTarget,
            ...(params?.metadata && { metadata: params.metadata }),
            ...(params?.unrepresentable && { unrepresentable: params.unrepresentable }),
            ...(params?.override && { override: params.override }),
            ...(params?.io && { io: params.io }),
        });
    }
    /**
     * Process a schema to prepare it for JSON Schema generation.
     * This must be called before emit().
     */
    process(schema, _params = { path: [], schemaPath: [] }) {
        return (0,to_json_schema/* process */.eh)(schema, this.ctx, _params);
    }
    /**
     * Emit the final JSON Schema after processing.
     * Must call process() first.
     */
    emit(schema, _params) {
        // Apply emit params to the context
        if (_params) {
            if (_params.cycles)
                this.ctx.cycles = _params.cycles;
            if (_params.reused)
                this.ctx.reused = _params.reused;
            if (_params.external)
                this.ctx.external = _params.external;
        }
        (0,to_json_schema/* extractDefs */.Wb)(this.ctx, schema);
        const result = (0,to_json_schema/* finalize */.jE)(this.ctx, schema);
        // Strip ~standard property to match old implementation's return type
        const { "~standard": _, ...plainResult } = result;
        return plainResult;
    }
}

;// ./node_modules/zod/v4/core/json-schema.js


;// ./node_modules/zod/v4/core/index.js

















// EXTERNAL MODULE: ./node_modules/zod/v4/classic/schemas.js
var classic_schemas = __webpack_require__(6687);
;// ./node_modules/zod/v4/classic/checks.js


// EXTERNAL MODULE: ./node_modules/zod/v4/classic/errors.js
var classic_errors = __webpack_require__(7356);
// EXTERNAL MODULE: ./node_modules/zod/v4/classic/parse.js
var classic_parse = __webpack_require__(5852);
;// ./node_modules/zod/v4/classic/compat.js
// Zod 3 compat layer

/** @deprecated Use the raw string literal codes instead, e.g. "invalid_type". */
const ZodIssueCode = {
    invalid_type: "invalid_type",
    too_big: "too_big",
    too_small: "too_small",
    invalid_format: "invalid_format",
    not_multiple_of: "not_multiple_of",
    unrecognized_keys: "unrecognized_keys",
    invalid_union: "invalid_union",
    invalid_key: "invalid_key",
    invalid_element: "invalid_element",
    invalid_value: "invalid_value",
    custom: "custom",
};

/** @deprecated Use `z.config(params)` instead. */
function setErrorMap(map) {
    core/* config */.$W({
        customError: map,
    });
}
/** @deprecated Use `z.config()` instead. */
function getErrorMap() {
    return core/* config */.$W().customError;
}
/** @deprecated Do not use. Stub definition, only included for zod-to-json-schema compatibility. */
var ZodFirstPartyTypeKind;
(function (ZodFirstPartyTypeKind) {
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));

// EXTERNAL MODULE: ./node_modules/zod/v4/classic/iso.js
var iso = __webpack_require__(3174);
;// ./node_modules/zod/v4/classic/from-json-schema.js




// Local z object to avoid circular dependency with ../index.js
const z = {
    ...classic_schemas,
    ...checks_namespaceObject,
    iso: iso,
};
// Keys that are recognized and handled by the conversion logic
const RECOGNIZED_KEYS = /*@__PURE__*/ new Set([
    // Schema identification
    "$schema",
    "$ref",
    "$defs",
    "definitions",
    // Core schema keywords
    "$id",
    "id",
    "$comment",
    "$anchor",
    "$vocabulary",
    "$dynamicRef",
    "$dynamicAnchor",
    // Type
    "type",
    "enum",
    "const",
    // Composition
    "anyOf",
    "oneOf",
    "allOf",
    "not",
    // Object
    "properties",
    "required",
    "additionalProperties",
    "patternProperties",
    "propertyNames",
    "minProperties",
    "maxProperties",
    // Array
    "items",
    "prefixItems",
    "additionalItems",
    "minItems",
    "maxItems",
    "uniqueItems",
    "contains",
    "minContains",
    "maxContains",
    // String
    "minLength",
    "maxLength",
    "pattern",
    "format",
    // Number
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    // Already handled metadata
    "description",
    "default",
    // Content
    "contentEncoding",
    "contentMediaType",
    "contentSchema",
    // Unsupported (error-throwing)
    "unevaluatedItems",
    "unevaluatedProperties",
    "if",
    "then",
    "else",
    "dependentSchemas",
    "dependentRequired",
    // OpenAPI
    "nullable",
    "readOnly",
]);
function detectVersion(schema, defaultTarget) {
    const $schema = schema.$schema;
    if ($schema === "https://json-schema.org/draft/2020-12/schema") {
        return "draft-2020-12";
    }
    if ($schema === "http://json-schema.org/draft-07/schema#") {
        return "draft-7";
    }
    if ($schema === "http://json-schema.org/draft-04/schema#") {
        return "draft-4";
    }
    // Use defaultTarget if provided, otherwise default to draft-2020-12
    return defaultTarget ?? "draft-2020-12";
}
function resolveRef(ref, ctx) {
    if (!ref.startsWith("#")) {
        throw new Error("External $ref is not supported, only local refs (#/...) are allowed");
    }
    const path = ref.slice(1).split("/").filter(Boolean);
    // Handle root reference "#"
    if (path.length === 0) {
        return ctx.rootSchema;
    }
    const defsKey = ctx.version === "draft-2020-12" ? "$defs" : "definitions";
    if (path[0] === defsKey) {
        const key = path[1];
        if (!key || !ctx.defs[key]) {
            throw new Error(`Reference not found: ${ref}`);
        }
        return ctx.defs[key];
    }
    throw new Error(`Reference not found: ${ref}`);
}
function convertBaseSchema(schema, ctx) {
    // Handle unsupported features
    if (schema.not !== undefined) {
        // Special case: { not: {} } represents never
        if (typeof schema.not === "object" && Object.keys(schema.not).length === 0) {
            return z.never();
        }
        throw new Error("not is not supported in Zod (except { not: {} } for never)");
    }
    if (schema.unevaluatedItems !== undefined) {
        throw new Error("unevaluatedItems is not supported");
    }
    if (schema.unevaluatedProperties !== undefined) {
        throw new Error("unevaluatedProperties is not supported");
    }
    if (schema.if !== undefined || schema.then !== undefined || schema.else !== undefined) {
        throw new Error("Conditional schemas (if/then/else) are not supported");
    }
    if (schema.dependentSchemas !== undefined || schema.dependentRequired !== undefined) {
        throw new Error("dependentSchemas and dependentRequired are not supported");
    }
    // Handle $ref
    if (schema.$ref) {
        const refPath = schema.$ref;
        if (ctx.refs.has(refPath)) {
            return ctx.refs.get(refPath);
        }
        if (ctx.processing.has(refPath)) {
            // Circular reference - use lazy
            return z.lazy(() => {
                if (!ctx.refs.has(refPath)) {
                    throw new Error(`Circular reference not resolved: ${refPath}`);
                }
                return ctx.refs.get(refPath);
            });
        }
        ctx.processing.add(refPath);
        const resolved = resolveRef(refPath, ctx);
        const zodSchema = convertSchema(resolved, ctx);
        ctx.refs.set(refPath, zodSchema);
        ctx.processing.delete(refPath);
        return zodSchema;
    }
    // Handle enum
    if (schema.enum !== undefined) {
        const enumValues = schema.enum;
        // Special case: OpenAPI 3.0 null representation { type: "string", nullable: true, enum: [null] }
        if (ctx.version === "openapi-3.0" &&
            schema.nullable === true &&
            enumValues.length === 1 &&
            enumValues[0] === null) {
            return z.null();
        }
        if (enumValues.length === 0) {
            return z.never();
        }
        if (enumValues.length === 1) {
            return z.literal(enumValues[0]);
        }
        // Check if all values are strings
        if (enumValues.every((v) => typeof v === "string")) {
            return z.enum(enumValues);
        }
        // Mixed types - use union of literals
        const literalSchemas = enumValues.map((v) => z.literal(v));
        if (literalSchemas.length < 2) {
            return literalSchemas[0];
        }
        return z.union([literalSchemas[0], literalSchemas[1], ...literalSchemas.slice(2)]);
    }
    // Handle const
    if (schema.const !== undefined) {
        return z.literal(schema.const);
    }
    // Handle type
    const type = schema.type;
    if (Array.isArray(type)) {
        // Expand type array into anyOf union
        const typeSchemas = type.map((t) => {
            const typeSchema = { ...schema, type: t };
            return convertBaseSchema(typeSchema, ctx);
        });
        if (typeSchemas.length === 0) {
            return z.never();
        }
        if (typeSchemas.length === 1) {
            return typeSchemas[0];
        }
        return z.union(typeSchemas);
    }
    if (!type) {
        // No type specified - empty schema (any)
        return z.any();
    }
    let zodSchema;
    switch (type) {
        case "string": {
            let stringSchema = z.string();
            // Apply format using .check() with Zod format functions
            if (schema.format) {
                const format = schema.format;
                // Map common formats to Zod check functions
                if (format === "email") {
                    stringSchema = stringSchema.check(z.email());
                }
                else if (format === "uri" || format === "uri-reference") {
                    stringSchema = stringSchema.check(z.url());
                }
                else if (format === "uuid" || format === "guid") {
                    stringSchema = stringSchema.check(z.uuid());
                }
                else if (format === "date-time") {
                    stringSchema = stringSchema.check(z.iso.datetime());
                }
                else if (format === "date") {
                    stringSchema = stringSchema.check(z.iso.date());
                }
                else if (format === "time") {
                    stringSchema = stringSchema.check(z.iso.time());
                }
                else if (format === "duration") {
                    stringSchema = stringSchema.check(z.iso.duration());
                }
                else if (format === "ipv4") {
                    stringSchema = stringSchema.check(z.ipv4());
                }
                else if (format === "ipv6") {
                    stringSchema = stringSchema.check(z.ipv6());
                }
                else if (format === "mac") {
                    stringSchema = stringSchema.check(z.mac());
                }
                else if (format === "cidr") {
                    stringSchema = stringSchema.check(z.cidrv4());
                }
                else if (format === "cidr-v6") {
                    stringSchema = stringSchema.check(z.cidrv6());
                }
                else if (format === "base64") {
                    stringSchema = stringSchema.check(z.base64());
                }
                else if (format === "base64url") {
                    stringSchema = stringSchema.check(z.base64url());
                }
                else if (format === "e164") {
                    stringSchema = stringSchema.check(z.e164());
                }
                else if (format === "jwt") {
                    stringSchema = stringSchema.check(z.jwt());
                }
                else if (format === "emoji") {
                    stringSchema = stringSchema.check(z.emoji());
                }
                else if (format === "nanoid") {
                    stringSchema = stringSchema.check(z.nanoid());
                }
                else if (format === "cuid") {
                    stringSchema = stringSchema.check(z.cuid());
                }
                else if (format === "cuid2") {
                    stringSchema = stringSchema.check(z.cuid2());
                }
                else if (format === "ulid") {
                    stringSchema = stringSchema.check(z.ulid());
                }
                else if (format === "xid") {
                    stringSchema = stringSchema.check(z.xid());
                }
                else if (format === "ksuid") {
                    stringSchema = stringSchema.check(z.ksuid());
                }
                // Note: json-string format is not currently supported by Zod
                // Custom formats are ignored - keep as plain string
            }
            // Apply constraints
            if (typeof schema.minLength === "number") {
                stringSchema = stringSchema.min(schema.minLength);
            }
            if (typeof schema.maxLength === "number") {
                stringSchema = stringSchema.max(schema.maxLength);
            }
            if (schema.pattern) {
                // JSON Schema patterns are not implicitly anchored (match anywhere in string)
                stringSchema = stringSchema.regex(new RegExp(schema.pattern));
            }
            zodSchema = stringSchema;
            break;
        }
        case "number":
        case "integer": {
            let numberSchema = type === "integer" ? z.number().int() : z.number();
            // Apply constraints
            if (typeof schema.minimum === "number") {
                numberSchema = numberSchema.min(schema.minimum);
            }
            if (typeof schema.maximum === "number") {
                numberSchema = numberSchema.max(schema.maximum);
            }
            if (typeof schema.exclusiveMinimum === "number") {
                numberSchema = numberSchema.gt(schema.exclusiveMinimum);
            }
            else if (schema.exclusiveMinimum === true && typeof schema.minimum === "number") {
                numberSchema = numberSchema.gt(schema.minimum);
            }
            if (typeof schema.exclusiveMaximum === "number") {
                numberSchema = numberSchema.lt(schema.exclusiveMaximum);
            }
            else if (schema.exclusiveMaximum === true && typeof schema.maximum === "number") {
                numberSchema = numberSchema.lt(schema.maximum);
            }
            if (typeof schema.multipleOf === "number") {
                numberSchema = numberSchema.multipleOf(schema.multipleOf);
            }
            zodSchema = numberSchema;
            break;
        }
        case "boolean": {
            zodSchema = z.boolean();
            break;
        }
        case "null": {
            zodSchema = z.null();
            break;
        }
        case "object": {
            const shape = {};
            const properties = schema.properties || {};
            const requiredSet = new Set(schema.required || []);
            // Convert properties - mark optional ones
            for (const [key, propSchema] of Object.entries(properties)) {
                const propZodSchema = convertSchema(propSchema, ctx);
                // If not in required array, make it optional
                shape[key] = requiredSet.has(key) ? propZodSchema : propZodSchema.optional();
            }
            // Handle propertyNames
            if (schema.propertyNames) {
                const keySchema = convertSchema(schema.propertyNames, ctx);
                const valueSchema = schema.additionalProperties && typeof schema.additionalProperties === "object"
                    ? convertSchema(schema.additionalProperties, ctx)
                    : z.any();
                // Case A: No properties (pure record)
                if (Object.keys(shape).length === 0) {
                    zodSchema = z.record(keySchema, valueSchema);
                    break;
                }
                // Case B: With properties (intersection of object and looseRecord)
                const objectSchema = z.object(shape).passthrough();
                const recordSchema = z.looseRecord(keySchema, valueSchema);
                zodSchema = z.intersection(objectSchema, recordSchema);
                break;
            }
            // Handle patternProperties
            if (schema.patternProperties) {
                // patternProperties: keys matching pattern must satisfy corresponding schema
                // Use loose records so non-matching keys pass through
                const patternProps = schema.patternProperties;
                const patternKeys = Object.keys(patternProps);
                const looseRecords = [];
                for (const pattern of patternKeys) {
                    const patternValue = convertSchema(patternProps[pattern], ctx);
                    const keySchema = z.string().regex(new RegExp(pattern));
                    looseRecords.push(z.looseRecord(keySchema, patternValue));
                }
                // Build intersection: object schema + all pattern property records
                const schemasToIntersect = [];
                if (Object.keys(shape).length > 0) {
                    // Use passthrough so patternProperties can validate additional keys
                    schemasToIntersect.push(z.object(shape).passthrough());
                }
                schemasToIntersect.push(...looseRecords);
                if (schemasToIntersect.length === 0) {
                    zodSchema = z.object({}).passthrough();
                }
                else if (schemasToIntersect.length === 1) {
                    zodSchema = schemasToIntersect[0];
                }
                else {
                    // Chain intersections: (A & B) & C & D ...
                    let result = z.intersection(schemasToIntersect[0], schemasToIntersect[1]);
                    for (let i = 2; i < schemasToIntersect.length; i++) {
                        result = z.intersection(result, schemasToIntersect[i]);
                    }
                    zodSchema = result;
                }
                break;
            }
            // Handle additionalProperties
            // In JSON Schema, additionalProperties defaults to true (allow any extra properties)
            // In Zod, objects strip unknown keys by default, so we need to handle this explicitly
            const objectSchema = z.object(shape);
            if (schema.additionalProperties === false) {
                // Strict mode - no extra properties allowed
                zodSchema = objectSchema.strict();
            }
            else if (typeof schema.additionalProperties === "object") {
                // Extra properties must match the specified schema
                zodSchema = objectSchema.catchall(convertSchema(schema.additionalProperties, ctx));
            }
            else {
                // additionalProperties is true or undefined - allow any extra properties (passthrough)
                zodSchema = objectSchema.passthrough();
            }
            break;
        }
        case "array": {
            // TODO: uniqueItems is not supported
            // TODO: contains/minContains/maxContains are not supported
            // Check if this is a tuple (prefixItems or items as array)
            const prefixItems = schema.prefixItems;
            const items = schema.items;
            if (prefixItems && Array.isArray(prefixItems)) {
                // Tuple with prefixItems (draft-2020-12)
                const tupleItems = prefixItems.map((item) => convertSchema(item, ctx));
                const rest = items && typeof items === "object" && !Array.isArray(items)
                    ? convertSchema(items, ctx)
                    : undefined;
                if (rest) {
                    zodSchema = z.tuple(tupleItems).rest(rest);
                }
                else {
                    zodSchema = z.tuple(tupleItems);
                }
                // Apply minItems/maxItems constraints to tuples
                if (typeof schema.minItems === "number") {
                    zodSchema = zodSchema.check(z.minLength(schema.minItems));
                }
                if (typeof schema.maxItems === "number") {
                    zodSchema = zodSchema.check(z.maxLength(schema.maxItems));
                }
            }
            else if (Array.isArray(items)) {
                // Tuple with items array (draft-7)
                const tupleItems = items.map((item) => convertSchema(item, ctx));
                const rest = schema.additionalItems && typeof schema.additionalItems === "object"
                    ? convertSchema(schema.additionalItems, ctx)
                    : undefined; // additionalItems: false means no rest, handled by default tuple behavior
                if (rest) {
                    zodSchema = z.tuple(tupleItems).rest(rest);
                }
                else {
                    zodSchema = z.tuple(tupleItems);
                }
                // Apply minItems/maxItems constraints to tuples
                if (typeof schema.minItems === "number") {
                    zodSchema = zodSchema.check(z.minLength(schema.minItems));
                }
                if (typeof schema.maxItems === "number") {
                    zodSchema = zodSchema.check(z.maxLength(schema.maxItems));
                }
            }
            else if (items !== undefined) {
                // Regular array
                const element = convertSchema(items, ctx);
                let arraySchema = z.array(element);
                // Apply constraints
                if (typeof schema.minItems === "number") {
                    arraySchema = arraySchema.min(schema.minItems);
                }
                if (typeof schema.maxItems === "number") {
                    arraySchema = arraySchema.max(schema.maxItems);
                }
                zodSchema = arraySchema;
            }
            else {
                // No items specified - array of any
                zodSchema = z.array(z.any());
            }
            break;
        }
        default:
            throw new Error(`Unsupported type: ${type}`);
    }
    return zodSchema;
}
function convertSchema(schema, ctx) {
    if (typeof schema === "boolean") {
        return schema ? z.any() : z.never();
    }
    // Convert base schema first (ignoring composition keywords)
    let baseSchema = convertBaseSchema(schema, ctx);
    const hasExplicitType = schema.type || schema.enum !== undefined || schema.const !== undefined;
    // Process composition keywords LAST (they can appear together)
    // Handle anyOf - wrap base schema with union
    if (schema.anyOf && Array.isArray(schema.anyOf)) {
        const options = schema.anyOf.map((s) => convertSchema(s, ctx));
        const anyOfUnion = z.union(options);
        baseSchema = hasExplicitType ? z.intersection(baseSchema, anyOfUnion) : anyOfUnion;
    }
    // Handle oneOf - exclusive union (exactly one must match)
    if (schema.oneOf && Array.isArray(schema.oneOf)) {
        const options = schema.oneOf.map((s) => convertSchema(s, ctx));
        const oneOfUnion = z.xor(options);
        baseSchema = hasExplicitType ? z.intersection(baseSchema, oneOfUnion) : oneOfUnion;
    }
    // Handle allOf - wrap base schema with intersection
    if (schema.allOf && Array.isArray(schema.allOf)) {
        if (schema.allOf.length === 0) {
            baseSchema = hasExplicitType ? baseSchema : z.any();
        }
        else {
            let result = hasExplicitType ? baseSchema : convertSchema(schema.allOf[0], ctx);
            const startIdx = hasExplicitType ? 0 : 1;
            for (let i = startIdx; i < schema.allOf.length; i++) {
                result = z.intersection(result, convertSchema(schema.allOf[i], ctx));
            }
            baseSchema = result;
        }
    }
    // Handle nullable (OpenAPI 3.0)
    if (schema.nullable === true && ctx.version === "openapi-3.0") {
        baseSchema = z.nullable(baseSchema);
    }
    // Handle readOnly
    if (schema.readOnly === true) {
        baseSchema = z.readonly(baseSchema);
    }
    // Apply `default` so it wraps the fully-composed schema. This ensures
    // `parse(undefined) -> default` works regardless of which branch of
    // `convertBaseSchema` produced the inner schema (enum/const/not/typed/etc.).
    if (schema.default !== undefined) {
        baseSchema = baseSchema.default(schema.default);
    }
    // Collect non-description annotation metadata into the user-supplied
    // registry. Description is handled separately below via `.describe()` to
    // preserve the contract that `schema.description` reads from globalRegistry.
    const extraMeta = {};
    const coreMetadataKeys = ["$id", "id", "$comment", "$anchor", "$vocabulary", "$dynamicRef", "$dynamicAnchor"];
    for (const key of coreMetadataKeys) {
        if (key in schema) {
            extraMeta[key] = schema[key];
        }
    }
    const contentMetadataKeys = ["contentEncoding", "contentMediaType", "contentSchema"];
    for (const key of contentMetadataKeys) {
        if (key in schema) {
            extraMeta[key] = schema[key];
        }
    }
    for (const key of Object.keys(schema)) {
        if (!RECOGNIZED_KEYS.has(key)) {
            extraMeta[key] = schema[key];
        }
    }
    if (Object.keys(extraMeta).length > 0) {
        ctx.registry.add(baseSchema, extraMeta);
    }
    // Apply description last. `.describe()` clones the schema and sets
    // `_zod.parent` on the clone, so registry lookups on the returned reference
    // still resolve `extraMeta` via parent inheritance.
    if (schema.description) {
        baseSchema = baseSchema.describe(schema.description);
    }
    return baseSchema;
}
/**
 * Converts a JSON Schema to a Zod schema. This function should be considered semi-experimental. It's behavior is liable to change. */
function fromJSONSchema(schema, params) {
    // Handle boolean schemas
    if (typeof schema === "boolean") {
        return schema ? z.any() : z.never();
    }
    // Normalize input via a JSON round-trip. This guarantees the converter
    // walks a plain, finite, JSON-valid object graph: cyclic inputs fail here,
    // getter/Proxy-based properties are materialized into static values, and
    // class instances collapse to plain objects.
    let normalized;
    try {
        normalized = JSON.parse(JSON.stringify(schema));
    }
    catch {
        throw new Error("fromJSONSchema input is not valid JSON (possibly cyclic); use $defs/$ref for recursive schemas");
    }
    const version = detectVersion(normalized, params?.defaultTarget);
    const defs = (normalized.$defs || normalized.definitions || {});
    const ctx = {
        version,
        defs,
        refs: new Map(),
        processing: new Set(),
        rootSchema: normalized,
        registry: params?.registry ?? registries/* globalRegistry */.fd,
    };
    return convertSchema(normalized, ctx);
}

;// ./node_modules/zod/v4/classic/coerce.js


function string(params) {
    return api/* _coercedString */.K_(classic_schemas.ZodString, params);
}
function number(params) {
    return api/* _coercedNumber */.qG(classic_schemas.ZodNumber, params);
}
function coerce_boolean(params) {
    return api/* _coercedBoolean */.dN(classic_schemas.ZodBoolean, params);
}
function bigint(params) {
    return api/* _coercedBigint */.St(classic_schemas.ZodBigInt, params);
}
function date(params) {
    return api/* _coercedDate */.B4(classic_schemas.ZodDate, params);
}

;// ./node_modules/zod/v4/classic/external.js






// zod-specified


(0,core/* config */.$W)(en());




// iso
// must be exported from top-level
// https://github.com/colinhacks/zod/issues/4491




;// ./node_modules/zod/index.js
/* unused harmony import specifier */ var zod_z;



/* harmony default export */ const zod = ((/* unused pure expression or super */ null && (zod_z)));


/***/ }

}]);
