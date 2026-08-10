/**
 * PRD version 3.6.0 - sync with docs/FOS-Dashboard-PRD.md
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
  var plannedMarginPct =
    args.targetMarginPct === null || args.targetMarginPct === undefined
      ? null
      : ppRound1_(Number(args.targetMarginPct));
  var hasAllocationData =
    !!(resourceAllocations && resourceAllocations.hasAllocations === true) ||
    !!(resourceAllocations && resourceAllocations.months && resourceAllocations.months.length);

  var actualHoursToDate = 0;
  var actualLaborToDate = 0;
  var actualExpensesToDate = 0;
  var revToDate = 0;
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
    } else {
      remainingPlannedHours += ppPlannedHoursForMonth_(m);
      var pc = ppPlannedAllocCostForMonth_(resourceAllocations, m.key);
      if (pc !== null) remainingPlannedAllocCost += pc;
      remainingPlannedExpenses += expenses;
      remainingPlannedRevenue += revenue;
    }
  }

  var assignments = args.assignments || (resourceAllocations && resourceAllocations.assignments) || [];
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
    projectedRev > 0 ? ppRound1_((projectedGp / projectedRev) * 100) : null;
  var actualMarginPctToDate =
    revToDate > 0 ? ppRound1_(((revToDate - actualCostToDate) / revToDate) * 100) : null;

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

  return {
    asOfMonthKey: asOfMonthKey,
    plannedMarginPct: plannedMarginPct,
    projectedMarginPct: projectedMarginPct,
    projectedGrossProfit: projectedRev > 0 || projectedCost > 0 ? ppRound2_(projectedGp) : null,
    actualMarginPctToDate: actualMarginPctToDate,
    eacHours: eacHours,
    eacDollars: eacDollars,
    timingReview: timingReview,
    resourcesLifetime: ppBuildResourcesLifetime_(months, assignments),
  };
}

/**
 * @param {!Array<!Object>} months
 * @param {!Array<!Object>} assignments
 * @return {!Array<!Object>}
 * @private
 */
function ppBuildResourcesLifetime_(months, assignments) {
  var byKey = {};
  for (var i = 0; i < months.length; i++) {
    var people = (months[i] && months[i].laborByPerson) || [];
    for (var j = 0; j < people.length; j++) {
      var p = people[j];
      var name = p.name || '(Unknown user)';
      var role = p.role || '(No role)';
      var key = ppPersonKey_(name, role);
      if (!byKey[key]) {
        byKey[key] = {
          personKey: key,
          name: name,
          role: role,
          allocatedHoursLife: 0,
          loggedHoursLife: 0,
          allocatedCostLife: 0,
          loggedCostLife: 0,
          allocatedAndBillable: null,
          highlightOrange: false,
        };
      }
      var row = byKey[key];
      row.loggedHoursLife += Number(p.hours || 0);
      row.loggedCostLife += Number(p.cost || 0);
      row.allocatedHoursLife += Number(p.allocatedHours || 0);
      if (p.allocatedAndBillable === false) {
        row.allocatedAndBillable = false;
        row.highlightOrange = true;
      } else if (p.allocatedAndBillable === true && row.allocatedAndBillable !== false) {
        row.allocatedAndBillable = true;
      }
      if (p.highlightOrange === true) row.highlightOrange = true;
    }
  }

  // Seed allocation-only people (no labor yet) from assignments list.
  for (var a = 0; a < (assignments || []).length; a++) {
    var asg = assignments[a];
    var aName = asg.name || '(Unknown user)';
    var aRole = asg.roleName || '(No role)';
    var aKey = ppPersonKey_(aName, aRole);
    if (!byKey[aKey]) {
      byKey[aKey] = {
        personKey: aKey,
        name: aName,
        role: aRole,
        allocatedHoursLife: Number(asg.allocatedHours || 0),
        loggedHoursLife: 0,
        allocatedCostLife: Number(asg.allocatedCost || 0),
        loggedCostLife: 0,
        allocatedAndBillable: null,
        highlightOrange: false,
      };
    } else if (!byKey[aKey].allocatedHoursLife && asg.allocatedHours) {
      byKey[aKey].allocatedHoursLife = Number(asg.allocatedHours || 0);
      byKey[aKey].allocatedCostLife = Number(asg.allocatedCost || 0);
    }
  }

  var out = [];
  var keys = Object.keys(byKey);
  for (var k = 0; k < keys.length; k++) {
    var r = byKey[keys[k]];
    if (r.loggedHoursLife <= 0 && r.allocatedHoursLife <= 0 && r.loggedCostLife <= 0) {
      continue;
    }
    if (r.loggedHoursLife > 0 && r.allocatedHoursLife <= 0) {
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
    });
  }
  out.sort(function (a, b) {
    return String(a.name).localeCompare(String(b.name));
  });
  return out;
}
