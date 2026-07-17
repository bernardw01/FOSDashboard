/**
 * PRD version 2.26.1 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Nested ScriptLock helpers. Apps Script tryLock() returns true when the
 * current execution already holds the lock; releasing in an inner helper
 * drops the outer holder's lock. Use begin/end pairs so only the outermost
 * acquire and release run.
 */

/** @type {number} */
var scriptLockNestDepth_ = 0;

/**
 * @param {!GoogleAppsScript.Lock.Lock} lock
 * @param {number} waitMs
 * @return {!{ acquiredOuter: boolean, lock: !GoogleAppsScript.Lock.Lock }}
 */
function beginScriptLockNest_(lock, waitMs) {
  var acquiredOuter = false;
  if (scriptLockNestDepth_ === 0) {
    acquiredOuter = lock.tryLock(waitMs);
    if (!acquiredOuter) {
      lock.waitLock(waitMs);
      acquiredOuter = true;
    }
  }
  scriptLockNestDepth_++;
  return { acquiredOuter: acquiredOuter, lock: lock };
}

/**
 * @param {?{ acquiredOuter: boolean, lock: !GoogleAppsScript.Lock.Lock }} token
 */
function endScriptLockNest_(token) {
  if (!token) {
    return;
  }
  scriptLockNestDepth_ = Math.max(0, scriptLockNestDepth_ - 1);
  if (token.acquiredOuter && scriptLockNestDepth_ === 0) {
    try {
      token.lock.releaseLock();
    } catch (_) {
      /* ignore */
    }
  }
}
