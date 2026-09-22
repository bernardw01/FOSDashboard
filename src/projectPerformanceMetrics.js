/**
 * PRD version 3.29.6 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 040: shared project performance metrics (planned / projected margin,
 * EAC hours and dollars, timing-review flag, lifetime resources). Consumed by
 * Delivery P&L payloads and Engagement Update quantitative snapshots so the
 * two surfaces cannot drift (docs/features/040-project-performance-layer.md).
 */

/**
 * @param {?number} n
 * @param {number} decimals
 * @return {?number}
 * @private
 */
function ppRound_(n, decimals) {
  if (n === null || n === undefined || n === '') return null;
  var num = Number(n);
  if (!isFinite(num)) return null;
  var factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
}

/** @private */
function ppRound2_(n) {
  return ppRound_(n, 2);
}

/** @private */
function ppRound1_(n) {
  return ppRound_(n, 1);
}

/**
 * Recognized-only revenue for one P&L month row (BUG-040-02). Blended `m.revenue`
 * still includes forecast milestones; actual margin to date must not.
 *
 * @param {?Object} m
 * @return {number}
 * @private
 */
function ppRecognizedRevenueForMonth_(m) {
  if (!m) return 0;
  if (m.revenueRecognized !== null && m.revenueRecognized !== undefined && m.revenueRecognized !== '') {
    var direct = Number(m.revenueRecognized);
    return isFinite(direct) ? direct : 0;
  }
  var items = m.revenueItems;
  if (items && items.length) {
    var sum = 0;
    for (var i = 0; i < items.length; i++) {
      if (items[i].recognized === true) {
        sum += Number(items[i].amount || 0);
      }
    }
    return sum;
  }
  return 0;
}

/**
 * @return {string} Current UTC month as `YYYY-MM`.
 * @private
 */
function ppCurrentMonthKey_() {
  var d = new Date();
  var y = d.getUTCFullYear();
  var m = d.getUTCMonth() + 1;
  return y + '-' + (m < 10 ? '0' + m : String(m));
}

/**
 * @param {?Object} month
 * @return {number}
 * @private
 */
function ppActualHoursForMonth_(month) {
  if (!month || !month.laborByPerson) return 0;
  var total = 0;
  for (var i = 0; i < month.laborByPerson.length; i++) {
    total += Number(month.laborByPerson[i].hours || 0);
  }
  return total;
}

/**
 * @param {?Object} month
 * @return {number}
 * @private
 */
function ppPlannedHoursForMonth_(month) {
  if (!month || !month.laborByPerson) return 0;
  var total = 0;
  for (var i = 0; i < month.laborByPerson.length; i++) {
    total += Number(month.laborByPerson[i].allocatedHours || 0);
  }
  return total;
}

/**
 * @param {?Object} resourceAllocations
 * @param {string} monthKey
 * @return {?number}
 * @private
 */
function ppPlannedAllocCostForMonth_(resourceAllocations, monthKey) {
  if (!resourceAllocations || !resourceAllocations.months) return null;
  var months = resourceAllocations.months;
  for (var i = 0; i < months.length; i++) {
    if (months[i] && months[i].key === monthKey) {
      return Number(months[i].allocatedCost || 0);
    }
  }
  return null;
}

/**
 * @param {string} name
 * @param {string} role
 * @return {string}
 * @private
 */
function ppPersonKey_(name, role) {
  return String(name || '(Unknown user)') + '\0' + String(role || '(No role)');
}

/**
 * Prefer a human display name over a login-style token (e.g. "Josh Bass"
 * over "josh" / "josh.bass").
 * @param {?string} a
 * @param {?string} b
 * @return {string}
 * @private
 */
function ppPreferDisplayName_(a, b) {
  var as = String(a || '').trim();
  var bs = String(b || '').trim();
  if (!as) return bs;
  if (!bs) return as;
  var aSpace = /\s/.test(as);
  var bSpace = /\s/.test(bs);
  if (aSpace && !bSpace) return as;
  if (bSpace && !aSpace) return bs;
  var aDot = as.indexOf('.') >= 0;
  var bDot = bs.indexOf('.') >= 0;
  if (!aDot && bDot) return as;
  if (!bDot && aDot) return bs;
  return as.length >= bs.length ? as : bs;
}

