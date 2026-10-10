// @ts-check

/**
 * 取象：动爻的爻位、后天方位、五行旺相。
 *
 * 应期的主语有两种：认出了事类时看「某某类神」的五行，没认出来时退回「用卦」——
 * 用卦就是所问之事本身，这是梅花易数的本分。
 */

/**
 * 爻位之象。动爻所在的位置本身带信息。
 * @type {readonly {title: string, text: string}[]}
 */
export const LINE_POSITIONS = Object.freeze([
  Object.freeze({ title: '初爻 · 事之始', text: '事在萌芽，位未显。多主开端、起步、近身之事，宜布局而不宜论成败。' }),
  Object.freeze({ title: '二爻 · 臣位近身', text: '居内卦之中，近于己身。事在自家可控范围，但受制于上，仍需仰望。' }),
  Object.freeze({ title: '三爻 · 门户之交', text: '内卦之极、外卦之始，进退转换之关。多主变动、转折、去留之问。' }),
  Object.freeze({ title: '四爻 · 近臣惧位', text: '居外卦之近，多惧、多惊扰，与人接触最密，也最易受他人牵动。' }),
  Object.freeze({ title: '五爻 · 君位', text: '阳爻居君位，主尊长、贵人、上级与最终拍板者。事多以得贵人助力告终。' }),
  Object.freeze({ title: '上爻 · 事之终', text: '事至终局，多主超然、退出、了结与尘埃落定。' }),
]);

/**
 * 五行之旺相之地，用以推应期。
 * 旺者当令之气，相者我生之地。月支与日支都按此取。
 */
const SEASON_TABLE = Object.freeze({
  木: { wang: '寅卯', xiang: '巳午' },
  火: { wang: '巳午', xiang: '辰戌丑未' },
  土: { wang: '辰戌丑未', xiang: '申酉' },
  金: { wang: '申酉', xiang: '亥子丑' },
  水: { wang: '亥子', xiang: '寅卯' },
});

/**
 * 应期：五行旺相之地所在的月与日。
 * @param {string} element 五行
 * @param {string} [subject] 主语，如「用卦坎」「财运类神」；缺省作「用卦」
 */
export function responseTiming(element, subject = '用卦') {
  const table = SEASON_TABLE[element];
  if (!table) return null;
  return {
    wang: table.wang,
    xiang: table.xiang,
    text: `${subject}属${element}，旺在${table.wang}，相在${table.xiang}。事情多在${table.wang}月或${table.wang}日见端倪，至${table.xiang}前后渐明。`,
  };
}
