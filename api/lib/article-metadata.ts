/** Page navigation also contains document ids. Use only the main article's class. */
export function articleDocid(html: string) {
  return html.match(/<(?:article|main)\b[^>]*\bclass=["'][^"']*\bdocId-(\d{6,12})\b/i)?.[1]
    || html.match(/<div\b[^>]*\bid=["']article["'][^>]*\bclass=["'][^"']*\bdocId-(\d{6,12})\b/i)?.[1]
    || null
}
export function sameArticleTitle(left: string, right: string) {
  const clean = (value: string) => value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '')
  return Boolean(clean(left)) && clean(left) === clean(right)
}
