/** Lower number = higher priority when sorting outbound batches. */
export function outboundEventPriority(data: any): number {
  const name = data?.eventName;
  if (!name || typeof name !== 'string') return 50;
  if (name === 'UPDATE_GAME_OBJECT' || name === 'DELETE_GAME_OBJECT') return 0;
  if (name === 'CURSOR_MOVE') return 1;
  if (name.startsWith('FILE_SEND_CHANK_') || name.startsWith('FILE_MORE_CHANK_')) return 100;
  if (name.startsWith('START_FILE_TRANSMISSION') || name.startsWith('START_AUDIO_TRANSMISSION')) return 90;
  if (name.startsWith('UPDATE_FILE_RESOURE') || name.startsWith('UPDATE_AUDIO_RESOURE')) return 80;
  if (name.startsWith('SYNCHRONIZE_FILE_LIST') || name.startsWith('SYNCHRONIZE_AUDIO_LIST')) return 70;
  if (name.startsWith('REQUEST_FILE_RESOURE') || name.startsWith('REQUEST_AUDIO_RESOURE')) return 60;
  return 50;
}

/** Best (lowest) priority in a Network.send / SkyWay enqueue batch. */
export function outboundBatchPriority(data: any): number {
  if (!Array.isArray(data)) return outboundEventPriority(data);
  let best = 50;
  for (const item of data) best = Math.min(best, outboundEventPriority(item));
  return best;
}

/** Real-time tabletop sync — always drain before bulk file chunks. */
export function isHighPriorityOutbound(data: any): boolean {
  return outboundBatchPriority(data) < 10;
}
