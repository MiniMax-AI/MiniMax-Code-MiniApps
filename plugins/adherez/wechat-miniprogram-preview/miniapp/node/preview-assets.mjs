import { rewriteCssUrls } from '../client/css-urls.mjs';

// Context is routing, not a capability. The HTTP handler still validates the pin and grant.
export function scopeAssetUrl(source, previewId) {
  if (!source.startsWith('asset/')) return source;
  const hashAt = source.indexOf('#');
  const hash = hashAt < 0 ? '' : source.slice(hashAt);
  const base = hashAt < 0 ? source : source.slice(0, hashAt);
  const queryAt = base.indexOf('?');
  const resource = queryAt < 0 ? base : base.slice(0, queryAt);
  const query = new URLSearchParams(queryAt < 0 ? '' : base.slice(queryAt + 1));
  query.set('previewId', previewId);
  return `${resource}?${query}${hash}`;
}

export function scopeCssAssets(source, previewId) {
  return rewriteCssUrls(source, (url) => scopeAssetUrl(url, previewId));
}
