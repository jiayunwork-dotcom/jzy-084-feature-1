/**
 * Infer the semantic category of a string field from its name.
 *
 * Matching is done case-insensitively on camel/snake/kebab names, using word
 * boundaries so e.g. "userName" matches "name" while "filename" does not.
 * The order matters: more specific categories are tested first.
 *
 * @returns {string} one of
 *   avatar | image | url | email | phone | address | name | fallback
 */
export function inferStringCategory(fieldName) {
  if (!fieldName || typeof fieldName !== 'string') return 'fallback';
  const normalized = fieldName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .toLowerCase();

  const rules = [
    { category: 'avatar', patterns: [/avatar/, /head\s*img/, /head\s*pic/, /portrait/] },
    { category: 'image', patterns: [/image/, /\bimg/, /\bpic(ture)?/, /photo/, /icon/, /logo/] },
    { category: 'email', patterns: [/e-?\s*mail/] },
    { category: 'phone', patterns: [/phone/, /mobile/, /\btel(ephone)?/, /cellphone/] },
    { category: 'url', patterns: [/\burl\b/, /\buri\b/, /website/, /web\s*site/, /home\s*page/, /\blink/] },
    { category: 'address', patterns: [/address/, /\baddr/] },
    { category: 'companyName', patterns: [/company\s*name/, /\bcorp(oration)?\s*name/, /\borg(anization)?\s*name/, /\bfirm\s*name/, /\bcompany\b/] },
    {
      category: 'name',
      patterns: [/\bname/, /username/, /nick\s*name/, /full\s*name/, /contact\s*person/],
    },
  ];

  for (const rule of rules) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      return rule.category;
    }
  }
  return 'fallback';
}
