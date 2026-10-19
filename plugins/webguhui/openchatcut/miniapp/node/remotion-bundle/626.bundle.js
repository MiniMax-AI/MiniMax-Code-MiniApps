"use strict";
(globalThis["webpackChunkopenchatcut"] = globalThis["webpackChunkopenchatcut"] || []).push([[626],{

/***/ 7626
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   fontFamily: () => (/* binding */ fontFamily),
/* harmony export */   getInfo: () => (/* binding */ getInfo),
/* harmony export */   loadFont: () => (/* binding */ loadFont)
/* harmony export */ });
/* harmony import */ var remotion__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(3947);
/* harmony import */ var remotion_no_react__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(9382);
// src/base.ts



// src/resolve-font-subsets.ts
var isChunkSubset = (subset) => /^\[\d+\]$/.test(subset);
var compareChunkSubsets = (a, b) => {
  return Number(a.slice(1, -1)) - Number(b.slice(1, -1));
};
var resolveFontSubsetKeys = ({
  availableSubsetKeys,
  metaSubsets,
  requestedSubset
}) => {
  if (availableSubsetKeys.includes(requestedSubset)) {
    return [requestedSubset];
  }
  if (!metaSubsets.includes(requestedSubset)) {
    return [requestedSubset];
  }
  const chunkSubsets = availableSubsetKeys.filter(isChunkSubset).sort(compareChunkSubsets);
  return chunkSubsets.length === 0 ? [requestedSubset] : chunkSubsets;
};

// src/base.ts
var loadedFonts = {};
var withResolvers = function() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
var loadFontFaceOrTimeoutAfter20Seconds = (fontFace) => {
  const timeout = withResolvers();
  const int = setTimeout(() => {
    timeout.reject(new Error("Timed out loading Google Font"));
  }, 18000);
  return Promise.race([
    fontFace.load().then(() => {
      clearTimeout(int);
    }),
    timeout.promise
  ]);
};
var loadFonts = (meta, style, options) => {
  const weightsAndSubsetsAreSpecified = Array.isArray(options?.weights) && Array.isArray(options?.subsets) && options.weights.length > 0 && options.subsets.length > 0;
  if (remotion_no_react__WEBPACK_IMPORTED_MODULE_1__/* .NoReactInternals */ .JC.ENABLE_V5_BREAKING_CHANGES && !weightsAndSubsetsAreSpecified) {
    throw new Error("Loading Google Fonts without specifying weights and subsets is not supported in Remotion v5. Please specify the weights and subsets you need.");
  }
  const promises = [];
  const styles = style ? [style] : Object.keys(meta.fonts);
  let fontsLoaded = 0;
  for (const style2 of styles) {
    if (typeof FontFace === "undefined") {
      continue;
    }
    if (!meta.fonts[style2]) {
      throw new Error(`The font ${meta.fontFamily} does not have a style ${style2}`);
    }
    const weights = options?.weights ?? Object.keys(meta.fonts[style2]);
    for (const weight of weights) {
      if (!meta.fonts[style2][weight]) {
        throw new Error(`The font ${meta.fontFamily} does not  have a weight ${weight} in style ${style2}`);
      }
      const requestedSubsets = options?.subsets ?? Object.keys(meta.fonts[style2][weight]);
      const availableSubsetKeys = Object.keys(meta.fonts[style2][weight]);
      const subsets = [
        ...new Set(requestedSubsets.flatMap((requestedSubset) => resolveFontSubsetKeys({
          availableSubsetKeys,
          metaSubsets: meta.subsets,
          requestedSubset
        })))
      ];
      for (const subset of subsets) {
        let font = meta.fonts[style2]?.[weight]?.[subset];
        if (!font) {
          throw new Error(`weight: ${weight} subset: ${subset} is not available for '${meta.fontFamily}'`);
        }
        let fontKey = `${meta.fontFamily}-${style2}-${weight}-${subset}`;
        const previousPromise = loadedFonts[fontKey];
        if (previousPromise) {
          promises.push(previousPromise);
          continue;
        }
        const baseLabel = `Fetching ${meta.fontFamily} font ${JSON.stringify({
          style: style2,
          weight,
          subset
        })}`;
        const label = weightsAndSubsetsAreSpecified ? baseLabel : `${baseLabel}. This might be caused by loading too many font variations. Read more: https://www.remotion.dev/docs/troubleshooting/font-loading-errors#render-timeout-when-loading-google-fonts`;
        const handle = (0,remotion__WEBPACK_IMPORTED_MODULE_0__/* .delayRender */ .IH)(label, { timeoutInMilliseconds: 60000 });
        fontsLoaded++;
        const fontFace = new FontFace(meta.fontFamily, `url(${font}) format('woff2')`, {
          weight,
          style: style2,
          unicodeRange: meta.unicodeRanges[subset]
        });
        let attempts = 2;
        const tryToLoad = () => {
          if (fontFace.status === "loaded") {
            (0,remotion__WEBPACK_IMPORTED_MODULE_0__/* .continueRender */ ._8)(handle);
            return;
          }
          const promise = loadFontFaceOrTimeoutAfter20Seconds(fontFace).then(() => {
            (options?.document ?? document).fonts.add(fontFace);
            (0,remotion__WEBPACK_IMPORTED_MODULE_0__/* .continueRender */ ._8)(handle);
          }).catch((err) => {
            loadedFonts[fontKey] = undefined;
            if (attempts === 0) {
              throw err;
            } else {
              attempts--;
              tryToLoad();
            }
          });
          loadedFonts[fontKey] = promise;
          promises.push(promise);
        };
        tryToLoad();
      }
    }
    if (fontsLoaded > 20 && !options?.ignoreTooManyRequestsWarning) {
      console.warn(`Made ${fontsLoaded} network requests to load fonts for ${meta.fontFamily}. Consider loading fewer weights and subsets by passing options to loadFont(). Disable this warning by passing "ignoreTooManyRequestsWarning: true" to "options".`);
    }
  }
  return {
    fontFamily: meta.fontFamily,
    fonts: meta.fonts,
    unicodeRanges: meta.unicodeRanges,
    waitUntilDone: () => Promise.all(promises).then(() => {
      return;
    })
  };
};

// src/Mulish.ts
var getInfo = () => ({
  fontFamily: "Mulish",
  importName: "Mulish",
  version: "v18",
  url: "https://fonts.googleapis.com/css2?family=Mulish:ital,wght@0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900",
  unicodeRanges: {
    "cyrillic-ext": "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F",
    cyrillic: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
    vietnamese: "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB",
    "latin-ext": "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
    latin: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD"
  },
  fonts: {
    italic: {
      "200": {
        "cyrillic-ext": "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2joiaqRXBA.woff2",
        cyrillic: "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2joraqRXBA.woff2",
        vietnamese: "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2jogaqRXBA.woff2",
        "latin-ext": "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2johaqRXBA.woff2",
        latin: "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2jovaqQ.woff2"
      },
      "300": {
        "cyrillic-ext": "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2joiaqRXBA.woff2",
        cyrillic: "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2joraqRXBA.woff2",
        vietnamese: "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2jogaqRXBA.woff2",
        "latin-ext": "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2johaqRXBA.woff2",
        latin: "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2jovaqQ.woff2"
      },
      "400": {
        "cyrillic-ext": "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2joiaqRXBA.woff2",
        cyrillic: "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2joraqRXBA.woff2",
        vietnamese: "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2jogaqRXBA.woff2",
        "latin-ext": "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2johaqRXBA.woff2",
        latin: "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2jovaqQ.woff2"
      },
      "500": {
        "cyrillic-ext": "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2joiaqRXBA.woff2",
        cyrillic: "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2joraqRXBA.woff2",
        vietnamese: "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2jogaqRXBA.woff2",
        "latin-ext": "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2johaqRXBA.woff2",
        latin: "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2jovaqQ.woff2"
      },
      "600": {
        "cyrillic-ext": "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2joiaqRXBA.woff2",
        cyrillic: "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2joraqRXBA.woff2",
        vietnamese: "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2jogaqRXBA.woff2",
        "latin-ext": "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2johaqRXBA.woff2",
        latin: "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2jovaqQ.woff2"
      },
      "700": {
        "cyrillic-ext": "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2joiaqRXBA.woff2",
        cyrillic: "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2joraqRXBA.woff2",
        vietnamese: "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2jogaqRXBA.woff2",
        "latin-ext": "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2johaqRXBA.woff2",
        latin: "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2jovaqQ.woff2"
      },
      "800": {
        "cyrillic-ext": "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2joiaqRXBA.woff2",
        cyrillic: "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2joraqRXBA.woff2",
        vietnamese: "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2jogaqRXBA.woff2",
        "latin-ext": "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2johaqRXBA.woff2",
        latin: "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2jovaqQ.woff2"
      },
      "900": {
        "cyrillic-ext": "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2joiaqRXBA.woff2",
        cyrillic: "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2joraqRXBA.woff2",
        vietnamese: "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2jogaqRXBA.woff2",
        "latin-ext": "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2johaqRXBA.woff2",
        latin: "https://fonts.gstatic.com/s/mulish/v18/1Pttg83HX_SGhgqk2jovaqQ.woff2"
      }
    },
    normal: {
      "200": {
        "cyrillic-ext": "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk0gotcqA.woff2",
        cyrillic: "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk2wotcqA.woff2",
        vietnamese: "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk0AotcqA.woff2",
        "latin-ext": "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk0QotcqA.woff2",
        latin: "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk3wot.woff2"
      },
      "300": {
        "cyrillic-ext": "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk0gotcqA.woff2",
        cyrillic: "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk2wotcqA.woff2",
        vietnamese: "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk0AotcqA.woff2",
        "latin-ext": "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk0QotcqA.woff2",
        latin: "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk3wot.woff2"
      },
      "400": {
        "cyrillic-ext": "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk0gotcqA.woff2",
        cyrillic: "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk2wotcqA.woff2",
        vietnamese: "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk0AotcqA.woff2",
        "latin-ext": "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk0QotcqA.woff2",
        latin: "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk3wot.woff2"
      },
      "500": {
        "cyrillic-ext": "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk0gotcqA.woff2",
        cyrillic: "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk2wotcqA.woff2",
        vietnamese: "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk0AotcqA.woff2",
        "latin-ext": "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk0QotcqA.woff2",
        latin: "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk3wot.woff2"
      },
      "600": {
        "cyrillic-ext": "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk0gotcqA.woff2",
        cyrillic: "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk2wotcqA.woff2",
        vietnamese: "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk0AotcqA.woff2",
        "latin-ext": "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk0QotcqA.woff2",
        latin: "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk3wot.woff2"
      },
      "700": {
        "cyrillic-ext": "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk0gotcqA.woff2",
        cyrillic: "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk2wotcqA.woff2",
        vietnamese: "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk0AotcqA.woff2",
        "latin-ext": "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk0QotcqA.woff2",
        latin: "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk3wot.woff2"
      },
      "800": {
        "cyrillic-ext": "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk0gotcqA.woff2",
        cyrillic: "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk2wotcqA.woff2",
        vietnamese: "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk0AotcqA.woff2",
        "latin-ext": "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk0QotcqA.woff2",
        latin: "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk3wot.woff2"
      },
      "900": {
        "cyrillic-ext": "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk0gotcqA.woff2",
        cyrillic: "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk2wotcqA.woff2",
        vietnamese: "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk0AotcqA.woff2",
        "latin-ext": "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk0QotcqA.woff2",
        latin: "https://fonts.gstatic.com/s/mulish/v18/1Ptvg83HX_SGhgqk3wot.woff2"
      }
    }
  },
  subsets: ["cyrillic", "cyrillic-ext", "latin", "latin-ext", "vietnamese"]
});
var fontFamily = "Mulish";
var loadFont = (style, options) => {
  return loadFonts(getInfo(), style, options);
};



/***/ }

}]);
