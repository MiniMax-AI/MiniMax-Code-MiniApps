// @ts-check

import { OAUTH_HOSTS } from './constants.mjs';

export const OAUTH_CLIENT = Object.freeze({
  clientId: '659cf4c1-615c-45f6-a5f6-4bf15eb476e5',
  scopes: Object.freeze(['openid', 'profile', 'coding_plan']),
  deviceCodeUrl: (/** @type {'cn' | 'global'} */ region) => `${OAUTH_HOSTS[region]}/oauth2/device/code`,
  tokenUrl: (/** @type {'cn' | 'global'} */ region) => `${OAUTH_HOSTS[region]}/oauth2/token`,
});
