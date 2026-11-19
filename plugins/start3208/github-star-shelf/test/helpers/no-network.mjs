// 网络闸：测试里除了连本机（127.0.0.1 / localhost，测试客户端跟 Mini App 服务说话用的）以外，
// 任何 fetch 都直接报错，免得离线测试悄悄访问真实的 GitHub（匿名额度只有每小时 60 次，而且同一个出口 IP 共用）。
// 要测「公开接口」的请求长什么样，就用 withFakeFetch 临时换成自己的假 fetch，测试结束自动换回来。
const realFetch = globalThis.fetch;
const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/;
export const networkAttempts = [];

const urlOf = (input) => String(typeof input === 'string' ? input : input?.url ?? input);

globalThis.fetch = async function guardedFetch(input, init) {
  const url = urlOf(input);
  if (LOCAL.test(url)) return realFetch(input, init);
  networkAttempts.push(url);
  throw new TypeError('offline test tried to reach the network: ' + url);
};
const guarded = globalThis.fetch;

/** 在这个测试里，外网请求交给 handler(url, init)；本机请求照常。返回记录下来的外网请求列表 */
export function withFakeFetch(t, handler) {
  const seen = [];
  globalThis.fetch = async (input, init) => {
    const url = urlOf(input);
    if (LOCAL.test(url)) return realFetch(input, init);
    seen.push({ url, headers: init?.headers || {} });
    return handler(url, init);
  };
  t.after(() => {
    globalThis.fetch = guarded;
  });
  return seen;
}

/** 假的 GitHub 接口回答 */
export const jsonResponse = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
