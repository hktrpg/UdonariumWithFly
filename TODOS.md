# TODOS

## Network / Memory

### SkyWay receivedMap dispose regression test

**What:** Add a unit/fixture test that `SkyWayDataStream.dispose()` clears `receivedMap` (partial DataChannel reassembly buffers).

**Why:** App-level BufferSharingTask reconnect stress can stay green while transport-layer half-chunks still grow across remesh.

**Context:** Added in the reconnect OOM fix (`skyway-data-stream.ts` dispose). Eng review deliberately skipped the test in that PR (mock cost). Start by reading dispose + `onData` receivedMap insert/delete; prefer a minimal cast/fixture over full SkyWay SDK boot if possible.

**Effort:** M
**Priority:** P3
**Depends on:** None

### Long-session ChatMessage / ObjectStore growth

**What:** Add a stress/observation loop for chat (and related GameObjects) under long rooms; decide prune/cap policy if counts grow unboundedly.

**Why:** Two-day Edge OOM is not only mid-transfer receive leaks; permanent ChatMessage children and catalog resync amplify heap over time.

**Context:** Deferred from reconnect OOM eng review (NOT in scope for that PR). Start: `chat-tab.ts` children, `object-store.ts` identifierMap/garbageMap, ObjectSynchronizer sendCatalog on CONNECT_PEER. Prefer countable ObjectStore metrics before Playwright heap.

**Effort:** L
**Priority:** P2
**Depends on:** Ship reconnect cancel / backoff fixes first

### PeerCursor 30s post-disconnect retention under remesh

**What:** Measure PeerCursor ObjectStore overlap when peers remesh with new peerIds; decide whether to shorten the 30s delay or remove sooner.

**Why:** High reconnect rates leave old cursors for 30s while new ones sync in, stacking generations during flaps.

**Context:** `peer-cursor.ts` DISCONNECT handler uses `setTimeout(..., 30000)` then `ObjectStore.remove` (not delete). UX may intentionally keep a brief “who just left” presence — confirm before changing.

**Effort:** M
**Priority:** P3
**Depends on:** Product call on cursor disappearance UX

### Rehome file downloads after peer abort

**What:** When `abortRequestsForPeer` drops pending/outbound, optionally re-enqueue the same identifiers toward other open peers (or trigger targeted synchronize) instead of only deleting slots.

**Why:** Abort alone does not rehome; if the only catalog source left or watchdog is slow, zero backoff still downloads nothing.

**Context:** Raised by outside voice in reconnect OOM eng review. Today recovery relies on later catalog/watchdog (`ensureRoomDownloads`). Coordinate with `FileReceiveScheduler` keys and per-peer catalogs so we do not double-fetch.

**Effort:** L
**Priority:** P3
**Depends on:** Arch A + CQ A (no false backoff on peer death / cancel) shipped first

## Completed
