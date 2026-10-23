(function (global) {
  'use strict';
  var profiles = {
    '390x844': {
      id: '390x844', label: 'iPhone 14 · 390 × 844', model: 'iPhone 14 (H5 preview)',
      width: 390, height: 844, pixelRatio: 3, statusBarHeight: 47, navHeight: 44, hasNotch: true,
      capsule: { width: 87, height: 32, top: 51, right: 7 }, safeAreaBottom: 34,
      platform: 'ios', system: 'iOS 17.0', version: '8.0.50', sdkVersion: '3.5.0',
    },
    '375x667': {
      id: '375x667', label: 'iPhone SE · 375 × 667', model: 'iPhone SE (H5 preview)',
      width: 375, height: 667, pixelRatio: 2, statusBarHeight: 20, navHeight: 44, hasNotch: false,
      capsule: { width: 87, height: 32, top: 24, right: 7 }, safeAreaBottom: 0,
      platform: 'ios', system: 'iOS 17.0', version: '8.0.50', sdkVersion: '3.5.0',
    },
    '430x932': {
      id: '430x932', label: 'iPhone 14 Pro Max · 430 × 932', model: 'iPhone 14 Pro Max (H5 preview)',
      width: 430, height: 932, pixelRatio: 3, statusBarHeight: 47, navHeight: 44, hasNotch: true,
      capsule: { width: 87, height: 32, top: 51, right: 7 }, safeAreaBottom: 34,
      platform: 'ios', system: 'iOS 17.0', version: '8.0.50', sdkVersion: '3.5.0',
    },
  };
  var defaultId = '390x844';
  function clone(profile) {
    return {
      id: profile.id, label: profile.label, model: profile.model, width: profile.width, height: profile.height,
      pixelRatio: profile.pixelRatio, statusBarHeight: profile.statusBarHeight, navHeight: profile.navHeight, hasNotch: profile.hasNotch,
      capsule: { width: profile.capsule.width, height: profile.capsule.height, top: profile.capsule.top, right: profile.capsule.right },
      safeAreaBottom: profile.safeAreaBottom, platform: profile.platform, system: profile.system,
      version: profile.version, sdkVersion: profile.sdkVersion,
    };
  }
  function get(id) {
    return clone(Object.prototype.hasOwnProperty.call(profiles, id) ? profiles[id] : profiles[defaultId]);
  }
  global.__WX_PREVIEW_DEVICES__ = Object.freeze({
    defaultId: defaultId,
    ids: Object.freeze(Object.keys(profiles)),
    get: get,
    metrics: function (id, options) {
      var device = get(id);
      options = options || {};
      var navigationTop = options.customNavigation ? 0 : device.statusBarHeight + device.navHeight;
      var topTab = options.tabBarVisible && options.tabBarPosition === 'top';
      var bottomTab = options.tabBarVisible && !topTab;
      var expectedTop = navigationTop + (topTab ? 49 : 0);
      var expectedHeight = device.height - expectedTop - (bottomTab ? 49 + device.safeAreaBottom : 0);
      function measured(value, fallback, maximum) {
        return typeof value === 'number' && isFinite(value) && value >= 0 ? Math.min(maximum, value) : fallback;
      }
      var contentTop = measured(options.contentTop, expectedTop, device.height);
      var contentHeight = measured(options.contentHeight, expectedHeight, device.height - contentTop);
      var insets = {
        top: Math.max(0, device.statusBarHeight - contentTop), right: 0,
        bottom: Math.max(0, contentTop + contentHeight - (device.height - device.safeAreaBottom)), left: 0,
      };
      return {
        screenWidth: device.width, screenHeight: device.height, windowWidth: device.width,
        windowHeight: contentHeight, screenTop: contentTop, statusBarHeight: device.statusBarHeight,
        contentTop: contentTop, contentWidth: device.width, contentHeight: contentHeight, safeAreaInsets: insets,
        cssVariables: {
          '--wx-rpx': String(device.width / 750) + 'px',
          '--wx-vh': String(contentHeight / 100) + 'px',
          '--wx-content-height': String(contentHeight) + 'px',
          '--wx-safe-area-inset-top': String(insets.top) + 'px',
          '--wx-safe-area-inset-right': String(insets.right) + 'px',
          '--wx-safe-area-inset-bottom': String(insets.bottom) + 'px',
          '--wx-safe-area-inset-left': String(insets.left) + 'px',
        },
        safeArea: { left: 0, right: device.width, top: device.statusBarHeight, bottom: device.height - device.safeAreaBottom,
          width: device.width, height: device.height - device.statusBarHeight - device.safeAreaBottom },
        menu: { width: device.capsule.width, height: device.capsule.height, top: device.capsule.top,
          bottom: device.capsule.top + device.capsule.height, left: device.width - device.capsule.right - device.capsule.width,
          right: device.width - device.capsule.right },
      };
    },
    list: Object.freeze(Object.keys(profiles).map(function (id) { return Object.freeze(get(id)); })),
  });
})(window);
