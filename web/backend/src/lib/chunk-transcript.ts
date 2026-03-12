import { compactWhitespace, normalizeSearchText } from "./normalize.js";

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface ChunkWord {
  word: string;
  startMs: number;
  endMs: number;
}

export interface TranscriptChunk {
  chunkIndex: number;
  startMs: number;
  endMs: number;
  text: string;
  normalizedText: string;
  wordsJson: ChunkWord[];
}

const MAX_CHUNK_DURATION_MS = 12_000;
const MAX_WORDS_PER_CHUNK = 48;
const MIN_WORDS_FOR_SENTENCE_SPLIT = 10;
const MIN_WORDS_FOR_GAP_SPLIT = 8;
const LONG_GAP_MS = 1_500;

function endsSentence(value: string): boolean {
  return /[.!?…]$/.test(value.trim());
}

function toMilliseconds(value: number): number {
  return Math.max(0, Math.round(value * 1_000));
}

export function createTranscriptChunks(words: TranscriptWord[]): TranscriptChunk[] {
  const validWords = words.filter((word) => typeof word.word === "string" && word.word.trim().length > 0 && Number.isFinite(word.start) && Number.isFinite(word.end));

  if (validWords.length === 0) {
    return [];
  }

  const chunks: TranscriptChunk[] = [];
  let activeWords: ChunkWord[] = [];
  let chunkIndex = 0;

  const flush = (): void => {
    if (activeWords.length === 0) {
      return;
    }

    const text = compactWhitespace(activeWords.map((word) => word.word).join(" "));
    const normalizedText = normalizeSearchText(text);

    const firstWord = activeWords[0];
    const lastWord = activeWords[activeWords.length - 1];

    if (normalizedText.length > 0 && firstWord && lastWord) {
      chunks.push({
        chunkIndex,
        startMs: firstWord.startMs,
        endMs: lastWord.endMs,
        text,
        normalizedText,
        wordsJson: activeWords,
      });
      chunkIndex += 1;
    }

    activeWords = [];
  };

  for (let index = 0; index < validWords.length; index += 1) {
    const currentWord = validWords[index];
    const nextWord = validWords[index + 1];

    if (!currentWord) {
      continue;
    }

    const chunkWord: ChunkWord = {
      word: currentWord.word.trim(),
      startMs: toMilliseconds(currentWord.start),
      endMs: toMilliseconds(currentWord.end),
    };

    activeWords.push(chunkWord);

    const firstWord = activeWords[0];
    if (!firstWord) {
      continue;
    }

    const durationMs = chunkWord.endMs - firstWord.startMs;
    const nextGapMs = nextWord ? toMilliseconds(nextWord.start) - chunkWord.endMs : 0;

    const shouldFlushByCount = activeWords.length >= MAX_WORDS_PER_CHUNK;
    const shouldFlushByDuration = durationMs >= MAX_CHUNK_DURATION_MS;
    const shouldFlushBySentence = endsSentence(chunkWord.word) && activeWords.length >= MIN_WORDS_FOR_SENTENCE_SPLIT && durationMs >= 3_500;
    const shouldFlushByGap = nextGapMs >= LONG_GAP_MS && activeWords.length >= MIN_WORDS_FOR_GAP_SPLIT;

    if (shouldFlushByCount || shouldFlushByDuration || shouldFlushBySentence || shouldFlushByGap) {
      flush();
    }
  }

  flush();
  return chunks;
}