/**
 * Match labor vs allocation display names (aliases + first-name-only).
 * @param {?string} aName
 * @param {?string} bName
 * @return {boolean}
 * @private
 */
function ppPersonNamesMatch_(aName, bName) {
  if (typeof deliveryPnlPersonNamesMatch_ === 'function') {
    if (deliveryPnlPersonNamesMatch_(aName, bName)) return true;
  } else {
    var norm =
      typeof deliveryPnlNormalizePersonToken_ === 'function'
        ? deliveryPnlNormalizePersonToken_
        : function (s) {
            return String(s || '')
              .trim()
              .toLowerCase()
              .replace(/@.*$/, '')
              .replace(/[._\s\-]+/g, '');
          };
    if (norm(aName) && norm(aName) === norm(bName)) return true;
  }
  // First-name-only vs full name: "josh" <-> "Josh Bass"
  function words(n) {
    return String(n || '')
      .trim()
      .toLowerCase()
      .replace(/[._\-]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }
  var wa = words(aName);
  var wb = words(bName);
  if (!wa.length || !wb.length) return false;
  if (wa.length === 1 && wb.length >= 2 && wa[0] === wb[0]) return true;
  if (wb.length === 1 && wa.length >= 2 && wb[0] === wa[0]) return true;
  return false;
}

/**
 * @param {*} raw
 * @return {?number}
 * @private
 */
function ppNormalizeRate_(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  var n = Number(raw);
  return isFinite(n) && n >= 0 ? n : null;
}

/**
 * Prefer current Team Member Role cost rate, then SOW cost rate.
 * @param {?Object} asg
 * @return {?number}
 * @private
 */
function ppAssignmentCostRate_(asg) {
  if (!asg) return null;
  var current = ppNormalizeRate_(asg.currentCostRate);
  if (current != null) return current;
  return ppNormalizeRate_(asg.sowCostRate);
}

/**
 * Hours-weighted cost rate for a person/role from allocations, then logged
 * cost / logged hours when no allocation rate exists.
 * @param {?string} name
 * @param {?string} role
 * @param {!Array<!Object>} assignments
 * @param {number=} loggedHours
 * @param {number=} loggedCost
 * @return {?number}
 * @private
 */
function ppResolveCostRateForPerson_(name, role, assignments, loggedHours, loggedCost) {
  var roleNorm = String(role || '(No role)').trim().toLowerCase();
  var anyHours = 0;
  var anyCost = 0;
  var roleHours = 0;
  var roleCost = 0;
  var anyRate = null;
  for (var i = 0; i < (assignments || []).length; i++) {
    var asg = assignments[i];
    var asgName = asg.name || asg.clockifyUserName || asg.allocationName;
    if (!ppPersonNamesMatch_(name, asgName)) continue;
    var rate = ppAssignmentCostRate_(asg);
    if (rate == null) continue;
    anyRate = rate;
    var h = Number(asg.allocatedHours || 0);
    if (!isFinite(h) || h < 0) h = 0;
    var weight = h > 0 ? h : 1;
    anyHours += weight;
    anyCost += weight * rate;
    var asgRole = String(asg.roleName || '(No role)').trim().toLowerCase();
    if (asgRole === roleNorm) {
      roleHours += weight;
      roleCost += weight * rate;
    }
  }
  if (roleHours > 0) return roleCost / roleHours;
  if (anyHours > 0) return anyCost / anyHours;
  if (anyRate != null) return anyRate;
  var lh = Number(loggedHours || 0);
  var lc = Number(loggedCost || 0);
  if (lh > 0 && isFinite(lc) && lc !== 0) return Math.abs(lc) / lh;
  return null;
}

/**
 * When Fibery Allocated Cost is missing, set allocatedCostLife to
 * allocated hours * user cost rate.
 * @param {!Array<!Object>} rows
 * @param {!Array<!Object>} assignments
 * @return {!Array<!Object>}
 * @private
 */
function ppFillAllocatedCostFromRates_(rows, assignments) {
  for (var i = 0; i < (rows || []).length; i++) {
    var r = rows[i];
    if (!r) continue;
    var hours = Number(r.allocatedHoursLife || 0);
    if (!(hours > 0)) continue;
    if (Number(r.allocatedCostLife || 0) > 0) continue;
    var rate = ppResolveCostRateForPerson_(
      r.name,
      r.role,
      assignments,
      r.loggedHoursLife,
      r.loggedCostLife
    );
    if (rate == null) continue;
    r.allocatedCostLife = ppRound2_(hours * rate);
  }
  return rows;
}

/**
 * @param {?string} durStart `YYYY-MM-DD`
 * @param {?string} durEnd `YYYY-MM-DD`
 * @param {?string} startYmd
 * @param {?string} endYmd
 * @return {boolean}
 * @private
 */
function ppAllocationOverlapsYmdRange_(durStart, durEnd, startYmd, endYmd) {
  if (!startYmd && !endYmd) return true;
  var aStart = String(durStart || durEnd || '').slice(0, 10);
  var aEnd = String(durEnd || durStart || '').slice(0, 10);
  if (!aStart && !aEnd) return true;
  if (!aEnd) aEnd = aStart;
  if (!aStart) aStart = aEnd;
  var rangeStart = String(startYmd || '').slice(0, 10);
  var rangeEnd = String(endYmd || startYmd || '').slice(0, 10);
  if (!rangeStart && rangeEnd) rangeStart = rangeEnd;
  if (rangeStart && !rangeEnd) rangeEnd = rangeStart;
  if (rangeStart && aEnd < rangeStart) return false;
  if (rangeEnd && aStart > rangeEnd) return false;
  return true;
}

/**
 * Planned margin (Locked Decision #5): static SOW bill/cost rate card on billable
 * allocations. Not used for projected margin (BUG-040-03).
 *
 * @param {!Array<!Object>} assignments
 * @return {!{ pct: ?number, ok: boolean, reason: ?string }}
 * @private
 */
function ppComputeAllocationLaborMargin_(assignments) {
  var billable = [];
  for (var i = 0; i < (assignments || []).length; i++) {
    var a = assignments[i];
    if (a.allocatedAndBillable !== true) continue;
    var hours = Number(a.allocatedHours || 0);
    if (!isFinite(hours) || hours <= 0) continue;
    billable.push(a);
  }
  if (!billable.length) {
    return {
      pct: null,
      ok: false,
      reason: 'No billable allocations with hours on this SOW.',
    };
  }
  var totalRev = 0;
  var totalCost = 0;
  var missingBill = 0;
  var missingCost = 0;
  for (var j = 0; j < billable.length; j++) {
    var row = billable[j];
    var h = Number(row.allocatedHours || 0);
    var billRate = ppNormalizeRate_(row.sowBillRate);
    var costRate = ppNormalizeRate_(row.sowCostRate);
    if (billRate == null) missingBill++;
    if (costRate == null) missingCost++;
    if (billRate == null || costRate == null) continue;
    totalRev += h * billRate;
    totalCost += h * costRate;
  }
  if (missingBill > 0 || missingCost > 0 || totalRev <= 0) {
    var reason = 'Margin requires SOW bill and cost rates on every billable allocation.';
    if (missingBill > 0 && missingCost > 0) {
      reason = 'SOW bill and cost rates missing on one or more billable allocations.';
    } else if (missingCost > 0) {
      reason = 'No SOW cost rate on one or more billable allocations.';
    } else if (missingBill > 0) {
      reason = 'No SOW bill rate on one or more billable allocations.';
    }
    return { pct: null, ok: false, reason: reason };
  }
  return {
    pct: ppRound1_(((totalRev - totalCost) / totalRev) * 100),
    ok: true,
    reason: null,
  };
}

/**
 * @param {?string} personName
 * @param {!Array<!Object>} assignments
 * @param {?boolean=} rowBillable
 * @param {?Object=} rangeYmd `{ startYmd?, endYmd? }`
 * @return {string}
 * @private
 */
function ppFormatSowRoleDisplayForPerson_(personName, assignments, rowBillable, rangeYmd) {
  if (rowBillable === false) return '-';
  var roles = [];
  var sawBillable = false;
  var startYmd = rangeYmd && rangeYmd.startYmd ? String(rangeYmd.startYmd).slice(0, 10) : '';
  var endYmd = rangeYmd && rangeYmd.endYmd ? String(rangeYmd.endYmd).slice(0, 10) : '';
  for (var i = 0; i < (assignments || []).length; i++) {
    var a = assignments[i];
    if (!ppPersonNamesMatch_(personName, a.name)) continue;
    if (!ppAllocationOverlapsYmdRange_(a.durStart, a.durEnd, startYmd, endYmd)) continue;
    if (a.allocatedAndBillable !== true) continue;
    sawBillable = true;
    var role = a.roleOnSow;
    if (role == null || String(role).trim() === '') continue;
    role = String(role).trim();
    if (roles.indexOf(role) < 0) roles.push(role);
  }
  if (!sawBillable && rowBillable !== true) return '-';
  if (!roles.length) return '-';
  return roles.join(', ');
}

/**
 * @param {!Array<!Object>} rows
 * @param {!Array<!Object>} assignments
 * @param {?Object=} rangeYmd
 * @return {!Array<!Object>}
 * @private
 */
function ppAttachSowRoleDisplay_(rows, assignments, rangeYmd) {
  for (var i = 0; i < (rows || []).length; i++) {
    rows[i].sowRoleDisplay = ppFormatSowRoleDisplayForPerson_(
      rows[i].name,
      assignments,
      rows[i].allocatedAndBillable,
      rangeYmd
    );
  }
  return rows;
}

function ppEnsureResourcesLifetimeRow_(byKey, name, role) {
  var roleNorm = String(role || '(No role)').trim().toLowerCase();
  var keys = Object.keys(byKey);
  for (var i = 0; i < keys.length; i++) {
    var existing = byKey[keys[i]];
    if (String(existing.role || '').trim().toLowerCase() !== roleNorm) {
      continue;
    }
    if (ppPersonNamesMatch_(existing.name, name)) {
      existing.name = ppPreferDisplayName_(existing.name, name);
      return existing;
    }
  }
  var key = ppPersonKey_(name, role);
  byKey[key] = {
    personKey: key,
    name: name,
    role: role || '(No role)',
    allocatedHoursLife: 0,
    loggedHoursLife: 0,
    allocatedCostLife: 0,
    loggedCostLife: 0,
    allocatedAndBillable: null,
    highlightOrange: false,
  };
  return byKey[key];
}

/**
 * Builds the Feature 040 `performance` block for a Delivery monthly P&L
 * payload (or a compatible month series).
 *
 * @param {!Object} args
 * @param {!Array<!Object>} args.months
 * @param {?Object=} args.resourceAllocations
 * @param {?number=} args.targetMarginPct
 * @param {?string=} args.asOfMonthKey `YYYY-MM` (default: current UTC month)
 * @param {!Array<!Object>=} args.assignments Allocation assignment rows
 * @return {!Object}
 */
function buildProjectPerformanceBlock_(args) {
  args = args || {};
  var months = args.months || [];
  var resourceAllocations = args.resourceAllocations || null;
  var asOfMonthKey = String(args.asOfMonthKey || ppCurrentMonthKey_()).slice(0, 7);
  var assignments = args.assignments || (resourceAllocations && resourceAllocations.assignments) || [];
  var planned = ppComputeAllocationLaborMargin_(assignments);
  var plannedMarginPct = planned.ok ? planned.pct : null;
  var plannedMarginReason = planned.ok ? null : planned.reason;
  var hasAllocationData =
    !!(resourceAllocations && resourceAllocations.hasAllocations === true) ||
    !!(resourceAllocations && resourceAllocations.months && resourceAllocations.months.length);

  var actualHoursToDate = 0;
  var actualLaborToDate = 0;
  var actualExpensesToDate = 0;
  var revToDate = 0;
  var recognizedRevToDate = 0;
  var remainingPlannedHours = 0;
  var remainingPlannedAllocCost = 0;
  var remainingPlannedExpenses = 0;
  var remainingPlannedRevenue = 0;
  var periodGp = null;
  var periodRevenue = 0;

  for (var i = 0; i < months.length; i++) {
    var m = months[i];
    if (!m || !m.key) continue;
    var labor = Number(m.labor || 0);
    var expenses = Number(m.expenses || 0);
    var revenue = Number(m.revenue || 0);
    if (m.key === asOfMonthKey) {
      periodGp = m.grossProfit !== null && m.grossProfit !== undefined
        ? Number(m.grossProfit)
        : revenue - labor - expenses;
      periodRevenue = revenue;
    }
    if (m.key <= asOfMonthKey) {
      actualHoursToDate += ppActualHoursForMonth_(m);
      actualLaborToDate += labor;
      actualExpensesToDate += expenses;
      revToDate += revenue;
      recognizedRevToDate += ppRecognizedRevenueForMonth_(m);
    } else {
      remainingPlannedHours += ppPlannedHoursForMonth_(m);
      var pc = ppPlannedAllocCostForMonth_(resourceAllocations, m.key);
      if (pc !== null) remainingPlannedAllocCost += pc;
      remainingPlannedExpenses += expenses;
      remainingPlannedRevenue += revenue;
    }
  }

  var totalAllocatedHours = 0;
  var totalAllocatedCost = 0;
  for (var ai = 0; ai < assignments.length; ai++) {
    totalAllocatedHours += Number(assignments[ai].allocatedHours || 0);
    totalAllocatedCost += Number(assignments[ai].allocatedCost || 0);
  }
  if (!totalAllocatedHours && resourceAllocations && resourceAllocations.lifetimeAllocatedCost != null) {
    totalAllocatedCost = Number(resourceAllocations.lifetimeAllocatedCost || 0);
  }

  var eacHoursValue = hasAllocationData
    ? actualHoursToDate + remainingPlannedHours
    : actualHoursToDate;
  var eacHours = {
    value: ppRound2_(eacHoursValue),
    budgeted: hasAllocationData ? ppRound2_(totalAllocatedHours) : null,
  };

  var actualCostToDate = actualLaborToDate + actualExpensesToDate;
  var remainingPlanCost = remainingPlannedAllocCost + remainingPlannedExpenses;
  var eacCostValue = actualCostToDate + remainingPlanCost;
  var eacBudgeted =
    totalAllocatedCost > 0 || remainingPlannedExpenses > 0
      ? ppRound2_(totalAllocatedCost + remainingPlannedExpenses + actualExpensesToDate)
      : totalAllocatedCost > 0
        ? ppRound2_(totalAllocatedCost)
        : null;
  // Budgeted = full planned labor (allocations) + expenses seen on the series
  // (actual to date + remaining month expenses as plan proxy).
  if (totalAllocatedCost > 0) {
    eacBudgeted = ppRound2_(totalAllocatedCost + actualExpensesToDate + remainingPlannedExpenses);
  }
  var eacDollars = {
    value: ppRound2_(eacCostValue),
    budgeted: eacBudgeted,
    variancePct:
      eacBudgeted && eacBudgeted !== 0
        ? ppRound1_(((eacCostValue - eacBudgeted) / Math.abs(eacBudgeted)) * 100)
        : null,
  };

  var projectedRev = revToDate + remainingPlannedRevenue;
  var projectedCost = actualCostToDate + remainingPlanCost;
  var projectedGp = projectedRev - projectedCost;
  var projectedMarginPct =
    projectedRev > 0
      ? ppRound1_(((projectedRev - projectedCost) / projectedRev) * 100)
      : null;
  var projectedMarginReason =
    projectedRev > 0
      ? null
      : 'Projected margin requires planned revenue (actual plus remaining milestones).';
  var actualMarginPctToDate =
    recognizedRevToDate > 0
      ? ppRound1_(((recognizedRevToDate - actualCostToDate) / recognizedRevToDate) * 100)
      : null;

  var timingRecommended =
    periodGp !== null &&
    isFinite(periodGp) &&
    periodGp < 0 &&
    remainingPlannedRevenue > 0;
  var timingReview = {
    recommended: timingRecommended,
    reasonCode: timingRecommended ? 'negative_period_gp_revenue_planned_later' : null,
    message: timingRecommended
      ? 'Period gross profit is negative while revenue is planned later. Review timing before treating this as underperformance.'
      : null,
    periodGrossProfit: periodGp !== null ? ppRound2_(periodGp) : null,
    remainingPlannedRevenue: ppRound2_(remainingPlannedRevenue),
    periodRevenue: ppRound2_(periodRevenue),
  };

  var resourcesLifetime = ppBuildResourcesLifetime_(months, assignments, args.customerName);
  ppAttachSowRoleDisplay_(resourcesLifetime, assignments, null);

  return {
    asOfMonthKey: asOfMonthKey,
    plannedMarginPct: plannedMarginPct,
    plannedMarginReason: plannedMarginReason,
    projectedMarginPct: projectedMarginPct,
    projectedMarginReason: projectedMarginReason,
    projectedGrossProfit: projectedRev > 0 || projectedCost > 0 ? ppRound2_(projectedGp) : null,
    actualMarginPctToDate: actualMarginPctToDate,
    eacHours: eacHours,
    eacDollars: eacDollars,
    timingReview: timingReview,
    resourcesLifetime: resourcesLifetime,
  };
}

/**
 * @param {!Array<!Object>} months
 * @param {!Array<!Object>} assignments
 * @param {string=} customerName
 * @param {?Object=} opts
 * @param {boolean=} opts.mergeAssignmentLifetime When false, skip lifetime
 *   assignment hour/cost max (date-range rows). Rates still fill allocated cost.
 * @return {!Array<!Object>}
 * @private
 */
function ppBuildResourcesLifetime_(months, assignments, customerName, opts) {
  opts = opts || {};
  var mergeLifetime = opts.mergeAssignmentLifetime !== false;
  var byKey = {};
  var skipOrange = typeof isNoAllocationOrangeExemptCustomer_ === 'function'
    ? isNoAllocationOrangeExemptCustomer_(customerName)
    : String(customerName || '').toLowerCase().indexOf('harpin') >= 0;

  for (var i = 0; i < (months || []).length; i++) {
    var people = (months[i] && months[i].laborByPerson) || [];
    var monthMap = {};
    for (var j = 0; j < people.length; j++) {
      var p = people[j];
      var name = p.name || '(Unknown user)';
      var role = p.role || '(No role)';
      var mRow = ppEnsureResourcesLifetimeRow_(monthMap, name, role);
      mRow.loggedHoursLife += Number(p.hours || 0);
      mRow.loggedCostLife += Number(p.cost || 0);
      // Within a month, take max allocated so alias duplicates do not double-count.
      var monthAlloc = Number(p.allocatedHours || 0);
      if (monthAlloc > mRow.allocatedHoursLife) {
        mRow.allocatedHoursLife = monthAlloc;
      }
      var monthAllocCost = Number(p.allocatedCost || 0);
      if (monthAllocCost > mRow.allocatedCostLife) {
        mRow.allocatedCostLife = monthAllocCost;
      }
      if (!skipOrange && p.allocatedAndBillable === false) {
        mRow.allocatedAndBillable = false;
        mRow.highlightOrange = true;
      } else if (p.allocatedAndBillable === true && mRow.allocatedAndBillable !== false) {
        mRow.allocatedAndBillable = true;
      }
      if (!skipOrange && p.highlightOrange === true) mRow.highlightOrange = true;
    }

    var mKeys = Object.keys(monthMap);
    for (var mi = 0; mi < mKeys.length; mi++) {
      var src = monthMap[mKeys[mi]];
      var life = ppEnsureResourcesLifetimeRow_(byKey, src.name, src.role);
      life.loggedHoursLife += src.loggedHoursLife;
      life.loggedCostLife += src.loggedCostLife;
      life.allocatedHoursLife += src.allocatedHoursLife;
      life.allocatedCostLife += src.allocatedCostLife || 0;
      if (!skipOrange && src.allocatedAndBillable === false) {
        life.allocatedAndBillable = false;
        life.highlightOrange = true;
      } else if (src.allocatedAndBillable === true && life.allocatedAndBillable !== false) {
        life.allocatedAndBillable = true;
      }
      if (!skipOrange && src.highlightOrange) life.highlightOrange = true;
      life.name = ppPreferDisplayName_(life.name, src.name);
    }
  }

  // Seed / top up from Fibery assignments (allocation-only people + lifetime totals).
  if (mergeLifetime) {
    for (var a = 0; a < (assignments || []).length; a++) {
      var asg = assignments[a];
      var aName = asg.name || '(Unknown user)';
      var aRole = asg.roleName || '(No role)';
      var aRow = ppEnsureResourcesLifetimeRow_(byKey, aName, aRole);
      var asgHours = Number(asg.allocatedHours || 0);
      var asgRate = ppAssignmentCostRate_(asg);
      var asgCost = asgRate != null && asgHours > 0
        ? asgHours * asgRate
        : Number(asg.allocatedCost || 0);
      if (asgHours > aRow.allocatedHoursLife) {
        aRow.allocatedHoursLife = asgHours;
      }
      if (asgCost > aRow.allocatedCostLife) {
        aRow.allocatedCostLife = asgCost;
      }
      if (!skipOrange && asg.allocatedAndBillable === false) {
        aRow.allocatedAndBillable = false;
        aRow.highlightOrange = true;
      } else if (asg.allocatedAndBillable === true && aRow.allocatedAndBillable !== false) {
        aRow.allocatedAndBillable = true;
      }
    }
  }

  var out = [];
  var keys = Object.keys(byKey);
  for (var k = 0; k < keys.length; k++) {
    var r = byKey[keys[k]];
    if (
      r.loggedHoursLife <= 0 &&
      r.allocatedHoursLife <= 0 &&
      r.loggedCostLife <= 0 &&
      !(r.allocatedCostLife > 0)
    ) {
      continue;
    }
    if (!skipOrange && r.loggedHoursLife > 0 && r.allocatedHoursLife <= 0) {
      r.highlightOrange = true;
    }
    out.push({
      personKey: r.personKey,
      name: r.name,
      role: r.role,
      allocatedHoursLife: ppRound2_(r.allocatedHoursLife),
      loggedHoursLife: ppRound2_(r.loggedHoursLife),
      allocatedCostLife: ppRound2_(r.allocatedCostLife),
      loggedCostLife: ppRound2_(r.loggedCostLife),
      allocatedAndBillable: r.allocatedAndBillable,
      highlightOrange: !!r.highlightOrange,
      sowRoleDisplay: null,
    });
  }
  out.sort(function (a, b) {
    return String(a.name).localeCompare(String(b.name));
  });
  return ppFillAllocatedCostFromRates_(out, assignments || []);
}

/**
 * BUG-040-02: actual margin to date must exclude unrecognized forecast revenue
 * once a milestone Target Date passes.
 * @return {!Object}
 */
function test_buildProjectPerformanceBlock_ProjectedMarginUsesActualsPlusRemainingPlan_() {
  var months = [
    {
      key: '2026-06',
      revenue: 100000,
      revenueRecognized: 100000,
      labor: 40000,
      expenses: 0,
      laborByPerson: [{ hours: 100, allocatedHours: 50 }],
    },
    {
      key: '2026-07',
      revenue: 100000,
      revenueRecognized: 0,
      labor: 10000,
      expenses: 5000,
      laborByPerson: [{ hours: 50, allocatedHours: 80 }],
    },
    {
      key: '2026-08',
      revenue: 100000,
      revenueRecognized: 0,
      labor: 0,
      expenses: 0,
      laborByPerson: [{ hours: 0, allocatedHours: 100 }],
    },
  ];
  var resourceAllocations = {
    hasAllocations: true,
    months: [
      { key: '2026-07', allocatedCost: 15000 },
      { key: '2026-08', allocatedCost: 20000 },
    ],
  };
  var perfJun = buildProjectPerformanceBlock_({
    months: months,
    asOfMonthKey: '2026-06',
    resourceAllocations: resourceAllocations,
    assignments: [],
  });
  var perfJul = buildProjectPerformanceBlock_({
    months: months,
    asOfMonthKey: '2026-07',
    resourceAllocations: resourceAllocations,
    assignments: [],
  });
  var projectedRevJun = 100000 + 200000;
  var projectedCostJun = 40000 + 15000 + 20000 + 5000;
  var expectedJun = ppRound1_(((projectedRevJun - projectedCostJun) / projectedRevJun) * 100);
  var projectedRevJul = 200000 + 100000;
  var projectedCostJul = 50000 + 20000;
  var expectedJul = ppRound1_(((projectedRevJul - projectedCostJul) / projectedRevJul) * 100);
  var pass =
    perfJun.projectedMarginPct === expectedJun &&
    perfJul.projectedMarginPct === expectedJul &&
    perfJun.projectedMarginPct !== perfJul.projectedMarginPct;
  return {
    ok: true,
    pass: pass,
    projectedMarginJun: perfJun.projectedMarginPct,
    projectedMarginJul: perfJul.projectedMarginPct,
    expectedJun: expectedJun,
    expectedJul: expectedJul,
    message: pass
      ? 'PASS: projected margin varies by asOfMonthKey and matches (rev-cost)/rev.'
      : 'FAIL: projected margin still date-invariant or formula mismatch.',
  };
}

function test_buildProjectPerformanceBlock_ActualMarginExcludesUnrecognizedForecast_() {
  var months = [
    {
      key: '2026-08',
      revenue: 50000,
      revenueRecognized: 50000,
      labor: 30157,
      expenses: 0,
      grossProfit: 19843,
      laborByPerson: [{ hours: 100 }],
    },
    {
      key: '2026-09',
      revenue: 50000,
      revenueRecognized: 0,
      labor: 7217.5,
      expenses: 0,
      grossProfit: 42782.5,
      laborByPerson: [{ hours: 50 }],
    },
  ];
  var perf = buildProjectPerformanceBlock_({
    months: months,
    asOfMonthKey: '2026-09',
    resourceAllocations: { hasAllocations: false },
    assignments: [],
  });
  var actualCostToDate = 30157 + 7217.5;
  var expectedActualMargin = ppRound1_(((50000 - actualCostToDate) / 50000) * 100);
  var blendedWrongMargin = ppRound1_(((100000 - actualCostToDate) / 100000) * 100);
  var expectedProjectedGp = ppRound2_(100000 - actualCostToDate);
  var pass =
    perf.actualMarginPctToDate === expectedActualMargin &&
    perf.actualMarginPctToDate !== blendedWrongMargin &&
    perf.projectedGrossProfit === expectedProjectedGp;
  return {
    ok: true,
    pass: pass,
    actualMarginPctToDate: perf.actualMarginPctToDate,
    expectedActualMargin: expectedActualMargin,
    blendedWrongMargin: blendedWrongMargin,
    projectedGrossProfit: perf.projectedGrossProfit,
    expectedProjectedGp: expectedProjectedGp,
    message: pass
      ? 'PASS: actual margin to date uses recognized-only revenue; projected GP unchanged.'
      : 'FAIL: actual margin to date still blends unrecognized forecast revenue.',
  };
}
