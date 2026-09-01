const uncountableWords = new Set([
  "deer",
  "info",
  "media",
  "series",
  "sheep",
  "species",
  "you",
])

const irregularWords = new Map([
  ["child", "children"],
  ["criterion", "criteria"],
  ["foot", "feet"],
  ["man", "men"],
  ["person", "people"],
  ["tooth", "teeth"],
])

const wordsEndingInOWithEs = new Set(["hero", "potato"])

function matchCase(source: string, pluralized: string): string {
  if (!source) {
    return pluralized
  }

  const first = source[0]
  if (first === first.toUpperCase() && first !== first.toLowerCase()) {
    return `${pluralized[0].toUpperCase()}${pluralized.slice(1)}`
  }

  return pluralized
}

/**
 * Function to pluralize English words.
 * @param word
 */
export function pluralize(word: string): string {
  const normalized = word.toLowerCase()

  if (uncountableWords.has(normalized)) {
    return word
  }

  const irregular = irregularWords.get(normalized)
  if (irregular) {
    return matchCase(word, irregular)
  }

  if (/(?:ife)$/.test(normalized)) {
    return matchCase(word, `${word.slice(0, -2)}ves`)
  }

  if (/(?:ch|sh|s|x|z)$/.test(normalized)) {
    return `${word}es`
  }

  if (wordsEndingInOWithEs.has(normalized)) {
    return `${word}es`
  }

  if (/[^aeiou]y$/.test(normalized)) {
    return `${word.slice(0, -1)}ies`
  }

  return `${word}s`
}
