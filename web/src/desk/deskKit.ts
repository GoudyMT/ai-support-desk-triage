// The desk's on-demand parts: the desk wording and the sentence model's loader.
// One chunk, fetched when Start or Sort is pressed, so opening the page loads
// none of it. It holds only code no other page runs, so the code the pages share
// stays one chunk.
export { DESK_WORDING } from '../generator/deskFrames';
export { TOTAL_BYTES, loadDeskSentence } from './sentenceLoader';
