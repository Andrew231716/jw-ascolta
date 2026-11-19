/** Page navigation also contains document ids. Use only the main article's class. */
export function articleDocid(html) {
  return (
    html.match(/<(?:article|main)\b[^>]*\bclass=["'][^"']*\bdocId-(\d{6,12})\b/i)?.[1] ||
    html.match(
      /<div\b[^>]*\bid=["']article["'][^>]*\bclass=["'][^"']*\bdocId-(\d{6,12})\b/i,
    )?.[1] ||
    null
  )
}
export function sameArticleTitle(left, right) {
  const clean = (value) =>
    value
      .replace(/&(?:rsquo|lsquo|rdquo|ldquo|quot|apos|ndash|mdash|hellip|nbsp);/gi, ' ')
      .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^\p{L}\p{N}]/gu, '')
  return Boolean(clean(left)) && clean(left) === clean(right)
}
