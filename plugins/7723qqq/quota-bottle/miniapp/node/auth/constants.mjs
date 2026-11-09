// @ts-check

export const REGIONS = Object.freeze({
  global: 'https://api.minimax.io',
  cn: 'https://api.minimaxi.com',
});

export const OAUTH_HOSTS = Object.freeze({
  global: 'https://account.minimax.io',
  cn: 'https://account.minimaxi.com',
});

/**
 * Origins a device-code verification page may live on.
 *
 * The account service answers with the region's platform host
 * (`platform.minimaxi.com` / `platform.minimax.io`); the account host stays
 * allowed because older responses point there. Each list is bound to one
 * region, so a response can never point the user at another region's page.
 */
export const OAUTH_VERIFY_ORIGINS = Object.freeze({
  global: Object.freeze(['https://account.minimax.io', 'https://platform.minimax.io']),
  cn: Object.freeze(['https://account.minimaxi.com', 'https://platform.minimaxi.com']),
});
